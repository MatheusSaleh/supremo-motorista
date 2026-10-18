// Gera src/world/city/terrainData.ts com a elevação real de Brasília (rodado só em desenvolvimento:
// `npm run terrain`). O jogo não acessa a internet para isso.
//
// O mapa do jogo é uma "Brasília condensada": as distâncias entre bairros não são reais. Cada ponto do
// jogo é levado a coordenadas reais por uma transformação afim ajustada a marcos conhecidos, corrigida
// por interpolação (IDW) dos resíduos — assim os próprios marcos caem exatamente no lugar certo.
//
// Fonte: Open-Meteo Elevation API (Copernicus DEM GLO-90). Ver CREDITS.md.
import { writeFileSync } from 'node:fs';

const STEP = 100; // m entre amostras
const BOUNDS = { minX: -2300, maxX: 2300, minZ: -2600, maxZ: 2500 }; // = layout.ts

// [x, z] no jogo → [lat, lon] reais (aproximados; só precisam ser bons para o relevo).
const CONTROL = [
  [[0, -1150], [-15.8003, -47.8606]], // Praça dos Três Poderes
  [[0, -900], [-15.7998, -47.8645]], // Congresso
  [[215, 150], [-15.7983, -47.8755]], // Catedral
  [[0, 960], [-15.794, -47.8826]], // Rodoviária
  [[0, 1620], [-15.7905, -47.8924]], // Torre de TV
  [[-560, 1990], [-15.7835, -47.8992]], // Estádio
  [[-330, 640], [-15.7922, -47.8795]], // Teatro
  [[545, 830], [-15.8003, -47.884]], // Setor bancário sul
  [[-1650, -1300], [-15.793, -47.8256]], // Alvorada
  [[640, -1725], [-15.8236, -47.8296]], // Ponte JK
  [[1280, -2200], [-15.838, -47.855]], // Lago Sul
  [[1795, 180], [-15.8697, -47.9208]], // Aeroporto
  [[1150, 480], [-15.818, -47.92]], // Setor de autarquias sul
  [[-1850, 1440], [-15.747, -47.887]], // ponta da Asa Norte
  [[1850, 1440], [-15.829, -47.912]], // ponta da Asa Sul
  [[-1460, 2150], [-15.782, -47.935]], // Setor Militar
];

/** Mínimos quadrados: [lat, lon] = A·[x, z, 1]. */
function fitAffine() {
  const solve3 = (M, b) => {
    // Eliminação de Gauss 3×3.
    const a = M.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      [a[c], a[p]] = [a[p], a[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = a[r][c] / a[c][c];
        for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
      }
    }
    return a.map((r, i) => r[3] / r[i]);
  };
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const atb = [[0, 0, 0], [0, 0, 0]];
  for (const [[x, z], ll] of CONTROL) {
    const v = [x, z, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) ata[i][j] += v[i] * v[j];
      atb[0][i] += v[i] * ll[0];
      atb[1][i] += v[i] * ll[1];
    }
  }
  return [solve3(ata, atb[0]), solve3(ata, atb[1])];
}

const [A_LAT, A_LON] = fitAffine();
const affine = (x, z) => [A_LAT[0] * x + A_LAT[1] * z + A_LAT[2], A_LON[0] * x + A_LON[1] * z + A_LON[2]];
const residuals = CONTROL.map(([[x, z], [lat, lon]]) => {
  const [a, b] = affine(x, z);
  return { x, z, dLat: lat - a, dLon: lon - b };
});

function toLatLon(x, z) {
  let [lat, lon] = affine(x, z);
  let wSum = 0;
  let dLat = 0;
  let dLon = 0;
  for (const r of residuals) {
    const d2 = (x - r.x) ** 2 + (z - r.z) ** 2 + 1;
    const w = 1 / (d2 * d2 * 1e-12 + 1e-9); // ~1/d⁴: influência local
    wSum += w;
    dLat += w * r.dLat;
    dLon += w * r.dLon;
  }
  return [lat + dLat / wSum, lon + dLon / wSum];
}

const cols = Math.floor((BOUNDS.maxX - BOUNDS.minX) / STEP) + 1;
const rows = Math.floor((BOUNDS.maxZ - BOUNDS.minZ) / STEP) + 1;
const points = [];
for (let r = 0; r < rows; r++)
  for (let c = 0; c < cols; c++) points.push(toLatLon(BOUNDS.minX + c * STEP, BOUNDS.minZ + r * STEP));

const elev = new Array(points.length);
for (let i = 0; i < points.length; i += 100) {
  const batch = points.slice(i, i + 100);
  const url =
    'https://api.open-meteo.com/v1/elevation?latitude=' +
    batch.map((p) => p[0].toFixed(5)).join(',') +
    '&longitude=' +
    batch.map((p) => p[1].toFixed(5)).join(',');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const { elevation } = await res.json();
      elevation.forEach((e, k) => (elev[i + k] = e));
      break;
    }
    if (attempt > 4) throw new Error(`Open-Meteo: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  process.stdout.write(`\r${Math.min(i + 100, points.length)}/${points.length}`);
}
console.log();

const out = `// GERADO por scripts/fetch-terrain.mjs — não editar à mão.
// Elevação real (m acima do mar) em grade de ${STEP} m sobre o mapa do jogo, linha a linha (Z), da
// esquerda para a direita (X). Fonte: Open-Meteo Elevation API (Copernicus DEM GLO-90), ${new Date().toISOString().slice(0, 10)}.
export const TERRAIN_DATA = {
  minX: ${BOUNDS.minX},
  minZ: ${BOUNDS.minZ},
  step: ${STEP},
  cols: ${cols},
  rows: ${rows},
  // prettier-ignore
  elevation: [${elev.map((e) => Math.round(e)).join(',')}],
};
`;
writeFileSync(new URL('../src/world/city/terrainData.ts', import.meta.url), out);
const min = Math.min(...elev);
const max = Math.max(...elev);
console.log(`terrainData.ts: ${cols}×${rows} amostras, ${min}–${max} m`);
