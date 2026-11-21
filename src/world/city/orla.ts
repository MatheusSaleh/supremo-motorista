// Orla (M5 do plano de densificação, docs/PLANO-MAPA.md): Setor de Embaixadas (países FICTÍCIOS), Setor de
// Clubes, UnB (marco real, só como cenário), píeres com barcos na margem norte e o "Pontão" fictício
// ("Cais Candango"): um deque sobre a água com restaurantes, entre a orla dos restaurantes e a Ponte JK.
import * as THREE from 'three';
import { t, type StringKey } from '../../core/i18n';
import { formatAddress, sectorName } from '../../data/addresses';
import { placeMatrix, rectOf, type CityBuilder, type Rect } from './builder';
import { AIRPORT, LAKE, ORLA, ROAD } from './layout';
import { flagMaterial } from './materials';
import { palmCrownGeometry } from './marcos';
import type { CityKit, FacadeStyle } from './quadras';

const COUNTRIES = 12;
const CLUBS = 8;
/** Cores de bandeira (fundo, faixa) das embaixadas fictícias, na ordem de country.N. */
const FLAG_COLORS: [number, number][] = [
  [0x1f5aa6, 0xf2c94c],
  [0xffffff, 0x2a6fdb],
  [0xe8a33d, 0x7a1f2b],
  [0x2e7d32, 0xffffff],
  [0x3b2a6b, 0xd9d9d9],
  [0x00a6a6, 0xffd166],
  [0xc0392b, 0x1d1d1d],
  [0x6d8f3a, 0xf3efe0],
  [0x0b3d5c, 0x6fc2e8],
  [0x8fb3d9, 0x1d2a33],
  [0xf2c94c, 0x2e7d32],
  [0x5b6770, 0xf3f1ea],
];

export function buildOrla(b: CityBuilder, kit: CityKit): void {
  const g = b.group('orla', kit.group);
  const O = ORLA;
  const E = O.embaixadas;

  // --- Vias -------------------------------------------------------------------------
  // Via das embaixadas (entre a 2ª e a 3ª fileira), ligando as transversais de ±1500 e a via do aeroporto.
  b.road(g, 'local', 806, E.roadZ, AIRPORT.roadX, E.roadZ, 'right');
  b.road(g, 'local', AIRPORT.roadX, E.roadZ, 2250, E.roadZ, 'right');
  b.road(g, 'local', -806, E.roadZ, O.unb.maxX + 20, E.roadZ, 'right');
  // UnB: via do fundo do campus (separa a universidade dos clubes) até o limite oeste.
  b.road(g, 'local', -806, O.unb.roadZ, -2250, O.unb.roadZ, 'right');

  // --- Embaixadas -----------------------------------------------------------------------
  let country = 0;
  for (const [wing, span] of [
    ['S', E.sul],
    ['N', E.norte],
  ] as const) {
    let lote = 1;
    for (const row of E.rows) {
      for (let x = span.minX; x + E.lotW <= span.maxX; ) {
        const r = { minX: x, maxX: x + E.lotW, minZ: row.minZ, maxZ: row.maxZ };
        if (!b.isRectFree(r)) {
          x += 10;
          continue;
        }
        buildEmbassy(b, kit, g, r, row.dir, country++ % COUNTRIES, wing, lote++);
        x += E.lotW + 14;
      }
    }
    const c = { x: (span.minX + span.maxX) / 2, z: (E.rows[0].minZ + E.rows[2].maxZ) / 2 };
    b.landmarks.push({ name: t(wing === 'S' ? 'place.embaixadasSul' : 'place.embaixadasNorte'), ...c , minor: true });
  }

  // --- Clubes ------------------------------------------------------------------------------
  let club = 0;
  for (const [wing, r0] of [
    ['S', O.clubes.sul],
    ['N', O.clubes.norte],
  ] as const) {
    let lote = 1;
    for (let x = r0.minX; x + O.clubes.lotW <= r0.maxX; ) {
      const r = { minX: x, maxX: x + O.clubes.lotW, minZ: r0.minZ, maxZ: r0.maxZ };
      if (!b.isRectFree(r)) {
        x += 10;
        continue;
      }
      buildClub(b, kit, g, r, club++ % CLUBS, wing, lote++);
      x += O.clubes.lotW + 16;
    }
    b.landmarks.push({ name: t(wing === 'S' ? 'place.clubesSul' : 'place.clubesNorte'), x: (r0.minX + r0.maxX) / 2, z: (r0.minZ + r0.maxZ) / 2 , minor: true });
  }

  buildUnb(b, kit, g);
  buildPiers(b, g);
  buildPontao(b, kit, g);
}

// ---------------------------------------------------------------------------------------------
// Embaixadas
// ---------------------------------------------------------------------------------------------

/**
 * Embaixada: lote murado com portão na frente (lado `dir` da via), guarita, mastro com a bandeira do país
 * fictício, o prédio principal (um de cinco tipos), estacionamento e árvores.
 */
function buildEmbassy(b: CityBuilder, kit: CityKit, parent: THREE.Object3D, r: Rect, dir: 1 | -1, country: number, wing: 'N' | 'S', lote: number): void {
  const g = b.group('embaixada', parent);
  const m = b.mats;
  const cx = (r.minX + r.maxX) / 2;
  const depth = r.maxZ - r.minZ;
  const front = dir > 0 ? r.maxZ : r.minZ;
  const Z = (d: number) => front - dir * d;
  const yaw = dir > 0 ? 0 : Math.PI;

  // Muro (1,8 m) com portão de 16 m no meio da frente.
  const inset = 3;
  const wx0 = r.minX + inset;
  const wx1 = r.maxX - inset;
  const wz0 = Z(inset);
  const wz1 = Z(depth - inset);
  const wall = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const box = b.box(g, x0 === x1 ? 0.4 : len, 1.8, x0 === x1 ? len : 0.4, m.white, (x0 + x1) / 2, 0.9, (z0 + z1) / 2);
    box.userData.cullDistance = 700;
  };
  wall(wx0, wz0, cx - 8, wz0);
  wall(cx + 8, wz0, wx1, wz0);
  wall(wx0, wz1, wx1, wz1);
  wall(wx0, wz0, wx0, wz1);
  wall(wx1, wz0, wx1, wz1);
  b.box(g, 4, 3, 4, m.concrete, cx + 12, 1.5, Z(inset + 4)); // guarita

  // Prédio principal.
  const kind = Math.floor(b.rng() * 5);
  const by = Z(Math.min(depth * 0.55, 110));
  const styles: FacadeStyle[] = ['brise', 'vidroAzul', 'pastilha', 'vidroVerde', 'vidroEscuro'];
  if (kind === 0) kit.building(g, cx, by, 50, 22, 3, 'brise');
  else if (kind === 1) kit.building(g, cx, by, 36, 30, 4, styles[1 + Math.floor(b.rng() * 4)]);
  else if (kind === 2) {
    // Pavilhão baixo com telhado de duas águas.
    b.box(g, 52, 6, 24, m.white, cx, 3, by);
    for (const s of [-1, 1]) {
      const roof = b.box(g, 56, 0.6, 15, m.concreteDark, cx, 8, by + s * 6.5);
      roof.rotation.x = s * 0.38;
    }
    b.occupy(rectOf(cx, by, 56, 28, 3));
  } else if (kind === 3) {
    // Pátio em U.
    kit.building(g, cx, by - dir * 14, 56, 14, 2, 'pastilha');
    for (const s of [-1, 1]) kit.building(g, cx + s * 21, by + dir * 6, 14, 26, 2, 'pastilha');
  } else kit.building(g, cx, by, 26, 26, 6, 'vidroVerde');

  // Mastro e bandeira (fictícia) no jardim da frente.
  const [bg, accent] = FLAG_COLORS[country];
  const name = t(`country.${country + 1}` as StringKey);
  b.box(g, 0.25, 12, 0.25, m.metal, cx - 18, 6, Z(18));
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.4), flagMaterial(bg, accent, name.slice(0, 3).toUpperCase()));
  flag.position.set(cx - 18 + 2.1, 10.6, Z(18));
  flag.rotation.y = yaw;
  flag.userData.noCollision = true;
  flag.userData.noBatch = true;
  flag.userData.cullDistance = 350;
  g.add(flag);
  // Placa no muro, ao lado do portão.
  b.letreiro(g, t('embassy.plaque', { pais: name }), cx - 20, 1.1, wz0 + dir * 0.25, yaw, 12, 0.9, { bg: '#2b2e33', fg: '#e8e4da' }).userData.cullDistance = 250;

  kit.parking(g, rectOf(cx + 28, Z(inset + 24), 36, 16), false, 0.5);
  for (let x = wx0 + 6; x <= wx1 - 6; x += 14) b.treeSpots.push({ x, z: Z(depth - inset - 6), s: 1 + b.rng() * 0.4 });
  for (let d = 30; d < depth - 12; d += 16) for (const x of [wx0 + 5, wx1 - 5]) b.treeSpots.push({ x, z: Z(d), s: 0.9 + b.rng() * 0.4 });
  b.address(`sed-${wing}${lote}`, formatAddress('SED', [{ kind: 'quadra', v: 800 + Math.ceil(lote / 6) }, { kind: 'lote', v: lote }], wing), cx, Z(-2));
}

// ---------------------------------------------------------------------------------------------
// Clubes (de frente para a avenida da orla, em −Z)
// ---------------------------------------------------------------------------------------------

function buildClub(b: CityBuilder, kit: CityKit, parent: THREE.Object3D, r: Rect, club: number, wing: 'N' | 'S', lote: number): void {
  const g = b.group('clube', parent);
  const m = b.mats;
  const cx = (r.minX + r.maxX) / 2;
  const w = r.maxX - r.minX;
  const depth = r.maxZ - r.minZ;
  const Z = (d: number) => r.minZ + d; // a frente fica na avenida da orla (z menor)
  const name = t(`club.${club + 1}` as StringKey);

  kit.parking(g, rectOf(cx, Z(20), w - 20, 32), false, 0.55);
  const h = kit.building(g, cx - 20, Z(62), 60, 18, 2, 'pastilha');
  b.letreiro(g, name, cx - 20, h - 1.6, Z(62) - 9.08, Math.PI, 28, 1.6, { bg: '#0f4c6b', fg: '#ffffff' }).userData.cullDistance = 400;
  // Piscinas sobre um deque claro.
  b.slab(g, rectOf(cx - 10, Z(104), 70, 34), 0.12, m.plaza);
  for (const [dx, pw] of [
    [-24, 25],
    [10, 34],
  ]) {
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(pw, 14).rotateX(-Math.PI / 2), m.pool);
    pool.position.set(cx - 10 + dx, 0.2, Z(104));
    pool.userData.noCollision = true;
    pool.userData.drape = 'deform';
    g.add(pool);
  }
  b.occupy(rectOf(cx - 10, Z(104), 70, 34));
  // Quadras de tênis/poliesportivas e, nos lotes fundos, um campo de futebol.
  for (const dx of [-60, -30, 0]) kit.court(g, cx + dx + 35, Z(150));
  b.occupy(rectOf(cx + 5, Z(150), 90, 38));
  if (depth > 290) {
    const field = new THREE.Mesh(new THREE.PlaneGeometry(56, 96).rotateX(-Math.PI / 2), fieldMaterial());
    field.position.set(cx, 0.05, Z(240));
    field.receiveShadow = true;
    field.userData.noCollision = true;
    field.userData.surface = 'grass';
    field.userData.drape = 'deform';
    g.add(field);
    b.occupy(rectOf(cx, Z(240), 60, 100));
  }
  for (let d = 40; d < depth - 6; d += 15) for (const x of [r.minX + 4, r.maxX - 4]) b.treeSpots.push({ x, z: Z(d), s: 1 + b.rng() * 0.4 });
  b.address(`scl-${wing}${lote}`, formatAddress('SCL', [{ kind: 'trecho', v: wing === 'S' ? 2 : 1 }, { kind: 'lote', v: lote }], wing), cx, Z(2));
}

let fieldMat: THREE.MeshStandardMaterial | null = null;
/** Campo de futebol: gramado mais escuro com as linhas brancas. */
function fieldMaterial(): THREE.MeshStandardMaterial {
  if (fieldMat) return fieldMat;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 224;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#3f8a3a' : '#468f40';
    ctx.fillRect(0, i * 28, 128, 28);
  }
  ctx.strokeStyle = '#f3f3f3';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, 116, 212);
  ctx.beginPath();
  ctx.moveTo(6, 112);
  ctx.lineTo(122, 112);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(64, 112, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(34, 6, 60, 28);
  ctx.strokeRect(34, 190, 60, 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  fieldMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return fieldMat;
}

// ---------------------------------------------------------------------------------------------
// UnB
// ---------------------------------------------------------------------------------------------

/**
 * Campus da UnB: o "Minhocão" (duas alas longas e baixas, levemente curvas, com jardim no meio), a biblioteca
 * em degraus, a reitoria com rampa, um pavilhão redondo, o restaurante universitário, o centro esportivo e
 * os estacionamentos enormes.
 */
function buildUnb(b: CityBuilder, kit: CityKit, parent: THREE.Object3D): void {
  const U = ORLA.unb;
  const g = b.group('unb', parent);
  const m = b.mats;

  // Minhocão: segmentos de 48 m ao longo de Z, deslocados em X para formar um arco suave.
  const R = 1400;
  const cxArc = -1900;
  for (let z = -1090; z <= -420; z += 50) {
    const dz = z - -755;
    const off = R - Math.sqrt(R * R - dz * dz);
    for (const s of [-1, 1]) kit.building(g, cxArc + off + s * 17, z, 14, 48, 2, 'brise');
  }
  b.landmarks.push({ name: t('place.unb'), x: cxArc, z: -755 });
  b.letreiro(g, t('place.unb'), cxArc + 24.1, 6.2, -430, Math.PI / 2, 14, 2.4, { bg: '#1d4f91', fg: '#ffffff' });

  // Biblioteca em degraus, reitoria com rampa, pavilhão redondo e restaurante universitário.
  kit.building(g, -1680, -820, 80, 60, 3, 'brise');
  kit.building(g, -1680, -820, 60, 44, 5, 'brise');
  kit.building(g, -1680, -1040, 50, 36, 4, 'pastilha');
  b.wedge(g, 'x', -1655, -1625, 6, 0, -1040, 6, m.concrete);
  const round = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 8, 32), m.white);
  round.position.set(-2120, 4, -420);
  round.castShadow = round.receiveShadow = true;
  round.userData.collider = 'convex';
  g.add(round);
  b.occupy(rectOf(-2120, -420, 46, 46, 3));
  kit.building(g, -2110, -640, 60, 30, 2, 'pastilha');

  // Centro esportivo: campo e quadras.
  const field = new THREE.Mesh(new THREE.PlaneGeometry(56, 96).rotateX(-Math.PI / 2), fieldMaterial());
  field.position.set(-2150, 0.05, -930);
  field.userData.noCollision = true;
  field.userData.surface = 'grass';
  field.userData.drape = 'deform';
  g.add(field);
  b.occupy(rectOf(-2150, -930, 60, 100));
  for (const z of [-1060, -1100]) for (const x of [-2190, -2160, -2130]) kit.court(g, x, z);
  b.occupy(rectOf(-2160, -1080, 96, 80));

  // Institutos e faculdades (genéricos, sem nome) espalhados pelo campus, com folga entre eles.
  kit.fillSector(g, U, {
    cell: [150, 140],
    foot: [
      [54, 20],
      [40, 30],
      [64, 16],
    ],
    floors: [2, 4],
    styles: ['brise', 'pastilha', 'brise'],
    sector: 'SUB',
    wing: 'N',
    prefix: 'sub-N',
    counter: { n: 0 },
    quadra: 2,
    parkingFill: 0.6,
  });

  // Estacionamentos (a UnB é famosa por eles) e bosques entre os prédios.
  for (const [x, z, w, d] of [
    [-1790, -620, 60, 130],
    [-1790, -930, 60, 130],
    [-2010, -760, 60, 200],
    [-1610, -600, 80, 64],
  ]) kit.parking(g, rectOf(x, z, w, d), true, 0.65);
  for (let i = 0; i < 40; i++) {
    const cx = U.minX + b.rng() * (U.maxX - U.minX);
    const cz = U.minZ + b.rng() * (U.maxZ - U.minZ);
    for (let k = 0; k < 5; k++) b.treeSpots.push({ x: cx + (b.rng() - 0.5) * 30, z: cz + (b.rng() - 0.5) * 30, s: 1 + b.rng() * 0.5 });
  }
  b.address('unb-icc', formatAddress('SUB', [{ kind: 'quadra', v: 1 }, { kind: 'bloco', v: 'A' }], 'N'), cxArc + 40, -755);
  b.signs.push({ x: U.maxX + 30, z: -300 - ROAD.main / 2 - 4, yaw: Math.PI, title: 'SUB · UnB', subtitle: sectorName('SUB') });
}

// ---------------------------------------------------------------------------------------------
// Píeres, barcos e o "Pontão"
// ---------------------------------------------------------------------------------------------

/** Píeres de madeira saindo do calçadão, com barcos atracados dos dois lados. */
function buildPiers(b: CityBuilder, parent: THREE.Object3D): void {
  const g = b.group('pieres', parent);
  g.userData.noDrape = true; // sobre a água (o relevo na margem é zero)
  const m = b.mats;
  const hulls: THREE.Matrix4[] = [];
  const cabins: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const palette = [0xffffff, 0xffffff, 0xf2f2ee, 0x1f5aa6, 0xc0392b, 0x2e7d32];
  for (const x of ORLA.piers) {
    const len = 54;
    const deck = b.box(g, 5, 0.5, len, m.wood, x, -0.15, LAKE.shoreZ - len / 2 + 2);
    deck.userData.surface = 'wood';
    for (let z = LAKE.shoreZ - 6; z > LAKE.shoreZ - len; z -= 12) for (const s of [-1, 1]) b.box(g, 0.35, 4, 0.35, m.wood, x + s * 2.2, -2.3, z);
    for (let z = LAKE.shoreZ - 12; z > LAKE.shoreZ - len + 4; z -= 11) {
      for (const s of [-1, 1]) {
        if (b.rng() < 0.25) continue;
        const yaw = Math.PI / 2 + (b.rng() - 0.5) * 0.1;
        hulls.push(placeMatrix(x + s * 7, LAKE.waterLevel + 0.3, z, yaw));
        cabins.push(placeMatrix(x + s * 7 + (b.rng() - 0.5), LAKE.waterLevel + 1.2, z, yaw));
        colors.push(new THREE.Color(palette[Math.floor(b.rng() * palette.length)]));
      }
    }
  }
  const hull = b.instanced(g, new THREE.BoxGeometry(2.6, 1, 7.5), m.tinted, hulls, colors, 'barcos');
  hull.userData.noCollision = true;
  hull.userData.cullDistance = 600;
  const cabin = b.instanced(g, new THREE.BoxGeometry(2, 1, 3), m.white, cabins, undefined, 'barcos-cabine');
  cabin.userData.noCollision = true;
  cabin.userData.cullDistance = 400;
}

/**
 * "Pontão" fictício (Cais Candango): deque largo sobre a água, colado ao calçadão, com restaurantes,
 * palmeiras e guarda-corpo; estacionamento entre a avenida e o calçadão.
 */
function buildPontao(b: CityBuilder, kit: CityKit, parent: THREE.Object3D): void {
  const P = ORLA.pontao;
  const g = b.group('pontao', parent);
  g.userData.noDrape = true;
  const m = b.mats;
  const w = P.maxX - P.minX;
  const cx = (P.minX + P.maxX) / 2;
  const z0 = LAKE.shoreZ + 2;
  const dz = z0 - P.deckMinZ;
  const cz = (z0 + P.deckMinZ) / 2;
  // Deque maciço do fundo do lago até 0,5 m (colide como caixa).
  const deck = b.box(g, w, 5, dz, m.wood, cx, 0.5 - 2.5, cz, 'pontao-deque');
  deck.userData.surface = 'wood';
  deck.castShadow = false;
  // Guarda-corpo na borda da água e nas laterais.
  b.box(g, w, 1, 0.3, m.white, cx, 1, P.deckMinZ + 0.15);
  for (const x of [P.minX + 0.15, P.maxX - 0.15]) b.box(g, 0.3, 1, dz, m.white, x, 1, cz);
  // Restaurantes (casas brancas com toldo e letreiro voltado para o calçadão).
  const awnings = [0xd94f3d, 0x2f7fc1, 0xe0a030, 0x3c9d5d, 0x8e5bb0];
  for (let i = 0; i < 5; i++) {
    const x = P.minX + 40 + i * ((w - 80) / 4);
    const z = P.deckMinZ + 20;
    b.box(g, 26, 5, 14, m.white, x, 0.5 + 2.5, z);
    const awn = b.box(g, 28, 0.3, 5, new THREE.MeshStandardMaterial({ color: awnings[i], roughness: 0.8 }), x, 0.5 + 4.6, z + 9);
    awn.userData.noCollision = true;
    b.letreiro(g, t(`pontao.${i + 1}` as StringKey), x, 0.5 + 6.2, z + 7.06, 0, 16, 2.2, { bg: '#1d2a33', fg: '#ffe9b0' }).userData.cullDistance = 400;
  }
  // Palmeiras ao longo da borda.
  const palms: THREE.Matrix4[] = [];
  for (let x = P.minX + 12; x <= P.maxX - 12; x += 18) palms.push(placeMatrix(x, 0.5, P.deckMinZ + 4, b.rng() * Math.PI * 2, 1 + b.rng() * 0.2));
  const trunks = b.instanced(g, new THREE.CylinderGeometry(0.2, 0.3, 8, 6, 1, true).translate(0, 4, 0), new THREE.MeshStandardMaterial({ color: 0x7b6a55, roughness: 1 }), palms, undefined, 'pontao-palmeiras');
  trunks.userData.collider = 'pole';
  trunks.userData.poleRadius = 0.3;
  trunks.userData.cameraIgnore = true;
  const crowns = b.instanced(g, palmCrownGeometry(), new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.9, side: THREE.DoubleSide }), palms, undefined, 'pontao-copas');
  crowns.userData.noCollision = true;
  // Portal com o nome, na entrada pelo calçadão.
  for (const dx of [-9, 9]) b.box(g, 1, 7, 1, m.white, cx + dx, 0.5 + 3.5, z0 - 3);
  b.letreiro(g, t('place.pontao'), cx, 0.5 + 6.4, z0 - 2.4, 0, 17, 2, { bg: '#0f4c6b', fg: '#ffffff' });
  b.occupy({ minX: P.minX, maxX: P.maxX, minZ: P.deckMinZ, maxZ: z0 });

  // Estacionamento entre a avenida e o calçadão (fora do deque, então acompanha o relevo).
  kit.parking(parent, { minX: P.minX + 10, maxX: P.maxX - 10, minZ: LAKE.shoreRoadZ - ROAD.main / 2 - 20, maxZ: LAKE.shoreRoadZ - ROAD.main / 2 - 4 }, false, 0.7, 1);
  b.landmarks.push({ name: t('place.pontao'), x: cx, z: cz });
  b.address('pontao', formatAddress('SRL', [{ kind: 'trecho', v: 3 }, { kind: 'lote', v: 1 }]), cx, z0 + 6);
}
