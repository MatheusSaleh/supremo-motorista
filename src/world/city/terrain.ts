// Relevo real (scripts/fetch-terrain.mjs → terrainData.ts) transformado em altura do jogo:
//  - suavizado (o modelo de elevação inclui prédios e árvores; o jogo só quer o relevo);
//  - medido a partir de um nível base perto da Praça (as baixadas junto ao lago viram planície);
//  - com escala vertical que limita a inclinação (o mapa é condensado: sem isso, as ladeiras ficariam
//    bem mais íngremes que as reais);
//  - zerado no lago e subindo suavemente a partir da margem.
import { inRect, rectOf, type Rect } from './builder';
import { LAKE_RECT } from './lago';
import { PRACA, ROAD_OUTER } from './layout';
import { TERRAIN_DATA as D } from './terrainData';

export interface Terrain {
  /** Altura do chão (m) no ponto (x, z) do mapa. */
  heightAt(x: number, z: number): number;
  /** Escala vertical usada (1 = relevo real). */
  readonly verticalScale: number;
}

/** Altitude (m) que vira y = 0 (pouco abaixo da Praça dos Três Poderes, ~1050 m). */
const BASE_ELEVATION = 1032;
/**
 * Inclinação "típica" desejada depois da escala: o percentil 90 das inclinações da grade. (O máximo
 * vem de morros isolados a noroeste; limitá-lo achataria a cidade inteira. O Eixo fica em ~3%.)
 */
const TYPICAL_SLOPE = 0.06;
/** Distância (m) da margem em que o terreno vai de 0 à altura cheia. */
const SHORE_RAMP = 280;
const SMOOTH_SIGMA = 1.6; // em células da grade (~160 m)

/**
 * Áreas que precisam ficar planas (garagem com o acesso, palácios, praça): o terreno fica na altura do
 * centro de cada área e volta ao relevo em FLAT_BLEND metros. Sem isso, construções grandes e vazadas
 * (a garagem) entortam e os carros estacionados escorregam.
 */
const FLAT_ZONES: Rect[] = [
  { minX: ROAD_OUTER - 4, maxX: PRACA.garage.x + PRACA.garage.w / 2 + 6, minZ: PRACA.garage.z - PRACA.garage.d / 2 - 8, maxZ: PRACA.garage.z + PRACA.garage.d / 2 + 8 },
  rectOf(PRACA.tribunal.x, PRACA.tribunal.z, PRACA.tribunal.w + 20, PRACA.tribunal.d + 20),
  rectOf(PRACA.palacio.x, PRACA.palacio.z, PRACA.palacio.w + 20, PRACA.palacio.d + 20),
  PRACA.plaza,
];
const FLAT_BLEND = 45;
/**
 * Faixa plana extra em volta de cada área, maior que a aresta máxima da malha do chão (drape.ts): assim
 * nenhum triângulo do chão que alcança a área tem vértice já na rampa (o que o deixaria inclinado).
 */
const FLAT_MARGIN = 30;

export function createTerrain(): Terrain {
  const { cols, rows, step } = D;
  // 1) Alturas relativas ao nível base, com "piso" suave em 0.
  const k = 6;
  let h: Float32Array = Float32Array.from(D.elevation, (e) => {
    const r = e - BASE_ELEVATION;
    return 0.5 * (r + Math.sqrt(r * r + k * k)) - 0.5 * k;
  });
  // 2) Suaviza (gaussiana separável).
  h = blur(h, cols, rows, SMOOTH_SIGMA);
  // 3) Escala vertical para manter as ladeiras dentro do razoável.
  const grads: number[] = [];
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      grads.push(Math.max(Math.abs(h[i + 1] - h[i]), Math.abs(h[i + cols] - h[i])) / step);
    }
  grads.sort((a, b) => a - b);
  const p90 = grads[Math.floor(grads.length * 0.9)];
  const verticalScale = Math.min(1, TYPICAL_SLOPE / Math.max(p90, 1e-6));
  for (let i = 0; i < h.length; i++) h[i] *= verticalScale;

  const at = (c: number, r: number) => h[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];

  const relief = (x: number, z: number): number => {
    // Bicúbica (Catmull-Rom): sem "quinas" de inclinação entre células, o carro não sente degraus.
    const gx = (x - D.minX) / step;
    const gz = (z - D.minZ) / step;
    const c0 = Math.floor(gx);
    const r0 = Math.floor(gz);
    const tx = gx - c0;
    const tz = gz - r0;
    const row = (r: number) => cubic(at(c0 - 1, r), at(c0, r), at(c0 + 1, r), at(c0 + 2, r), tx);
    const v = cubic(row(r0 - 1), row(r0), row(r0 + 1), row(r0 + 2), tz);
    return Math.max(0, v) * shoreFactor(x, z);
  };
  const zones = flatZoneHeights(FLAT_ZONES, relief);

  return {
    verticalScale,
    heightAt(x: number, z: number): number {
      let h = relief(x, z);
      for (const { r, h: flat } of zones) {
        if (inRect(r, x, z)) return flat;
        const d = Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
        if (d <= FLAT_MARGIN) return flat;
        if (d < FLAT_MARGIN + FLAT_BLEND) {
          const t = (d - FLAT_MARGIN) / FLAT_BLEND;
          h = flat + (h - flat) * t * t * (3 - 2 * t);
        }
      }
      return h;
    },
  };
}

/**
 * Altura de cada área plana. Áreas cujas faixas de transição se tocam (garagem, Tribunal, praça e palácio
 * são vizinhos) formam um grupo com uma altura só, a média ponderada pela área. Com alturas diferentes,
 * uma área começaria plana exatamente onde a outra termina, sem espaço para a transição: o chão ficava
 * com um degrau vertical de vários metros (a garagem estava ~6 m abaixo da praça, no meio da pista do Eixo).
 */
function flatZoneHeights(rects: Rect[], relief: (x: number, z: number) => number): { r: Rect; h: number }[] {
  const reach = FLAT_MARGIN + FLAT_BLEND;
  const near = (a: Rect, b: Rect) =>
    a.minX - reach <= b.maxX + reach && b.minX - reach <= a.maxX + reach && a.minZ - reach <= b.maxZ + reach && b.minZ - reach <= a.maxZ + reach;
  // Agrupa por vizinhança (união transitiva).
  const group = rects.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])));
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) if (near(rects[i], rects[j])) group[root(i)] = root(j);
  const sums = new Map<number, { area: number; weighted: number }>();
  rects.forEach((r, i) => {
    const area = (r.maxX - r.minX) * (r.maxZ - r.minZ);
    const s = sums.get(root(i)) ?? { area: 0, weighted: 0 };
    s.area += area;
    s.weighted += area * relief((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2);
    sums.set(root(i), s);
  });
  return rects.map((r, i) => {
    const s = sums.get(root(i))!;
    return { r, h: s.weighted / s.area };
  });
}

/** 0 dentro do lago, sobe suavemente até 1 a SHORE_RAMP metros da água. */
function shoreFactor(x: number, z: number): number {
  const r = LAKE_RECT;
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  const d = Math.hypot(dx, dz);
  const t = Math.min(1, d / SHORE_RAMP);
  return t * t * (3 - 2 * t);
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

function blur(src: Float32Array, cols: number, rows: number, sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    sum += w;
  }
  const kn = kernel.map((w) => w / sum);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let v = 0;
      for (let i = -radius; i <= radius; i++) v += kn[i + radius] * src[r * cols + Math.min(cols - 1, Math.max(0, c + i))];
      tmp[r * cols + c] = v;
    }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let v = 0;
      for (let i = -radius; i <= radius; i++) v += kn[i + radius] * tmp[Math.min(rows - 1, Math.max(0, r + i)) * cols + c];
      out[r * cols + c] = v;
    }
  return out;
}
