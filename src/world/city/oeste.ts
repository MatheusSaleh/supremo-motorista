// Faixa oeste (M4 do plano de densificação, docs/PLANO-MAPA.md): quadras 300, W3 com o comércio da 500,
// Setor Militar Urbano, Eixo Monumental oeste (Feira da Torre, Centro de Convenções, Planetário, Memorial JK,
// Palácio do Buriti, Cruzeiro), casas geminadas da 700, Parque da Cidade e Sudoeste.
// Marcos reais só como cenário (nome em letreiro/minimapa); comércio e diversões com nomes fictícios.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { t } from '../../core/i18n';
import { formatAddress, sectorName } from '../../data/addresses';
import { placeMatrix, rectOf, type CityBuilder, type Rect } from './builder';
import { EIXAO, MARCOS, OESTE, ROAD, ROAD_OUTER, SUPERQUADRAS } from './layout';
import { palmCrownGeometry } from './marcos';
import type { CityKit } from './quadras';

export function buildOeste(b: CityBuilder, kit: CityKit): void {
  const g = b.group('oeste', kit.group);
  const O = OESTE;

  // --- Vias -----------------------------------------------------------------------
  b.road(g, 'main', ROAD_OUTER, O.w3.z, EIXAO.maxX, O.w3.z, 'both');
  b.road(g, 'main', O.w3.norteMaxX, O.w3.z, EIXAO.minX, O.w3.z, 'both');
  for (const x of [800, 1500, -800, -1500]) {
    b.road(g, 'local', x, EIXAO.crossRoad.maxZ, x, O.w3.z, 'none');
    if (x > 0) b.road(g, 'local', x, O.w3.z, x, O.parque.roadZ, 'none');
  }
  b.road(g, 'local', 800, O.parque.roadZ, EIXAO.maxX, O.parque.roadZ, 'right');
  for (const x of O.smu.roadsX) b.road(g, 'local', x, O.w3.z, x, O.smu.roadZ, 'none');
  b.road(g, 'local', O.smu.maxX, O.smu.roadZ, O.smu.minX, O.smu.roadZ, 'right');
  for (const z of O.casas700.roadsZ) b.road(g, 'local', ROAD_OUTER, z, 800 - ROAD.local / 2, z, 'right');
  for (const s of [1, -1]) b.signs.push({ x: s * 600, z: O.w3.z - ROAD.main / 2 - 4, yaw: Math.PI, title: `W3 ${s > 0 ? 'Sul' : 'Norte'}`, subtitle: t('sector.CLQ') });

  // --- Marcos do Eixo Monumental oeste ------------------------------------------------
  buildFeiraTorre(b, g);
  buildConvencoes(b, g);
  buildPlanetario(b, g);
  buildMemorialJk(b, g);
  buildBuriti(b, g);
  buildCruzeiro(b, g);

  // --- Superquadras 100 (refeitas com o kit: pilotis, escola, parquinho) e o comércio entre elas --------
  const Q = SUPERQUADRAS;
  Q.centersX.forEach((cx, i) => {
    const wing = cx > 0 ? 'S' : 'N';
    const number = 100 + Q.centersX.filter((x) => Math.sign(x) === Math.sign(cx) && Math.abs(x) <= Math.abs(cx)).length * 4;
    kit.superquadra({ cx, cz: Q.centerZ, size: Q.size, floors: 6, entry: cx > 0 ? 'minX' : 'maxX', access: Q.accessX[i], wing, number }, g);
  });
  for (const s of [1, -1]) {
    for (const x of Q.comercioX) kit.comercio(g, s * x, Q.centerZ - Q.size / 2 + 12, Q.centerZ + Q.size / 2 - 12, s > 0 ? 'S' : 'N', `1${Math.round(x / 100)}`);
  }
  b.landmarks.push({ name: t('place.superquadras'), x: Q.centersX[2], z: Q.centerZ , minor: true });

  // --- Quadras 300 (acesso pela W3) ------------------------------------------------------
  const count = { S: 0, N: 0 };
  for (const x of O.q300.xs) {
    const wing = x > 0 ? 'S' : 'N';
    kit.superquadra({ cx: x, cz: O.q300.z, size: O.q300.size, floors: 6, entry: 'maxZ', access: O.w3.z, wing, number: 302 + 2 * count[wing]++ }, g);
  }

  // --- Sudoeste (antes do comércio da W3: as ruas de acesso cortam a faixa) -----------------------
  let n = 902;
  for (const row of O.sudoeste.rows) {
    for (const x of O.sudoeste.xs) kit.superquadra({ cx: x, cz: row.z, size: row.size, floors: 6, entry: row.entry, access: row.access, wing: 'S', number: (n += 2) }, g);
    kit.comercio(g, (O.sudoeste.xs[0] + O.sudoeste.xs[1]) / 2, row.z - row.size / 2 + 12, row.z + row.size / 2 - 12, 'S', `${n - 2}/${n}`);
  }
  b.landmarks.push({ name: t('place.sudoeste'), x: O.sudoeste.xs[0], z: O.sudoeste.rows[0].z , minor: true });

  // --- Comércio da W3 (500) ---------------------------------------------------------------
  kit.shopRow(g, 170, EIXAO.maxX - 10, O.comercio500.minZ, O.comercio500.maxZ, -1, 'S', 'W3-5');
  kit.shopRow(g, EIXAO.minX + 10, O.w3.norteMaxX - 30, O.comercio500.minZ, O.comercio500.maxZ, -1, 'N', 'W3-5');
  b.landmarks.push({ name: t('place.w3'), x: 1150, z: O.w3.z , minor: true });

  // --- Casas geminadas da 700 ----------------------------------------------------------------
  O.casas700.rows.forEach(([z, face], i) => kit.houseRow(O.casas700.minX, O.casas700.maxX, z, face, 'S', 702 + 2 * Math.floor(i / 2)));
  b.landmarks.push({ name: t('place.casas700'), x: (O.casas700.minX + O.casas700.maxX) / 2, z: 2340 , minor: true });

  // --- Setor Militar Urbano ----------------------------------------------------------------
  buildSmu(b, kit, g);

  // --- Setor de Rádio e TV (Norte) e secretarias ao lado do Buriti (Sul) ---------------------------
  buildRadioTv(b, kit, g);
  kit.fillSector(g, O.secretarias, {
    cell: [140, 116],
    foot: [
      [60, 18],
      [50, 22],
    ],
    floors: [4, 8],
    styles: ['brise', 'pastilha'],
    signs: ['agency.7', 'agency.8', 'agency.3', 'agency.5'],
    signColors: { bg: '#f3f1ea', fg: '#1d2a33' },
    sector: 'SAA',
    wing: 'S',
    prefix: 'saa-S-oeste',
    counter: { n: 0 },
    quadra: 30,
  });

  // --- Parque da Cidade ----------------------------------------------------------------------
  buildParque(b, kit, g);
}

// ---------------------------------------------------------------------------------------------
// Eixo Monumental oeste
// ---------------------------------------------------------------------------------------------

/** Feira da Torre: anel de barracas coloridas em volta da base da Torre de TV. */
function buildFeiraTorre(b: CityBuilder, g: THREE.Object3D): void {
  const { x, z } = MARCOS.torreTv;
  const { r0, r1 } = OESTE.feiraTorre;
  const f = b.group('feira-torre', g);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r0 - 6, r1 + 6, 48, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9c4b8, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  ring.position.set(x, 0.04, z);
  ring.receiveShadow = true;
  ring.userData.noCollision = true;
  ring.userData.surface = 'concrete';
  ring.userData.drape = 'deform';
  f.add(ring);
  const bases: THREE.Matrix4[] = [];
  const roofs: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const palette = [0xe0533d, 0x3d8be0, 0xf2c14e, 0x4fb06a, 0xe07a3d, 0x9b59b6, 0xffffff];
  let k = 0;
  for (const r of [r0, (r0 + r1) / 2 + 2, r1]) {
    const n = Math.floor((2 * Math.PI * r) / 9);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (r === r0 ? 0 : 0.1);
      if (Math.abs(Math.sin(a)) < 0.12) continue; // corredores alinhados com o Eixo
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      bases.push(placeMatrix(px, 0.6, pz, -a));
      roofs.push(placeMatrix(px, 2.6, pz, -a + Math.PI / 4));
      colors.push(new THREE.Color(palette[k++ % palette.length]));
    }
  }
  const counters = b.instanced(f, new THREE.BoxGeometry(3, 1.2, 4), b.mats.wood, bases, undefined, 'feira-torre-barracas');
  counters.userData.cullDistance = 600;
  const tents = b.instanced(f, new THREE.ConeGeometry(3.4, 1.4, 4), b.mats.tintedFlat, roofs, colors, 'feira-torre-toldos');
  tents.userData.noCollision = true;
  tents.userData.cullDistance = 600;
  b.landmarks.push({ name: t('place.feiraTorre'), x, z: z + r1 });
  b.address('torre-feira', formatAddress('SCR', [{ kind: 'lote', v: 8 }]), x + r1 + 10, z);
}

/** Centro de Convenções: bloco longo e baixo com brises, sob uma laje de cobertura que avança sobre a entrada. */
function buildConvencoes(b: CityBuilder, g: THREE.Object3D): void {
  const s = OESTE.convencoes;
  const c = b.group('centro-convencoes', g);
  const m = b.mats;
  b.slab(c, rectOf(s.x, s.z, s.w + 30, s.d + 20), 0.3, m.plaza);
  b.box(c, s.w, s.h - 2, s.d, m.glass, s.x, (s.h - 2) / 2, s.z, 'convencoes');
  b.box(c, s.w + 18, 1.6, s.d + 12, m.white, s.x, s.h - 0.2, s.z);
  const fins: THREE.Matrix4[] = [];
  for (let z = s.z - s.d / 2 + 3; z <= s.z + s.d / 2 - 3; z += 4) fins.push(placeMatrix(s.x + s.w / 2 + 1, (s.h - 2) / 2, z));
  b.instanced(c, new THREE.BoxGeometry(0.6, s.h - 2, 1.4), m.white, fins, undefined, 'brises-convencoes');
  for (const dz of [-s.d / 2 + 2, s.d / 2 - 2]) for (const dx of [s.w / 2 + 8, -s.w / 2 - 8]) b.box(c, 1.2, s.h - 1, 1.2, m.white, s.x + dx, (s.h - 1) / 2, s.z + dz);
  b.occupy(rectOf(s.x, s.z, s.w + 30, s.d + 20, 4));
  b.letreiro(c, t('place.convencoes'), s.x + s.w / 2 + 9.05, s.h - 0.2, s.z, Math.PI / 2, 40, 1.4, { bg: '#f3f1ea', fg: '#1d2a33' });
  b.landmarks.push({ name: t('place.convencoes'), x: s.x, z: s.z });
}

/** Planetário (sem nome): cúpula branca sobre um tambor baixo. */
function buildPlanetario(b: CityBuilder, g: THREE.Object3D): void {
  const s = OESTE.planetario;
  const p = b.group('planetario', g);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, 6, 32), b.mats.concrete);
  drum.position.set(s.x, 3, s.z);
  drum.castShadow = drum.receiveShadow = true;
  p.add(drum);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(s.r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), b.mats.white);
  dome.position.set(s.x, 6, s.z);
  dome.castShadow = true;
  dome.userData.collider = 'convex';
  p.add(dome);
  b.occupy(rectOf(s.x, s.z, s.r * 2, s.r * 2, 4));
}

/**
 * Memorial JK: base em tronco de pirâmide, pedestal alto e afilado e, no topo, a concha curva que abriga a
 * estátua (silhueta, sem rosto). Diante dele, a esplanada de concreto.
 */
function buildMemorialJk(b: CityBuilder, g: THREE.Object3D): void {
  const { x, z } = OESTE.memorialJk;
  const j = b.group('memorial-jk', g);
  const m = b.mats;
  b.slab(j, rectOf(x, z, 110, 110), 0.3, m.plaza);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(22, 34, 9, 4, 1).rotateY(Math.PI / 4), m.white);
  base.position.set(x, 4.8, z);
  base.castShadow = base.receiveShadow = true;
  base.userData.collider = 'convex';
  j.add(base);
  const px = x + 26; // pedestal à frente da base, voltado para o Eixo (+X)
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.2, 28, 8), m.white);
  pedestal.position.set(px, 14, z);
  pedestal.castShadow = true;
  pedestal.userData.collider = 'convex';
  j.add(pedestal);
  // Concha: arco de toro em pé (aberto para o Eixo), com a estátua dentro.
  const shell = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.9, 10, 28, Math.PI * 1.15), m.white);
  shell.rotation.set(0, Math.PI / 2, Math.PI / 2 - Math.PI * 0.575);
  shell.position.set(px, 32, z);
  shell.castShadow = true;
  shell.userData.noCollision = true;
  j.add(shell);
  const statue = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 3.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0x5b5a55, roughness: 0.4, metalness: 0.6 }));
  statue.position.set(px, 31, z);
  statue.userData.noCollision = true;
  j.add(statue);
  b.occupy(rectOf(x, z, 70, 70, 4));
  b.letreiro(j, t('place.memorialJk'), x + 34.05, 2.5, z, Math.PI / 2, 14, 1.4, { bg: '#f3f1ea', fg: '#1d2a33' });
  b.landmarks.push({ name: t('place.memorialJk'), x, z });
}

/**
 * Palácio do Buriti: bloco horizontal branco de 4 andares sobre um térreo recuado de colunas finas, de frente
 * para o Eixo (−X), com uma praça, o mastro e um buriti (palmeira) diante da fachada.
 */
function buildBuriti(b: CityBuilder, g: THREE.Object3D): void {
  const s = OESTE.buriti;
  const p = b.group('buriti', g);
  const m = b.mats;
  b.slab(p, rectOf(s.x - 50, s.z, 120, s.d + 40), 0.25, m.plaza);
  b.box(p, s.w - 6, 4, s.d - 8, m.glass, s.x, 2.25, s.z);
  b.box(p, s.w, s.h - 4.5, s.d, m.blockFacade, s.x, 4.5 + (s.h - 4.5) / 2, s.z, 'buriti');
  b.box(p, s.w + 4, 1, s.d + 4, m.white, s.x, s.h + 0.5, s.z);
  const cols: THREE.Matrix4[] = [];
  for (let z = s.z - s.d / 2 + 2; z <= s.z + s.d / 2 - 2; z += 6) cols.push(placeMatrix(s.x - s.w / 2 + 0.6, 0, z));
  const colMesh = b.instanced(p, new THREE.CylinderGeometry(0.35, 0.35, 4.5, 8).translate(0, 2.25, 0), m.white, cols, undefined, 'buriti-colunas');
  colMesh.userData.collider = 'pole';
  colMesh.userData.cameraIgnore = true;
  // Mastro e o buriti na praça.
  b.box(p, 0.5, 26, 0.5, m.metal, s.x - 70, 13, s.z);
  const palm = b.group('buriti-palmeira', p);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 14, 8).translate(0, 7, 0), new THREE.MeshStandardMaterial({ color: 0x6f5e48, roughness: 1 }));
  trunk.position.set(s.x - 50, 0, s.z - 25);
  trunk.userData.collider = 'convex';
  palm.add(trunk);
  const crown = new THREE.Mesh(palmCrownGeometry().scale(2, 1.6, 2).translate(0, 1.5, 0), new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.9, side: THREE.DoubleSide }));
  crown.position.set(s.x - 50, 0, s.z - 25);
  crown.userData.noCollision = true;
  palm.add(crown);
  b.occupy(rectOf(s.x, s.z, s.w + 8, s.d + 8, 4));
  b.letreiro(p, t('place.buriti'), s.x - s.w / 2 - 2.05, s.h + 0.5, s.z, -Math.PI / 2, 30, 1.2, { bg: '#f3f1ea', fg: '#1d2a33' });
  b.landmarks.push({ name: t('place.buriti'), x: s.x, z: s.z });
}

/** Cruzeiro: a cruz no fim do Eixo (sem nome). */
function buildCruzeiro(b: CityBuilder, g: THREE.Object3D): void {
  const { x, z } = OESTE.cruzeiro;
  const c = b.group('cruzeiro', g);
  b.slab(c, rectOf(x, z, 18, 18), 0.4, b.mats.plaza);
  b.box(c, 0.8, 14, 0.8, b.mats.wood, x, 7, z);
  b.box(c, 0.6, 0.6, 6, b.mats.wood, x, 10.5, z);
}

/** Setor de Rádio e TV: prédios de emissoras fictícias e torres de antena treliçadas. */
function buildRadioTv(b: CityBuilder, kit: CityKit, g: THREE.Object3D): void {
  const R = OESTE.radioTv;
  const tv = b.group('radio-tv', g);
  // Antenas primeiro (o setor desvia delas).
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9473a, roughness: 0.6, metalness: 0.4 });
  for (const [x, z, h] of [
    [-360, 1905, 70],
    [-200, 2190, 55],
    [-360, 2440, 62],
  ]) {
    if (!b.isRectFree(rectOf(x, z, 14, 14, 2))) continue;
    for (const [dx, dz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) b.cylinderBetween(tv, new THREE.Vector3(x + dx, 0, z + dz), new THREE.Vector3(x + dx * 0.15, h, z + dz * 0.15), 0.25, steel, 5);
    b.occupy(rectOf(x, z, 10, 10, 2));
  }
  kit.fillSector(tv, R, {
    cell: [110, 100],
    foot: [
      [40, 22],
      [30, 30],
    ],
    floors: [3, 7],
    styles: ['vidroAzul', 'pastilha', 'vidroEscuro'],
    signs: ['tv.1', 'tv.2', 'tv.3', 'tv.4'],
    signColors: { bg: '#1d1d2b', fg: '#f2c94c' },
    sector: 'SCR',
    wing: 'N',
    prefix: 'srt-N',
    counter: { n: 0 },
    quadra: 4,
    face: 1,
  });
}

// ---------------------------------------------------------------------------------------------
// Setor Militar Urbano
// ---------------------------------------------------------------------------------------------

function buildSmu(b: CityBuilder, kit: CityKit, g: THREE.Object3D): void {
  const S = OESTE.smu;
  const smu = b.group('smu', g);
  // Pátio de formatura com mastro, perto da W3.
  const parade: Rect = { minX: -2160, maxX: -1900, minZ: 2010, maxZ: 2130 };
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(parade.maxX - parade.minX, parade.maxZ - parade.minZ).rotateX(-Math.PI / 2), b.mats.asphalt);
  yard.position.set((parade.minX + parade.maxX) / 2, 0.03, (parade.minZ + parade.maxZ) / 2);
  yard.receiveShadow = true;
  yard.userData.noCollision = true;
  yard.userData.surface = 'asphalt';
  yard.userData.drape = 'deform';
  smu.add(yard);
  b.box(smu, 0.5, 22, 0.5, b.mats.metal, parade.maxX + 6, 11, (parade.minZ + parade.maxZ) / 2);
  b.occupy(parade);
  for (const [x, z] of [
    [-2120, 2330],
    [-2080, 2330],
  ]) kit.court(smu, x, z);
  b.occupy({ minX: -2140, maxX: -2060, minZ: 2305, maxZ: 2355 });
  kit.fillSector(smu, S, {
    cell: [120, 108],
    foot: [
      [72, 16],
      [60, 18],
      [40, 30],
    ],
    floors: [2, 4],
    styles: ['quartel'],
    sector: 'SMB',
    wing: 'N',
    prefix: 'smb-N',
    counter: { n: 0 },
    quadra: 2,
    parkingFill: 0.4,
  });
  b.landmarks.push({ name: t('place.smu'), x: -1850, z: 2200 , minor: true });
  b.signs.push({ x: S.maxX - 20, z: OESTE.w3.z + ROAD.main / 2 + 4, yaw: 0, title: 'SMB', subtitle: sectorName('SMB') });
}

// ---------------------------------------------------------------------------------------------
// Parque da Cidade
// ---------------------------------------------------------------------------------------------

function buildParque(b: CityBuilder, kit: CityKit, g: THREE.Object3D): void {
  const P = OESTE.parque;
  const p = b.group('parque-cidade', g);
  const m = b.mats;
  const decal = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, z: number, surface: string) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.04, z);
    mesh.receiveShadow = true;
    mesh.userData.noCollision = true;
    mesh.userData.surface = surface;
    mesh.userData.drape = 'deform';
    p.add(mesh);
    return mesh;
  };

  // Lago (espelho d'água raso, com mureta baixa que segura o carro) e a pista de cooper em volta.
  const lake = { x: 1010, z: 2250, rx: 95, rz: 62 };
  flat(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2).scale(lake.rx, 1, lake.rz), m.water, lake.x, lake.z, 'grass');
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.7, 48, 1, true).scale(lake.rx + 1, 1, lake.rz + 1), new THREE.MeshStandardMaterial({ color: 0xd8d4ca, roughness: 0.9, side: THREE.DoubleSide }));
  rim.position.set(lake.x, 0.35, lake.z);
  rim.receiveShadow = true;
  p.add(rim);
  flat(new THREE.RingGeometry(1.12, 1.17, 64).rotateX(-Math.PI / 2).scale(lake.rx, 1, lake.rz), decal(0xc2a078), lake.x, lake.z, 'grass');
  b.occupy(rectOf(lake.x, lake.z, lake.rx * 2 + 4, lake.rz * 2 + 4));

  // Pavilhão de exposições, perto da W3.
  const pav = b.group('pavilhao', p);
  b.box(pav, 90, 10, 46, m.white, 920, 5, 2080);
  b.box(pav, 96, 1, 52, m.concreteDark, 920, 10.5, 2080);
  b.occupy(rectOf(920, 2080, 96, 52, 3));
  b.letreiro(pav, t('fun.pavilhao'), 920, 7.5, 2080 - 23.06, Math.PI, 30, 1.6, { bg: '#1d4f91', fg: '#ffffff' });

  // Parque de diversões: roda-gigante e carrossel, com portal.
  const fx = 1300;
  const fz = 2110;
  buildFerrisWheel(b, p, fx + 40, fz);
  const carousel = b.group('carrossel', p);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 1, 24), new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.6 }));
  base.position.set(fx - 20, 0.5, fz);
  base.castShadow = base.receiveShadow = true;
  carousel.add(base);
  const top = new THREE.Mesh(new THREE.ConeGeometry(10, 4, 16), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 }));
  top.position.set(fx - 20, 6.5, fz);
  top.castShadow = true;
  top.userData.noCollision = true;
  carousel.add(top);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 5), m.metal);
  pole.position.set(fx - 20, 3, fz);
  carousel.add(pole);
  flat(new THREE.PlaneGeometry(130, 80).rotateX(-Math.PI / 2), decal(0xd9c9a6), fx, fz, 'concrete');
  b.occupy(rectOf(fx, fz, 130, 80));
  const gate = b.group('portal-diversoes', p);
  for (const dx of [-12, 12]) b.box(gate, 1.4, 9, 1.4, m.white, fx + dx, 4.5, fz - 42);
  b.letreiro(gate, t('fun.parque'), fx, 8.2, fz - 42.75, Math.PI, 26, 2.4, { bg: '#c0392b', fg: '#fff6e0' });

  // Kartódromo: pista oval de asfalto e uma arquibancada.
  const kx = 1300;
  const kz = 2340;
  const track = flat(new THREE.RingGeometry(26, 36, 48).rotateX(-Math.PI / 2).scale(1.7, 1, 1), m.asphalt, kx, kz, 'asphalt');
  track.material = new THREE.MeshStandardMaterial({ color: 0x3f4043, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const stands = b.group('arquibancada', p);
  b.box(stands, 60, 5, 8, m.concreteDark, kx, 2.5, kz - 46);
  b.occupy(rectOf(kx, kz, 130, 80));
  b.letreiro(stands, t('fun.kart'), kx, 4.2, kz - 50.06, Math.PI, 16, 1.4, { bg: '#2b2b2b', fg: '#f2c94c' });

  // Estacionamentos junto à W3 e quiosques espalhados.
  kit.parking(p, rectOf(1060, 2018, 150, 32), false, 0.7);
  kit.parking(p, rectOf(1420, 2018, 120, 32), false, 0.6);
  const kiosks: THREE.Matrix4[] = [];
  for (let i = 0; i < 18; i++) {
    const x = P.minX + 20 + b.rng() * (P.maxX - P.minX - 40);
    const z = P.minZ + 40 + b.rng() * (P.maxZ - P.minZ - 60);
    if (!b.isRectFree(rectOf(x, z, 8, 8, 2))) continue;
    kiosks.push(placeMatrix(x, 1.4, z, b.rng() * Math.PI));
    b.occupy(rectOf(x, z, 5, 5, 1));
  }
  b.instanced(p, new THREE.BoxGeometry(4, 2.8, 4), m.wood, kiosks, undefined, 'quiosques').userData.cullDistance = 600;

  // Bosques: o parque é verde, mas cheio de árvore (e não um gramado liso).
  for (let i = 0; i < 70; i++) {
    const cx = P.minX + b.rng() * (P.maxX - P.minX);
    const cz = P.minZ + b.rng() * (P.maxZ - P.minZ);
    for (let k = 0; k < 7; k++) b.treeSpots.push({ x: cx + (b.rng() - 0.5) * 36, z: cz + (b.rng() - 0.5) * 36, s: 1 + b.rng() * 0.5 });
  }
  b.landmarks.push({ name: t('place.parque'), x: lake.x, z: lake.z });
  b.address('parque-cidade', formatAddress('SCR', [{ kind: 'lote', v: 11 }]), 1060, 2004);
}

/** Roda-gigante (parada): aro, raios, cabines coloridas e o cavalete em A. Só os pés colidem. */
function buildFerrisWheel(b: CityBuilder, parent: THREE.Object3D, x: number, z: number): void {
  const g = b.group('roda-gigante', parent);
  g.userData.drape = 'rigid'; // a roda não pode entortar com o relevo
  const R = 17;
  const hub = R + 3;
  const steel = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5, metalness: 0.5 });
  const parts: THREE.BufferGeometry[] = [];
  for (const dz of [-1.2, 1.2]) parts.push(new THREE.TorusGeometry(R, 0.25, 6, 48).translate(0, 0, dz));
  for (let i = 0; i < 12; i++) parts.push(new THREE.BoxGeometry(0.18, R, 0.18).translate(0, R / 2, 0).rotateZ((i / 12) * Math.PI * 2));
  const wheel = new THREE.Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed())), steel);
  wheel.position.set(x, hub, z);
  wheel.rotation.y = Math.PI / 2;
  wheel.castShadow = true;
  wheel.userData.noCollision = true;
  g.add(wheel);
  const cabins: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const palette = [0xe0533d, 0x3d8be0, 0xf2c14e, 0x4fb06a, 0x9b59b6];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    cabins.push(placeMatrix(x, hub + Math.sin(a) * R - 1.2, z + Math.cos(a) * R));
    colors.push(new THREE.Color(palette[i % palette.length]));
  }
  const cab = b.instanced(g, new THREE.BoxGeometry(1.8, 1.8, 1.8), b.mats.tinted, cabins, colors, 'roda-cabines');
  cab.userData.noCollision = true;
  for (const dx of [-3, 3])
    for (const dz of [-1, 1]) b.cylinderBetween(g, new THREE.Vector3(x + dx, 0, z + dz * 9), new THREE.Vector3(x + dx * 0.3, hub, z), 0.35, steel);
  b.occupy(rectOf(x, z, 10, 24, 2));
}
