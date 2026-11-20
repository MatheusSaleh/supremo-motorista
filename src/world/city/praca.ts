// Praça dos Três Poderes (atrás do Congresso): praça seca, o Tribunal (genérico) ao sul, um palácio
// genérico ao norte e as garagens do Tribunal.
import * as THREE from 'three';
import { t } from '../../core/i18n';
import { formatAddress, sectorName } from '../../data/addresses';
import { placeMatrix, rectOf, type CityBuilder } from './builder';
import { buildColumnPalace } from './marcos';
import { FLEET } from '../../data/vehicles';

/** Vagas da frota (deslocamento em X a partir do centro da garagem), na ordem de FLEET. */
const SPOTS = [-16, -8, 0, 8, 16];
import { GARAGES, PRACA, ROAD_INNER, ROAD_OUTER, garageLayout, garageRoadEndX, type GarageLayout } from './layout';

export function buildPraca(b: CityBuilder): GarageLamp[] {
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
  const lamps = buildGarages(b, g);

  const tr = PRACA.tribunal;
  b.landmarks.push(
    { name: t('place.praca'), x: cx, z: cz },
    { name: t('place.tribunal'), x: tr.x, z: tr.z },
    { name: t('place.garagem'), x: (GARAGES.firstX + garageRoadEndX()) / 2, z: GARAGES.roadZ },
  );
  b.address('tribunal', formatAddress('SPTP', [{ kind: 'bloco', v: 1 }]), ROAD_OUTER + 8, tr.z);
  b.address('palacio', formatAddress('SPTP', [{ kind: 'bloco', v: 2 }]), -ROAD_OUTER - 8, PRACA.palacio.z);
  b.signs.push({ x: ROAD_OUTER + 4, z: PRACA.roadZ + 30, yaw: -Math.PI / 2, title: `SPTP · ${t('addr.bloco', { v: 1 })}`, subtitle: sectorName('SPTP') });
  return lamps;
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

/** Garagens do Tribunal: rua de serviço saindo da pista do Eixo, com as garagens dos dois lados. */
function buildGarages(b: CityBuilder, g: THREE.Object3D): GarageLamp[] {
  b.road(g, 'local', ROAD_OUTER, GARAGES.roadZ, garageRoadEndX(), GARAGES.roadZ, 'none');
  const lamps: GarageLamp[] = [];
  for (let i = 0; i < GARAGES.count; i++) lamps.push(buildGarage(b, g, garageLayout(i)));
  // Luz real só uma, na luminária do meio da garagem do jogador (uma luz pontual por garagem seria cara
  // na cena toda). Começa na garagem 0; o Game a muda de garagem (setGarage). O env/Atmosphere a acende à
  // noite (userData.nightLight); filha da luminária, sobe junto com o relevo.
  const light = new THREE.PointLight(0xfff1d6, 0, 34, 1.4);
  light.name = 'luz-garagem';
  light.position.set(0, -0.6, 0);
  light.userData.nightLight = 90;
  lamps[0].add(light);
  const first = garageLayout(0);
  b.address('garagem', formatAddress('SPTP', [{ kind: 'bloco', v: 1 }, { kind: 'lote', v: 'G' }]), first.x, GARAGES.roadZ);
  return lamps;
}

/** Luminária do meio de cada garagem (onde a luz pontual noturna fica; ver Game.setGarage). */
export type GarageLamp = THREE.Object3D;

/** Uma garagem: três paredes e laje, aberta para a rua de serviço. */
function buildGarage(b: CityBuilder, g: THREE.Object3D, gl: GarageLayout): GarageLamp {
  const { x, z, side } = gl;
  const { w, d, h } = GARAGES;
  const m = b.mats;
  const wall = 0.4;
  const back = z + (side * d) / 2; // parede do fundo (longe da rua)
  const front = z - (side * d) / 2; // abertura (voltada para a rua)
  const facing = side > 0 ? Math.PI : 0; // placas olham para a rua
  b.box(g, w, h, wall, m.concrete, x, h / 2, back); // fundo
  b.box(g, wall, h, d, m.concrete, x - w / 2, h / 2, z); // laterais
  b.box(g, wall, h, d, m.concrete, x + w / 2, h / 2, z);
  b.box(g, w + 1, 0.5, d + 1, m.white, x, h + 0.25, z); // laje
  b.slab(g, rectOf(x, z, w, d), 0.06, m.walk);
  // Calçada entre a rua e a abertura (sem faixa de grama no caminho do carro).
  b.slab(g, rectOf(x, front - (side * GARAGES.gap) / 2, w, GARAGES.gap + 0.2), 0.06, m.walk);
  // Forro claro + luminárias (emissivos: iluminam o visual sem custo de luz real na cena toda).
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xe8e6e0, emissive: 0x8a8880, roughness: 0.9 }),
  );
  ceiling.position.set(x, h - 0.01, z);
  ceiling.userData.noCollision = true;
  g.add(ceiling);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 1.4 });
  let middle: THREE.Object3D | null = null;
  for (const lx of SPOTS) {
    const l = b.box(g, 0.5, 0.08, d - 4, lampMat, x + lx, h - 0.06, z);
    l.userData.noCollision = true;
    l.castShadow = false;
    if (lx === 0) {
      l.userData.noBatch = true; // a luz pontual vira filha desta luminária (malha agrupada fica invisível)
      middle = l;
    }
  }
  // Faixas amarelas entre as vagas.
  for (const sx of [-12, -4, 4, 12]) {
    const s = b.box(g, 0.15, 0.02, d - 3, m.yellow, x + sx, 0.07, z + side * 0.5);
    s.userData.noCollision = true;
    s.castShadow = false;
  }
  // Placa com o nome de cada carro na parede do fundo, e o número da garagem em cima da abertura.
  FLEET.forEach((def, i) => {
    if (i < SPOTS.length) b.letreiro(g, t(def.nameKey), x + SPOTS[i], 3.2, back - side * 0.25, facing, 5.2, 0.8, { bg: '#13213b', fg: '#ffd34d' });
  });
  b.letreiro(g, t('garage.slot', { n: gl.index + 1 }), x, h + 0.9, front - side * 0.3, facing, 9, 1.2, { bg: '#f3f1ea', fg: '#1d2a33' });
  b.occupy(rectOf(x, z, w, d, 6));
  return middle!;
}

/** Spawns de uma garagem: a frota nas vagas (de frente para a rua) e Josué ao lado do carro do meio. */
export function garageSpawns(index: number): { player: THREE.Vector3; playerYaw: number; fleet: { position: THREE.Vector3; yaw: number }[] } {
  const { x, z, side } = garageLayout(index);
  const carYaw = side > 0 ? Math.PI : 0; // de frente para a rua
  const carZ = z + side * 1.5; // um pouco para dentro
  // Ao lado da porta do motorista do carro do meio (o lado +X local do carro).
  const px = x + (side > 0 ? -2.4 : 2.4);
  return {
    player: new THREE.Vector3(px, 0.2, carZ),
    playerYaw: Math.atan2(x - px, 0),
    fleet: SPOTS.map((dx) => ({ position: new THREE.Vector3(x + dx, 0.06, carZ), yaw: carYaw })),
  };
}
