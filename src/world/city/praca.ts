// Praça dos Três Poderes (atrás do Congresso): praça seca, o Tribunal (genérico) ao sul, um palácio
// genérico ao norte e a garagem do Tribunal.
import * as THREE from 'three';
import { t } from '../../core/i18n';
import { formatAddress, sectorName } from '../../data/addresses';
import { placeMatrix, rectOf, type CityBuilder } from './builder';
import { buildColumnPalace } from './marcos';
import { FLEET } from '../../data/vehicles';

/** Vagas da frota (deslocamento em Z a partir do centro da garagem), na ordem de FLEET. */
const SPOTS = [-16, -8, 0, 8, 16];
import { PRACA, ROAD_INNER, ROAD_OUTER } from './layout';

export function buildPraca(b: CityBuilder): void {
  const g = b.group('praca-tres-poderes');
  const m = b.mats;

  // Pista atrás do Congresso ligando as duas pistas do Eixo.
  b.road(g, 'main', -ROAD_INNER, PRACA.roadZ, ROAD_INNER, PRACA.roadZ, 'none');

  // Praça seca + mastro central.
  const p = PRACA.plaza;
  b.slab(g, p, 0.1, m.plaza);
  b.occupy(p);
  const cx = (p.minX + p.maxX) / 2;
  const cz = (p.minZ + p.maxZ) / 2;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 60, 10), m.metal);
  pole.position.set(cx, 30, cz);
  pole.castShadow = true;
  g.add(pole);
  // Espelho d'água raso (decorativo, não afoga).
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(90, 26).rotateX(-Math.PI / 2), m.pool);
  pool.position.set(cx, 0.12, p.maxZ - 30);
  pool.userData.noCollision = true;
  g.add(pool);

  buildPalace(b, g, PRACA.tribunal, true);
  // Palácio do Planalto (marco real, só cenário): colunas afiladas e rampa voltada para a praça.
  buildColumnPalace(b, g, PRACA.palacio, { ramp: 1 });
  b.landmarks.push({ name: t('place.planalto'), x: PRACA.palacio.x, z: PRACA.palacio.z });
  buildGarage(b, g);

  const tr = PRACA.tribunal;
  b.landmarks.push(
    { name: t('place.praca'), x: cx, z: cz },
    { name: t('place.tribunal'), x: tr.x, z: tr.z },
    { name: t('place.garagem'), x: PRACA.garage.x, z: PRACA.garage.z },
  );
  b.address('tribunal', formatAddress('SPTP', [{ kind: 'bloco', v: 1 }]), ROAD_OUTER + 8, tr.z);
  b.address('palacio', formatAddress('SPTP', [{ kind: 'bloco', v: 2 }]), -ROAD_OUTER - 8, PRACA.palacio.z);
  b.signs.push({ x: ROAD_OUTER + 4, z: PRACA.roadZ + 30, yaw: -Math.PI / 2, title: `SPTP · ${t('addr.bloco', { v: 1 })}`, subtitle: sectorName('SPTP') });
}

/** Palácio genérico: caixa de vidro sob laje fina com colunata nas fachadas longas (±Z). */
function buildPalace(b: CityBuilder, g: THREE.Object3D, s: { x: number; z: number; w: number; d: number; h: number }, tribunal: boolean): void {
  const m = b.mats;
  b.box(g, s.w - 10, s.h - 2, s.d - 10, m.glass, s.x, (s.h - 2) / 2, s.z);
  b.box(g, s.w + 6, 1.6, s.d + 6, m.white, s.x, s.h - 0.8, s.z);
  // Escadaria/plataforma de acesso voltada para a praça.
  b.slab(g, rectOf(s.x, s.z, s.w + 6, s.d + 6), 0.6, m.white);
  const cols: THREE.Matrix4[] = [];
  const n = 9;
  const facing = s.x > 0 ? -1 : 1; // fachada principal voltada para a praça
  for (let k = 0; k < n; k++) {
    const z = s.z - s.d / 2 + 2 + (k * (s.d - 4)) / (n - 1);
    cols.push(placeMatrix(s.x + facing * (s.w / 2 + 1), (s.h - 1.6) / 2, z));
    cols.push(placeMatrix(s.x - facing * (s.w / 2 + 1), (s.h - 1.6) / 2, z));
  }
  b.instanced(g, new THREE.CylinderGeometry(0.6, 0.6, s.h - 1.6, 8), m.white, cols, undefined, tribunal ? 'colunas-tribunal' : 'colunas-palacio');
  b.occupy(rectOf(s.x, s.z, s.w + 6, s.d + 6, 4));

  if (tribunal) {
    // Faixa no topo para distinguir o Tribunal (sem símbolos reais).
    const band = b.box(g, 0.4, 2.2, s.d * 0.6, m.yellow, s.x + facing * (s.w / 2 + 3.3), s.h - 2.6, s.z);
    band.userData.noCollision = true;
  }
}

/** Garagem: três paredes e laje, aberta para −X (lado da pista do Eixo). */
function buildGarage(b: CityBuilder, g: THREE.Object3D): void {
  const { x, z, w, d, h } = PRACA.garage;
  const m = b.mats;
  const wall = 0.4;
  b.box(g, wall, h, d, m.concrete, x + w / 2, h / 2, z); // fundo
  b.box(g, w, h, wall, m.concrete, x, h / 2, z - d / 2); // laterais
  b.box(g, w, h, wall, m.concrete, x, h / 2, z + d / 2);
  b.box(g, w + 1, 0.5, d + 1, m.white, x, h + 0.25, z); // laje
  b.slab(g, rectOf(x, z, w, d), 0.06, m.walk);
  // Forro claro + luminárias (emissivos: iluminam o visual sem custo de luz real na cena toda).
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xe8e6e0, emissive: 0x8a8880, roughness: 0.9 }),
  );
  ceiling.position.set(x, h - 0.01, z);
  ceiling.userData.noCollision = true;
  g.add(ceiling);
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 1.4 });
  for (const lz of SPOTS) {
    const l = b.box(g, w - 4, 0.08, 0.5, lamp, x, h - 0.06, z + lz);
    l.userData.noCollision = true;
    l.castShadow = false;
  }
  // Pista de acesso até a pista do Eixo.
  b.road(g, 'local', ROAD_OUTER, z, x - w / 2, z, 'none');
  for (const sz of [-12, -4, 4, 12]) {
    const s = b.box(g, w - 3, 0.02, 0.15, m.yellow, x + 0.5, 0.07, z + sz);
    s.userData.noCollision = true;
    s.castShadow = false;
  }
  // Placa com o nome de cada carro na parede do fundo (voltada para a saída, −X).
  FLEET.forEach((def, i) => {
    if (i < SPOTS.length) b.letreiro(g, t(def.nameKey), x + w / 2 - 0.25, 3.2, z + SPOTS[i], -Math.PI / 2, 5.2, 0.8, { bg: '#13213b', fg: '#ffd34d' });
  });
  b.letreiro(g, t('garage.fleet'), x - w / 2 - 0.3, h + 0.9, z, -Math.PI / 2, 9, 1.2, { bg: '#f3f1ea', fg: '#1d2a33' });
  b.occupy(rectOf(x, z, w, d, 6));
  b.address('garagem', formatAddress('SPTP', [{ kind: 'bloco', v: 1 }, { kind: 'lote', v: 'G' }]), x - w / 2 - 4, z);
}

/** Spawns na garagem: a frota nas vagas (de frente para a saída, −X) e Josué ao lado do carro do meio. */
export function garageSpawns(): { player: THREE.Vector3; playerYaw: number; fleet: { position: THREE.Vector3; yaw: number }[] } {
  const { x, z } = PRACA.garage;
  return {
    // Ao lado da porta do motorista do carro do meio (lado +Z, já que ele está virado para −X).
    player: new THREE.Vector3(x + 0.5, 0.2, z + 2.4),
    playerYaw: Math.PI, // olhando para o carro (−Z)
    fleet: SPOTS.map((dz) => ({ position: new THREE.Vector3(x, 0.06, z + dz), yaw: -Math.PI / 2 })),
  };
}
