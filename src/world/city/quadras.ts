// Kit de construção da cidade densa (docs/PLANO-MAPA.md): superquadras com blocos sobre pilotis,
// estacionamentos com carros parados, comércio local entre quadras e lotes institucionais (igreja, escola,
// posto, hospital, sede, clube). Cada região chama os geradores; as peças repetidas vão para listas de
// matrizes e viram InstancedMesh (em blocos espaciais) uma vez só, em flush().
//
// Convenções de colisão (ver World): caixas instanciadas → cuboides (a altura vai na matriz, nunca na
// geometria); pilares → 'pole'; o resto colide pela malha.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { t, type StringKey } from '../../core/i18n';
import { BLOCK_LETTERS, SHOP_KEYS, formatAddress, type SectorId } from '../../data/addresses';
import { instancedChunked, placeMatrix, rectOf, type CityBuilder, type Rect } from './builder';
import { canvasTexture, createGlassFacadeTexture } from './materials';

/** Distâncias de desenho (m, qualidade média) das peças pequenas. */
/** Prédios e blocos: de longe a neblina já os apaga; o corte poupa draw calls e triângulos. */
const DRAW = { buildings: 1500, blocks: 1400, ground: 650, cars: 380, pillars: 380, small: 320, signs: 350 };

/** Comprimento da geometria base dos blocos (m); cada bloco escala a partir dela. */
const BLOCK_BASE_LEN = 72;
/** Altura livre dos pilotis (m). */
const PILOTIS = 3;
/** Pé-direito por andar (m). */
const FLOOR = 3;

type Entry = 'minZ' | 'maxZ' | 'minX' | 'maxX';

export interface SuperquadraSpec {
  cx: number;
  cz: number;
  size: number;
  floors: 3 | 6;
  /** Lado por onde entra a rua de acesso (a via fica do lado de fora). */
  entry: Entry;
  /** Coordenada (Z, ou X se a entrada é por −X) do eixo da via de onde sai a rua de acesso. */
  access: number;
  wing: 'N' | 'S';
  number: number;
}

/** Bloco: centro local (u ao longo de X, v ao longo de Z, entrada em v = −S/2) e orientação. */
const BLOCK_SLOTS: { u: number; v: number; alongV: boolean }[] = [
  { u: -70, v: -80, alongV: false },
  { u: 70, v: -80, alongV: false },
  { u: -105, v: -20, alongV: true },
  { u: 105, v: -20, alongV: true },
  { u: -45, v: 10, alongV: false },
  { u: 45, v: 10, alongV: false },
  { u: -70, v: 60, alongV: false },
  { u: 70, v: 60, alongV: false },
  { u: -40, v: 105, alongV: false },
  { u: 40, v: 105, alongV: false },
];

/** Tons das pastilhas (multiplicam a fachada clara). */
const FACADE_TINTS = ['#ece4d2', '#cfdde4', '#ecd9b8', '#cfdcc2', '#f2ece2', '#e6cfc4'];
const CAR_COLORS = [0xf2f2f2, 0xf2f2f2, 0xc9ccd0, 0xc9ccd0, 0x2b2d31, 0x8d9196, 0x9e1c1c, 0x23446e, 0x5b6b4a, 0xd8cfb8];

export class CityKit {
  private readonly blocks = new Map<string, { geo: THREE.BoxGeometry; mat: THREE.Material[]; list: THREE.Matrix4[]; colors: THREE.Color[] }>();
  private readonly pillars: THREE.Matrix4[] = [];
  private readonly lobbies: THREE.Matrix4[] = [];
  private readonly cars: { m: THREE.Matrix4; color: THREE.Color }[] = [];
  private readonly shops = new Map<string, { geo: THREE.BoxGeometry; list: THREE.Matrix4[] }>();
  private readonly posts: THREE.Matrix4[] = [];
  private readonly houses: { m: THREE.Matrix4; color: THREE.Color }[] = [];
  private readonly houseRoofs: THREE.Matrix4[] = [];
  private readonly mats: ReturnType<typeof kitMaterials>;
  readonly group: THREE.Group;
  private shopSign = 0;
  private signIndex = 0;

  constructor(private readonly b: CityBuilder) {
    this.mats = kitMaterials();
    this.group = b.group('cidade-densa');
  }

  // ---------------------------------------------------------------------------
  // Superquadra
  // ---------------------------------------------------------------------------

  superquadra(q: SuperquadraSpec, parent: THREE.Object3D = this.group): void {
    const b = this.b;
    const k = q.size / 250;
    const half = q.size / 2;
    const len = Math.round(72 * k);
    const height = q.floors * FLOOR;
    const tint = Math.floor(b.rng() * FACADE_TINTS.length);
    const toWorld = (u: number, v: number) => {
      if (q.entry === 'minZ') return { x: q.cx + u, z: q.cz + v };
      if (q.entry === 'maxZ') return { x: q.cx + u, z: q.cz - v };
      if (q.entry === 'minX') return { x: q.cx + v, z: q.cz + u };
      return { x: q.cx - v, z: q.cz - u };
    };
    /** O eixo local v vira X do mundo quando a entrada é por −X. */
    const vIsX = q.entry === 'minX' || q.entry === 'maxX';
    const rect = (u: number, v: number, du: number, dv: number): Rect => {
      const p = toWorld(u, v);
      return vIsX ? rectOf(p.x, p.z, dv, du) : rectOf(p.x, p.z, du, dv);
    };

    // Rua de acesso: entra pela borda, sobe até o meio da quadra e abre num "T" de serviço.
    const stemEnd = 33 * k;
    const c = toWorld(0, stemEnd);
    const a = vIsX ? { x: q.access, z: q.cz } : { x: q.cx, z: q.access };
    b.road(parent, 'local', a.x, a.z, c.x, c.z, 'none');
    const t1 = toWorld(-62 * k, stemEnd);
    const t2 = toWorld(62 * k, stemEnd);
    b.road(parent, 'local', t1.x, t1.z, t2.x, t2.z, 'none');

    // Um bloco a menos em algumas quadras: no lugar, parquinho (a quadra não fica idêntica às vizinhas).
    const skip = b.rng() < 0.35 ? 6 + Math.floor(b.rng() * 4) : -1;
    BLOCK_SLOTS.forEach((s, i) => {
      const u = s.u * k;
      const v = s.v * k;
      if (i === skip) {
        this.playground(parent, rect(u, v, 24, 24));
        return;
      }
      const p = toWorld(u, v);
      const alongZ = s.alongV !== vIsX; // comprimento do bloco ao longo de Z do mundo?
      this.pilotisBlock(p.x, p.z, len, height, alongZ, tint);
      // Estacionamento na frente do bloco (lado da entrada da quadra): faixa de vagas + corredor.
      const front = s.alongV ? { u: u - Math.sign(u) * 14, v } : { u, v: v - 14 };
      const pr = s.alongV ? rect(front.u, front.v, 12, len) : rect(front.u, front.v, len, 12);
      const parkAlongZ = (pr.maxZ - pr.minZ) > (pr.maxX - pr.minX);
      this.parking(parent, pr, parkAlongZ, 0.6, 1);
      const addr = toWorld(front.u + (s.alongV ? -Math.sign(u) * 3 : 0), front.v + (s.alongV ? 0 : -3));
      const letter = BLOCK_LETTERS[i];
      b.address(`sqb-${q.wing}${q.number}-${letter}`, formatAddress('SQB', [{ kind: 'raw', v: String(q.number) }, { kind: 'bloco', v: letter }], q.wing), addr.x, addr.z);
    });

    // Escola-classe num canto (2 andares e quadra de esportes).
    const school = rect(105 * k, 100 * k, 26, 34);
    const sc = { x: (school.minX + school.maxX) / 2, z: (school.minZ + school.maxZ) / 2 };
    b.box(parent, school.maxX - school.minX, 7, school.maxZ - school.minZ, this.mats.school, sc.x, 3.5, sc.z).userData.surface = 'concrete';
    b.occupy({ minX: school.minX - 2, maxX: school.maxX + 2, minZ: school.minZ - 2, maxZ: school.maxZ + 2 });

    // Cinturão de árvores no perímetro (as quadras de Brasília são cercadas de verde), com a abertura da rua.
    for (let s = -half + 8; s <= half - 8; s += 13) {
      for (const inset of [10]) {
        for (const [u, v] of [
          [s, -half + inset],
          [s, half - inset],
          [-half + inset, s],
          [half - inset, s],
        ]) {
          if (Math.abs(u) < 14 && v < 0) continue; // entrada
          const p = toWorld(u + (b.rng() - 0.5) * 3, v + (b.rng() - 0.5) * 3);
          b.treeSpots.push({ x: p.x, z: p.z, s: 0.9 + b.rng() * 0.5 });
        }
      }
    }
    const signAt = toWorld(22, -half - 4);
    b.signs.push({ x: signAt.x, z: signAt.z, yaw: q.entry === 'minX' ? -Math.PI / 2 : q.entry === 'maxX' ? Math.PI / 2 : q.entry === 'minZ' ? Math.PI : 0, title: `SQB-${q.wing} ${q.number}`, subtitle: t('sector.SQB') });
  }

  /** Bloco residencial sobre pilotis: laje de andares, pilares e a portaria envidraçada no meio. */
  pilotisBlock(x: number, z: number, len: number, height: number, alongZ: boolean, tint: number): void {
    const depth = 12;
    // Uma geometria por altura (72 m, esticada pela escala da instância): todos os tamanhos de quadra
    // compartilham as mesmas draw calls. A colisão usa os parâmetros da caixa × a escala. A base é 72 m (e
    // não 1 m) porque o three calcula a esfera envolvente pela maior escala: com 1 m, cada bloco espacial
    // ficava com ~900 m de raio e nunca saía do quadro nem do passe de sombra.
    const key = `${height}`;
    let entry = this.blocks.get(key);
    if (!entry) {
      const facade = this.mats.facade(height / FLOOR);
      const m = this.b.mats;
      // Grupos da caixa reagrupados por material (empenas, cobertura, laje de baixo, fachadas): 4 draw
      // calls por bloco espacial em vez de 6. A ordem dos índices da BoxGeometry é +X, −X, +Y, −Y, +Z, −Z.
      const geo = new THREE.BoxGeometry(BLOCK_BASE_LEN, height, depth);
      geo.clearGroups();
      geo.addGroup(0, 12, 0);
      geo.addGroup(12, 6, 1);
      geo.addGroup(18, 6, 2);
      geo.addGroup(24, 12, 3);
      entry = { geo, mat: [m.concrete, m.roof, m.concreteDark, facade], list: [], colors: [] };
      this.blocks.set(key, entry);
    }
    const yaw = alongZ ? Math.PI / 2 : 0;
    entry.list.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, PILOTIS + height / 2, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
        new THREE.Vector3(len / BLOCK_BASE_LEN, 1, 1),
      ),
    );
    entry.colors.push(new THREE.Color(FACADE_TINTS[tint]));
    this.lobbies.push(placeMatrix(x, (PILOTIS - 0.1) / 2, z, yaw));
    const n = Math.max(2, Math.round(len / 9));
    for (let i = 0; i < n; i++) {
      const a = -len / 2 + 2 + (i * (len - 4)) / (n - 1);
      for (const s of [-1, 1]) {
        const lx = a;
        const lz = s * (depth / 2 - 1.2);
        const wx = alongZ ? x + lz : x + lx;
        const wz = alongZ ? z + lx : z + lz;
        this.pillars.push(placeMatrix(wx, -1.5, wz));
      }
    }
    this.b.occupy(alongZ ? rectOf(x, z, depth, len, 3) : rectOf(x, z, len, depth, 3));
  }

  playground(parent: THREE.Object3D, r: Rect): void {
    const b = this.b;
    const sand = new THREE.Mesh(planeXZ(r.maxX - r.minX, r.maxZ - r.minZ), this.mats.sand);
    sand.position.set((r.minX + r.maxX) / 2, 0.04, (r.minZ + r.maxZ) / 2);
    sand.receiveShadow = true;
    sand.userData.noCollision = true;
    sand.userData.surface = 'grass';
    sand.userData.drape = 'deform';
    parent.add(sand);
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const g = b.group('parquinho', parent);
    b.box(g, 3, 2.4, 3, this.mats.toyRed, cx - 5, 1.2, cz - 4);
    b.box(g, 1, 3.2, 6, this.mats.toyYellow, cx + 4, 1.6, cz + 2);
    b.box(g, 4, 0.5, 1.2, this.mats.toyBlue, cx - 3, 1.6, cz + 5);
    b.occupy(r);
  }

  // ---------------------------------------------------------------------------
  // Estacionamento
  // ---------------------------------------------------------------------------

  /**
   * Estacionamento com vagas pintadas (módulos de 16 m: vaga 5 + corredor 6 + vaga 5) e carros parados.
   * `alongZ`: os corredores correm ao longo de Z. `rows` = 1 → só uma fileira de vagas (faixa estreita).
   */
  parking(parent: THREE.Object3D, r: Rect, alongZ: boolean, fill = 0.55, rows: 1 | 2 = 2): void {
    const b = this.b;
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const along = alongZ ? d : w; // comprimento ao longo dos corredores
    const across = alongZ ? w : d;
    const geo = planeXZ(along, across);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (along / 10), uv.getY(i) * (across / 16));
    if (alongZ) geo.rotateY(Math.PI / 2);
    const lot = new THREE.Mesh(geo, this.mats.parking);
    lot.position.set((r.minX + r.maxX) / 2, 0.03, (r.minZ + r.maxZ) / 2);
    lot.receiveShadow = true;
    lot.userData.noCollision = true;
    lot.userData.surface = 'asphalt';
    lot.userData.drape = 'deform';
    lot.name = 'estacionamento';
    lot.userData.cullDistance = DRAW.ground;
    parent.add(lot);

    // Fileiras de vagas: a 2,5 m e a 13,5 m do início de cada módulo (só a primeira se rows = 1).
    const offsets: number[] = [];
    for (let m = 0; m * 16 < across - 4; m++) {
      offsets.push(m * 16 + 2.5);
      if (rows === 2 && m * 16 + 13.5 < across) offsets.push(m * 16 + 13.5);
    }
    for (const c of offsets) {
      for (let a = 1.25; a < along - 1; a += 2.5) {
        if (b.rng() > fill) continue;
        // (a, c) no plano do estacionamento → mundo. O "início" de `across` é o lado de baixo (min).
        const x = alongZ ? r.minX + c : r.minX + a;
        const z = alongZ ? r.minZ + a : r.minZ + c;
        const yaw = (alongZ ? Math.PI / 2 : 0) + (b.rng() < 0.5 ? Math.PI : 0) + (b.rng() - 0.5) * 0.08;
        const color = new THREE.Color(CAR_COLORS[Math.floor(b.rng() * CAR_COLORS.length)]);
        this.cars.push({ m: placeMatrix(x, 0.75, z, yaw), color });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Comércio local (entre quadras)
  // ---------------------------------------------------------------------------

  /** Faixa de comércio ao longo de Z: dois prédios de 2 andares de cada lado de um calçadão. */
  comercio(parent: THREE.Object3D, cx: number, minZ: number, maxZ: number, wing: 'N' | 'S', label: string): void {
    const b = this.b;
    const span = maxZ - minZ;
    const n = span > 160 ? 2 : 1;
    const len = (span - (n - 1) * 20) / n;
    const key = `${len.toFixed(1)}`;
    let entry = this.shops.get(key);
    if (!entry) this.shops.set(key, (entry = { geo: box3Groups(10, 8, len), list: [] }));
    let letter = 0;
    for (let i = 0; i < n; i++) {
      const z = minZ + len / 2 + i * (len + 20);
      for (const s of [-1, 1]) {
        const x = cx + s * 11;
        entry.list.push(placeMatrix(x, 4, z));
        b.occupy(rectOf(x, z, 10, len, 2));
        // Letreiro na fachada de fora (virada para a quadra vizinha) e o endereço na calçada.
        const name = t(SHOP_KEYS[this.shopSign++ % SHOP_KEYS.length]);
        b.letreiro(parent, name, x + s * 5.06, 6.2, z, s > 0 ? Math.PI / 2 : -Math.PI / 2, Math.min(24, len * 0.5), 1.6, SIGN_COLORS[this.shopSign % SIGN_COLORS.length]);
        const id = BLOCK_LETTERS[letter++];
        b.address(`clq-${wing}${label.replace('/', '-')}-${id}`, formatAddress('CLQ', [{ kind: 'raw', v: label }, { kind: 'bloco', v: id }], wing), x + s * 10, z);
        // Vagas na frente das lojas.
        this.parking(parent, rectOf(x + s * 12.5, z, 9, len - 6), true, 0.7, 1);
      }
    }
    // Calçadão entre as lojas.
    b.slab(parent, rectOf(cx, (minZ + maxZ) / 2, 12, span), 0.15, b.mats.walk).userData.surface = 'concrete';
  }

  // ---------------------------------------------------------------------------
  // Lotes institucionais (faixas 600/800). `dir` = +1: a via fica do lado +Z do lote; −1: do lado −Z.
  // Lotes pequenos cabem em ~105 m de fundo; os grandes (hospital, clube) em ~160 m.
  // ---------------------------------------------------------------------------

  lot(parent: THREE.Object3D, kind: LotKind, r: Rect, dir: 1 | -1, sector: { wing: 'N' | 'S'; quadra: number; lote: number }): void {
    const b = this.b;
    const g = b.group(`lote-${kind}`, parent);
    const cx = (r.minX + r.maxX) / 2;
    const w = r.maxX - r.minX;
    const front = dir > 0 ? r.maxZ : r.minZ;
    /** Z a `d` metros da frente do lote, para dentro. */
    const Z = (d: number) => front - dir * d;
    const yaw = dir > 0 ? 0 : Math.PI;
    const m = b.mats;
    /** Letreiro na face voltada para a via de uma caixa cuja frente fica a `d` metros da frente do lote. */
    const sign = (text: string, x: number, y: number, d: number, width: number) =>
      b.letreiro(g, text, x, y, Z(d - 0.1), yaw, width, Math.max(1.4, width / 12), { bg: '#f3f1ea', fg: '#1d2a33' });
    const park = (x0: number, x1: number, d0: number, d1: number, alongZ: boolean, fill: number) =>
      this.parking(g, { minX: cx + x0, maxX: cx + x1, minZ: Math.min(Z(d0), Z(d1)), maxZ: Math.max(Z(d0), Z(d1)) }, alongZ, fill);

    switch (kind) {
      case 'igreja': {
        // Nave branca com telhado de uma água subindo para a fachada (modernista) e o campanário ao lado.
        const nx = cx + 18;
        b.box(g, 24, 12, 44, m.white, nx, 6, Z(60));
        b.box(g, 24, 19, 1.2, m.white, nx, 9.5, Z(38.6));
        const roof = b.box(g, 27, 0.8, 46, m.concreteDark, nx, 15.5, Z(60));
        roof.rotation.x = -dir * Math.atan2(7, 44);
        b.box(g, 4, 26, 4, m.white, nx + 20, 13, Z(42));
        b.box(g, 0.6, 4, 0.6, m.metal, nx + 20, 28, Z(42));
        b.box(g, 2.6, 0.6, 0.6, m.metal, nx + 20, 28.6, Z(42));
        b.slab(g, rectOf(nx, Z(28), 30, 16), 0.15, m.plaza);
        b.occupy(rectOf(nx + 4, Z(60), 40, 50, 3));
        park(-w / 2 + 8, -8, 8, 98, true, 0.45);
        sign(t('lot.igreja'), nx, 2.2, 38, 16);
        break;
      }
      case 'escola': {
        b.box(g, 64, 7, 14, this.mats.school, cx - 6, 3.5, Z(45));
        b.box(g, 14, 7, 40, this.mats.school, cx + 33, 3.5, Z(72));
        b.occupy(rectOf(cx + 4, Z(62), 80, 52, 3));
        this.court(g, cx - 12, Z(80));
        park(-w / 2 + 10, w / 2 - 10, 4, 30, false, 0.5);
        sign(t('lot.escola'), cx - 6, 5.2, 38, 22);
        break;
      }
      case 'posto': {
        const apron = new THREE.Mesh(planeXZ(Math.min(w - 10, 80), 56), m.asphalt);
        apron.position.set(cx, 0.03, Z(32));
        apron.receiveShadow = true;
        apron.userData.noCollision = true;
        apron.userData.surface = 'asphalt';
        apron.userData.drape = 'deform';
        g.add(apron);
        const canopy = b.group('cobertura', g);
        b.box(canopy, 32, 1, 18, this.mats.canopy, cx, 5.5, Z(28));
        for (const sx of [-12, 12]) for (const sz of [-6, 6]) this.posts.push(placeMatrix(cx + sx, 0, Z(28) + sz));
        for (const sx of [-8, 0, 8]) b.box(canopy, 1.2, 1.3, 5, m.concrete, cx + sx, 0.65, Z(28));
        b.box(g, 18, 4.5, 11, this.mats.school, cx, 2.25, Z(56));
        b.box(g, 2.2, 10, 0.8, this.mats.canopy, cx + w / 2 - 12, 5, Z(6));
        b.occupy(rectOf(cx, Z(56), 18, 11, 2));
        b.occupy(rectOf(cx + w / 2 - 12, Z(6), 3, 2, 1));
        b.letreiro(g, t('lot.posto'), cx + w / 2 - 12, 8.4, Z(5.55), yaw, 2.1, 2.6, { bg: '#0f6b3a', fg: '#ffe9b0' });
        b.letreiro(g, t('lot.posto'), cx, 5.5, Z(18.94), yaw, 18, 1, { bg: '#0f6b3a', fg: '#ffe9b0' });
        break;
      }
      case 'hospital': {
        b.box(g, 76, 8, 52, m.concrete, cx, 4, Z(90));
        b.box(g, 56, 30, 16, this.mats.office, cx, 8 + 15, Z(96));
        const pad = new THREE.Mesh(planeXZ(12, 12), this.mats.helipad);
        pad.position.set(cx, 38.06, Z(96));
        pad.userData.noCollision = true;
        g.add(pad);
        b.occupy(rectOf(cx, Z(90), 76, 52, 3));
        park(-w / 2 + 8, w / 2 - 8, 6, 40, false, 0.75);
        sign(t('lot.hospital'), cx, 6, 64, 30);
        break;
      }
      case 'clube': {
        b.box(g, 40, 6, 16, m.white, cx - 10, 3, Z(60));
        const pool = new THREE.Mesh(planeXZ(25, 14), m.pool);
        pool.position.set(cx - 10, 0.06, Z(92));
        pool.userData.noCollision = true;
        pool.userData.drape = 'deform';
        g.add(pool);
        b.slab(g, rectOf(cx - 10, Z(92), 37, 24), 0.08, m.plaza);
        this.court(g, cx + 34, Z(98));
        this.court(g, cx + 34, Z(140));
        b.occupy(rectOf(cx - 10, Z(60), 40, 16, 3));
        park(-w / 2 + 10, w / 2 - 10, 4, 34, false, 0.5);
        sign(t('lot.clube'), cx - 10, 4.6, 52, 20);
        break;
      }
      case 'sede': {
        b.box(g, 54, 16, 22, this.mats.office, cx, 8, Z(60));
        b.box(g, 58, 1, 26, m.white, cx, 16.5, Z(60));
        b.occupy(rectOf(cx, Z(60), 58, 26, 3));
        park(-w / 2 + 10, w / 2 - 10, 6, 38, false, 0.6);
        sign(t('lot.sede'), cx, 13.5, 49, 26);
        break;
      }
    }
    // Alameda nos fundos e nas laterais do lote.
    for (let x = r.minX + 6; x <= r.maxX - 6; x += 16) this.b.treeSpots.push({ x, z: Z(r.maxZ - r.minZ - 5), s: 1 + this.b.rng() * 0.4 });
    for (let d = 10; d < r.maxZ - r.minZ - 10; d += 16) for (const x of [r.minX + 4, r.maxX - 4]) this.b.treeSpots.push({ x, z: Z(d), s: 0.9 + this.b.rng() * 0.4 });
    b.address(`sga-${sector.wing}${sector.quadra}-${sector.lote}`, formatAddress('SGA', [{ kind: 'quadra', v: sector.quadra }, { kind: 'lote', v: sector.lote }], sector.wing), cx, Z(4));
  }

  /** Quadra poliesportiva (piso pintado, 20 × 36 m). */
  court(parent: THREE.Object3D, x: number, z: number): void {
    const c = new THREE.Mesh(planeXZ(20, 36), this.mats.court);
    c.position.set(x, 0.05, z);
    c.receiveShadow = true;
    c.userData.noCollision = true;
    c.userData.surface = 'concrete';
    c.userData.drape = 'deform';
    parent.add(c);
  }

  // ---------------------------------------------------------------------------
  // Prédios de escritório e setores (M3): fachada em módulos de 4 m × 1 andar, cobertura em laje.
  // ---------------------------------------------------------------------------

  /**
   * Prédio retangular: paredes (BoxGeometry sem topo e fundo, UV em módulos de fachada: as janelas não
   * esticam com o tamanho) e uma laje de cobertura. Colide como caixa. Devolve a altura.
   */
  building(parent: THREE.Object3D, x: number, z: number, w: number, d: number, floors: number, style: FacadeStyle): number {
    const b = this.b;
    const h = floors * STOREY;
    const walls = new THREE.Mesh(facadeBoxGeometry(w, h, d), this.mats.style(style));
    walls.position.set(x, h / 2, z);
    walls.castShadow = walls.receiveShadow = true;
    walls.name = `predio-${style}`;
    walls.userData.cullDistance = DRAW.buildings;
    parent.add(walls);
    b.box(parent, w + 0.6, 0.8, d + 0.6, b.mats.roof, x, h + 0.4, z).userData.cullDistance = DRAW.buildings;
    b.occupy(rectOf(x, z, w, d, 3));
    return h;
  }

  /**
   * Preenche um setor com uma grade de prédios. Cada célula recebe um prédio (pulado se encostar em algo
   * que já existe, como um marco), uma faixa de estacionamento na frente (+Z ou −Z, conforme `face`) e
   * um endereço. Letreiros opcionais (bancos, hotéis, autarquias fictícias) no alto da fachada.
   */
  fillSector(parent: THREE.Object3D, r: Rect, spec: SectorSpec): void {
    const b = this.b;
    const [cw, cd] = spec.cell;
    const cols = Math.max(1, Math.floor((r.maxX - r.minX) / cw));
    const rows = Math.max(1, Math.floor((r.maxZ - r.minZ) / cd));
    const x0 = (r.minX + r.maxX) / 2 - (cols * cw) / 2 + cw / 2;
    const z0 = (r.minZ + r.maxZ) / 2 - (rows * cd) / 2 + cd / 2;
    const face = spec.face ?? 1;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const cx = x0 + i * cw;
        const cz = z0 + j * cd;
        const [fw, fd] = spec.foot[Math.floor(b.rng() * spec.foot.length)];
        // O prédio fica no fundo da célula; a frente (lado `face`) é do estacionamento.
        const bz = cz - face * Math.min(10, (cd - fd) / 2 - 18);
        if (!b.isRectFree(rectOf(cx, bz, fw, fd, 5))) continue;
        const floors = spec.floors[0] + Math.floor(b.rng() * (spec.floors[1] - spec.floors[0] + 1));
        const style = spec.styles[Math.floor(b.rng() * spec.styles.length)];
        const h = this.building(parent, cx, bz, fw, fd, floors, style);
        const pz = bz + face * (fd / 2 + 11);
        const pr = rectOf(cx, pz, Math.max(24, fw), 16);
        if (b.isRectFree(pr)) this.parking(parent, pr, false, spec.parkingFill ?? 0.5);
        if (spec.signs?.length) {
          const text = t(spec.signs[this.signIndex++ % spec.signs.length]);
          const sg = b.letreiro(parent, text, cx, h - 2.2, bz + face * (fd / 2 + 0.08), face > 0 ? 0 : Math.PI, Math.min(fw * 0.8, 26), 2.2, spec.signColors ?? { bg: '#1d2a33', fg: '#ffe9b0' });
          sg.userData.cullDistance = DRAW.signs;
        }
        const n = ++spec.counter.n;
        b.address(`${spec.prefix}-${n}`, formatAddress(spec.sector, [{ kind: 'quadra', v: spec.quadra + Math.floor((n - 1) / 6) }, { kind: 'bloco', v: BLOCK_LETTERS[(n - 1) % 6] }], spec.wing), cx, pz + face * 6);
        // Árvores nos cantos da célula.
        for (const [dx, dz] of [
          [-cw / 2 + 6, -cd / 2 + 6],
          [cw / 2 - 6, -cd / 2 + 6],
          [-cw / 2 + 6, cd / 2 - 6],
          [cw / 2 - 6, cd / 2 - 6],
        ]) b.treeSpots.push({ x: cx + dx, z: cz + dz, s: 1 + b.rng() * 0.4 });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Oeste (M4): comércio ao longo de uma via e casas geminadas.
  // ---------------------------------------------------------------------------

  /**
   * Comércio ao longo de X (W3): trechos de lojas de 2 andares com estacionamento entre a via e as lojas.
   * `face` = lado da via (−1: a via fica em z menor). Trechos que encostam em algo são pulados.
   */
  shopRow(parent: THREE.Object3D, minX: number, maxX: number, minZ: number, maxZ: number, face: 1 | -1, wing: 'N' | 'S', label: string): void {
    const b = this.b;
    const len = 70;
    const geoKey = `${len.toFixed(1)}`;
    let entry = this.shops.get(geoKey);
    if (!entry) this.shops.set(geoKey, (entry = { geo: box3Groups(10, 8, len), list: [] }));
    const shopZ = face < 0 ? maxZ - 5 : minZ + 5; // loja no fundo da faixa, estacionamento do lado da via
    const parkZ = face < 0 ? minZ + 8 : maxZ - 8;
    let n = 0;
    for (let x = minX + len / 2; x + len / 2 <= maxX; x += len + 14) {
      const r = rectOf(x, (minZ + maxZ) / 2, len + 4, maxZ - minZ);
      if (!b.isRectFree(r)) continue;
      entry.list.push(placeMatrix(x, 4, shopZ, Math.PI / 2));
      b.occupy(rectOf(x, shopZ, len, 10, 2));
      this.parking(parent, rectOf(x, parkZ, len, 16), false, 0.6, 2);
      const name = t(SHOP_KEYS[this.shopSign++ % SHOP_KEYS.length]);
      b.letreiro(parent, name, x, 6.2, shopZ + face * 5.06, face > 0 ? 0 : Math.PI, 22, 1.6, SIGN_COLORS[this.shopSign % SIGN_COLORS.length]).userData.cullDistance = DRAW.signs;
      n++;
      b.address(`clq-${wing}${label}-${n}`, formatAddress('CLQ', [{ kind: 'raw', v: label }, { kind: 'bloco', v: BLOCK_LETTERS[(n - 1) % BLOCK_LETTERS.length] }], wing), x, parkZ);
    }
  }

  /**
   * Fileira de casas geminadas (2 andares, 8 m de frente) ao longo de X, com a frente para o lado `face`
   * (onde fica a rua). Uma casa colorida por instância, telhado escuro; endereço a cada quatro casas.
   */
  houseRow(minX: number, maxX: number, z: number, face: 1 | -1, wing: 'N' | 'S', quadra: number): void {
    const b = this.b;
    const palette = [0xf0e2c4, 0xe9cfc0, 0xd9e2cf, 0xf2efe6, 0xe3d6ef, 0xf3d9a4, 0xcfe0e8];
    let k = 0;
    let inRow = 0;
    for (let x = minX + 4; x + 4 <= maxX; x += 8) {
      // Blocos de 12 casas separados por uma passagem de pedestres.
      if (inRow === 12) {
        inRow = 0;
        x += 8;
        if (x + 4 > maxX) break;
      }
      inRow++;
      if (!b.isFree(x, z)) {
        k = 0;
        continue;
      }
      this.houses.push({ m: placeMatrix(x, 3, z), color: new THREE.Color(palette[Math.floor(b.rng() * palette.length)]) });
      this.houseRoofs.push(placeMatrix(x, 6.2, z));
      if (k % 4 === 0) {
        const casa = Math.floor((x - minX) / 8) + 1;
        b.address(`shg-${wing}${quadra}-${casa}`, formatAddress('SHG', [{ kind: 'quadra', v: quadra }, { kind: 'casa', v: casa }], wing), x, z + face * 12);
      }
      k++;
      if (b.rng() < 0.35) b.treeSpots.push({ x, z: z - face * 14, s: 1 + b.rng() * 0.3 }); // quintal
    }
    b.occupy({ minX, maxX, minZ: z - 6 - 2, maxZ: z + 6 + 2 });
  }

  // ---------------------------------------------------------------------------

  /** Cria as InstancedMesh de tudo o que foi acumulado. Chamar uma vez, depois de todas as regiões. */
  flush(): void {
    const b = this.b;
    const g = this.group;
    for (const [key, e] of this.blocks) for (const m of instancedChunked(b, g, e.geo, e.mat, e.list, e.colors, `blocos-pilotis-${key}`, 400)) m.userData.cullDistance = DRAW.blocks;
    for (const m of instancedChunked(b, g, new THREE.BoxGeometry(10, PILOTIS - 0.1, 7), this.mats.lobby, this.lobbies, undefined, 'portarias')) m.castShadow = false;
    const pillarGeo = new THREE.CylinderGeometry(0.35, 0.35, PILOTIS + 1.5, 8).translate(0, (PILOTIS + 1.5) / 2, 0);
    for (const mesh of instancedChunked(b, g, pillarGeo, b.mats.concrete, this.pillars, undefined, 'pilotis')) {
      mesh.userData.collider = 'pole';
      mesh.userData.poleRadius = 0.4;
      mesh.userData.cullDistance = DRAW.pillars;
      mesh.userData.cameraIgnore = true; // fino como um tronco (e o raycast em milhares de instâncias custa caro)
      mesh.castShadow = false; // a sombra do bloco já cobre os pilotis
    }
    const postGeo = new THREE.CylinderGeometry(0.25, 0.25, 5, 8).translate(0, 2.5, 0);
    for (const mesh of instancedChunked(b, g, postGeo, b.mats.white, this.posts, undefined, 'colunas-posto')) {
      mesh.userData.collider = 'pole';
      mesh.userData.poleRadius = 0.3;
      mesh.userData.cameraIgnore = true;
    }
    for (const [, e] of this.shops) {
      const m = b.mats;
      for (const mesh of instancedChunked(b, g, e.geo, [this.mats.shopFacade, m.roof, m.concrete], e.list, undefined, 'comercio-local', 400)) mesh.userData.cullDistance = DRAW.buildings;
    }
    if (this.houses.length) {
      const houseMeshes = instancedChunked(b, g, box3Groups(8, 6, 12), [b.mats.concrete, b.mats.roof, this.mats.houseFront], this.houses.map((h) => h.m), this.houses.map((h) => h.color), 'casas', 400);
      for (const m of houseMeshes) m.userData.cullDistance = DRAW.buildings;
      for (const m of instancedChunked(b, g, new THREE.BoxGeometry(8.4, 0.5, 12.8), b.mats.roof, this.houseRoofs, undefined, 'casas-telhado', 400)) {
        m.userData.cullDistance = DRAW.buildings;
        m.userData.noCollision = true;
      }
    }
    this.flushCars();
  }

  private flushCars(): void {
    const b = this.b;
    const g = b.group('carros-parados', this.group);
    const matrices = this.cars.map((c) => c.m);
    const colors = this.cars.map((c) => c.color);
    // Um carro = uma geometria só (carroceria, cabine e rodas), com cor por vértice: a carroceria fica
    // branca (recebe a cor da instância) e cabine/rodas escuras. Uma draw call por bloco, sem sombra
    // (são milhares, e a sombra deles quase não aparece).
    const part = (geo: THREE.BufferGeometry, shade: number) => {
      const g2 = geo.toNonIndexed();
      const n = (g2.attributes.position as THREE.BufferAttribute).count;
      g2.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(shade), 3));
      g2.deleteAttribute('uv');
      return g2;
    };
    const geo = mergeGeometries([
      part(new THREE.BoxGeometry(1.8, 0.8, 4.3), 1),
      part(new THREE.BoxGeometry(1.6, 0.6, 2.2).translate(0, 0.7, -0.2), 0.16),
      part(new THREE.BoxGeometry(1.9, 0.5, 0.6).translate(0, -0.45, 1.35), 0.06), // eixos com rodas
      part(new THREE.BoxGeometry(1.9, 0.5, 0.6).translate(0, -0.45, -1.35), 0.06),
    ]);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.2, vertexColors: true });
    for (const mesh of instancedChunked(b, g, geo, mat, matrices, colors, 'carros-parados', 300)) {
      mesh.userData.cullDistance = DRAW.cars;
      mesh.userData.collider = 'box';
      mesh.userData.cameraIgnore = true;
      mesh.castShadow = false;
    }
    if (import.meta.env.DEV) console.info(`[cidade] cidade densa: ${this.cars.length} carros parados, ${this.pillars.length} pilares, ${[...this.blocks.values()].reduce((n, e) => n + e.list.length, 0)} blocos`);
  }
}

/** Pé-direito dos prédios de escritório (m). */
export const STOREY = 3.6;

export type FacadeStyle = 'vidroVerde' | 'vidroAzul' | 'vidroEscuro' | 'brise' | 'pastilha' | 'hotel' | 'quartel';

export interface SectorSpec {
  /** Tamanho da célula da grade (X, Z) e as plantas possíveis (X, Z) dos prédios. */
  cell: [number, number];
  foot: [number, number][];
  floors: [number, number];
  styles: FacadeStyle[];
  /** Lado da frente dos prédios (estacionamento e letreiro). */
  face?: 1 | -1;
  parkingFill?: number;
  signs?: StringKey[];
  signColors?: { bg: string; fg: string };
  sector: SectorId;
  wing?: 'N' | 'S';
  /** Prefixo do id dos endereços e contador compartilhado entre os retângulos do mesmo setor. */
  prefix: string;
  counter: { n: number };
  quadra: number;
}

/**
 * Caixa com os grupos de material reagrupados em 3 (±X, ±Y, ±Z), na ordem dos índices da BoxGeometry:
 * metade das draw calls de uma caixa com 6 grupos, quando as faces opostas usam o mesmo material.
 */
function box3Groups(w: number, h: number, d: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.clearGroups();
  geo.addGroup(0, 12, 0);
  geo.addGroup(12, 12, 1);
  geo.addGroup(24, 12, 2);
  return geo;
}

/** Caixa sem topo nem fundo, com UV das paredes em módulos de fachada (4 m × 1 andar). */
function facadeBoxGeometry(w: number, h: number, d: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // Faces na ordem +X, −X, +Y, −Y, +Z, −Z; 4 vértices cada.
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  dims.forEach(([fw, fh], f) => {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(fw / 4)), uv.getY(i) * Math.round(fh / STOREY));
    }
  });
  const index = geo.index!.array;
  const keep: number[] = [];
  for (const g of geo.groups) if (g.materialIndex !== 2 && g.materialIndex !== 3) for (let i = g.start; i < g.start + g.count; i++) keep.push(index[i]);
  geo.setIndex(keep);
  geo.clearGroups();
  return geo;
}

export type LotKind = 'igreja' | 'escola' | 'posto' | 'hospital' | 'clube' | 'sede';

const SIGN_COLORS = [
  { bg: '#b3261e', fg: '#fff6e0' },
  { bg: '#1d4f91', fg: '#ffffff' },
  { bg: '#f2c94c', fg: '#2b2b2b' },
  { bg: '#2e7d32', fg: '#ffffff' },
  { bg: '#3b3b3f', fg: '#ffe9b0' },
];

/** Plano horizontal (normal +Y) de w (X) × d (Z), com UV 0..1. */
function planeXZ(w: number, d: number): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2) as THREE.PlaneGeometry;
}

/** Janelas que acendem à noite (mesma convenção dos materiais da cidade: userData.nightGlow). */
function windows(m: THREE.MeshStandardMaterial, glow: number): THREE.MeshStandardMaterial {
  m.emissive.set(0xffd9a0);
  m.emissiveMap = m.map;
  m.emissiveIntensity = 0;
  m.userData.nightGlow = glow;
  return m;
}

function kitMaterials() {
  const std = (color: number, roughness = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const decal = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const facades = new Map<number, THREE.MeshStandardMaterial>();
  const styles = new Map<FacadeStyle, THREE.MeshStandardMaterial>();
  return {
    /** Fachada clara: a cor de cada bloco vem da instância (InstancedMesh.setColorAt). */
    facade(floors: number): THREE.MeshStandardMaterial {
      let m = facades.get(floors);
      if (!m) facades.set(floors, (m = windows(std(0xffffff, 0.8, { map: createPilotisFacadeTexture('#f4f2ee', floors) }), 0.35)));
      return m;
    },
    /** Fachada de escritório por estilo (textura de 1 módulo, repetida pela UV da geometria). */
    style(style: FacadeStyle): THREE.MeshStandardMaterial {
      let m = styles.get(style);
      if (!m) {
        const glass = style.startsWith('vidro');
        m = windows(std(0xffffff, glass ? 0.3 : 0.8, { map: createModuleTexture(style), metalness: glass ? 0.25 : 0 }), glass ? 0.5 : 0.4);
        styles.set(style, m);
      }
      return m;
    },
    lobby: std(0x3d4f5a, 0.3, { metalness: 0.3 }),
    parking: (() => {
      const m = std(0xffffff, 0.92, { map: createParkingTexture(), ...decal });
      m.userData.wetRoad = true;
      return m;
    })(),
    sand: std(0xd8c49a, 1, decal),
    court: std(0xffffff, 0.8, { map: createCourtTexture(), ...decal }),
    school: windows(std(0xffffff, 0.85, { map: createSchoolTexture() }), 0.25),
    office: windows(std(0xffffff, 0.35, { map: createGlassFacadeTexture(10, 5), metalness: 0.2 }), 0.5),
    shopFacade: windows(std(0xffffff, 0.75, { map: createShopTexture() }), 0.6),
    canopy: std(0x0f6b3a, 0.6),
    houseFront: windows(std(0xffffff, 0.85, { map: createHouseTexture() }), 0.4),
    helipad: std(0xffffff, 0.8, { map: createHelipadTexture() }),
    toyRed: std(0xc0392b),
    toyYellow: std(0xf2c94c),
    toyBlue: std(0x2f6fb5),
    carGlass: std(0x1d2730, 0.25, { metalness: 0.4 }),
    tire: std(0x1a1a1a, 0.9),
  };
}

// ---------------------------------------------------------------------------
// Texturas (canvas)
// ---------------------------------------------------------------------------

/** Fachada de bloco sobre pilotis (só os andares; o térreo é livre): faixas de janelas e pastilhas. */
function createPilotisFacadeTexture(tint: string, floors: number): THREE.CanvasTexture {
  return canvasTexture(256, 32 * floors, (ctx) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, 256, 32 * floors);
    for (let f = 0; f < floors; f++) {
      const y = f * 32 + 7;
      ctx.fillStyle = '#56758a';
      for (let x = 4; x < 252; x += 12) ctx.fillRect(x, y, 9, 16);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, f * 32 + 28, 256, 3); // peitoril
    }
  });
}

/** Um módulo de fachada (4 m × 1 andar) por estilo. */
function createModuleTexture(style: FacadeStyle): THREE.CanvasTexture {
  return canvasTexture(64, 64, (ctx) => {
    const glass = { vidroVerde: '#3f6f69', vidroAzul: '#3d5f80', vidroEscuro: '#2c353f' } as Record<string, string>;
    if (style in glass) {
      ctx.fillStyle = glass[style];
      ctx.fillRect(0, 0, 64, 64);
      const g = ctx.createLinearGradient(0, 0, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,0.2)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = style === 'vidroEscuro' ? '#8e959c' : '#d9d7cf';
      ctx.fillRect(0, 54, 64, 10); // peitoril
      ctx.fillRect(0, 0, 2, 64); // montantes
      ctx.fillRect(31, 0, 2, 54);
    } else if (style === 'brise') {
      ctx.fillStyle = '#ecebe6';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#34444f';
      ctx.fillRect(0, 18, 64, 30); // faixa de janelas
      ctx.fillStyle = '#f7f6f2';
      for (let y = 22; y < 48; y += 8) ctx.fillRect(0, y, 64, 3); // brises horizontais
    } else if (style === 'pastilha') {
      ctx.fillStyle = '#d9cdb4';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#466274';
      ctx.fillRect(6, 14, 22, 32);
      ctx.fillRect(36, 14, 22, 32);
    } else if (style === 'quartel') {
      // Quartel: reboco ocre, janelas pequenas e uma faixa escura no peitoril.
      ctx.fillStyle = '#d6c08c';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#7a6a48';
      ctx.fillRect(0, 50, 64, 6);
      ctx.fillStyle = '#3e4a3a';
      ctx.fillRect(10, 16, 16, 24);
      ctx.fillRect(38, 16, 16, 24);
    } else {
      // Hotel: sacadas com guarda-corpo e porta de vidro.
      ctx.fillStyle = '#efe6d6';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#4f6b7d';
      ctx.fillRect(8, 10, 48, 38);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(4, 40, 56, 10);
      ctx.fillStyle = '#c9b89a';
      ctx.fillRect(0, 0, 3, 64);
    }
  });
}

function createParkingTexture(): THREE.CanvasTexture {
  // 10 m (U) × 16 m (V): vaga de 5 m, corredor de 6 m, vaga de 5 m; divisórias a cada 2,5 m.
  const ppm = 8;
  return canvasTexture(10 * ppm, 16 * ppm, (ctx) => {
    ctx.fillStyle = '#4a4b4e';
    ctx.fillRect(0, 0, 80, 128);
    ctx.fillStyle = '#e8e8e8';
    for (let x = 0; x < 80; x += 2.5 * ppm) {
      ctx.fillRect(x, 0, 2, 5 * ppm);
      ctx.fillRect(x, 11 * ppm, 2, 5 * ppm);
    }
  });
}

function createCourtTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(128, 224, (ctx) => {
    ctx.fillStyle = '#3f7d5a';
    ctx.fillRect(0, 0, 128, 224);
    ctx.fillStyle = '#2f5f8a';
    ctx.fillRect(10, 10, 108, 204);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, 108, 204);
    ctx.beginPath();
    ctx.moveTo(10, 112);
    ctx.lineTo(118, 112);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(64, 112, 18, 0, Math.PI * 2);
    ctx.stroke();
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function createSchoolTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 64, (ctx) => {
    ctx.fillStyle = '#f0e6d2';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#c96b3c';
    ctx.fillRect(0, 28, 256, 4);
    ctx.fillStyle = '#4e6a7c';
    for (let x = 6; x < 250; x += 16) {
      ctx.fillRect(x, 8, 11, 14);
      ctx.fillRect(x, 40, 11, 14);
    }
  });
}

function createShopTexture(): THREE.CanvasTexture {
  const colors = ['#c0392b', '#2f6fb5', '#e1a32a', '#2e7d32', '#8e44ad', '#d35400'];
  return canvasTexture(512, 64, (ctx) => {
    ctx.fillStyle = '#e7e1d4';
    ctx.fillRect(0, 0, 512, 64);
    for (let i = 0; i < 8; i++) {
      const x = i * 64;
      ctx.fillStyle = '#3a4f5c';
      ctx.fillRect(x + 4, 36, 56, 28); // vitrine
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x + 2, 30, 60, 6); // toldo
      ctx.fillStyle = '#56758a';
      for (let k = 0; k < 3; k++) ctx.fillRect(x + 8 + k * 18, 8, 12, 12);
    }
  });
}

/** Fachada de casa geminada (8 m × 2 andares): porta e janela embaixo, duas janelas em cima. */
function createHouseTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(64, 48, (ctx) => {
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(0, 0, 64, 48);
    ctx.fillStyle = '#5c4a3a';
    ctx.fillRect(8, 30, 10, 18); // porta
    ctx.fillStyle = '#4e6a7c';
    ctx.fillRect(28, 32, 26, 10);
    ctx.fillRect(10, 8, 16, 12);
    ctx.fillRect(38, 8, 16, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, 0, 2, 48);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function createHelipadTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#5a5d61';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#f2d24b';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(64, 64, 54, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 72px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', 64, 68);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Sorteia o tipo de um lote da faixa 600 (pequenos) ou 800 (grandes). */
export function pickLot(rng: () => number, big: boolean): LotKind {
  const pool: LotKind[] = big ? ['hospital', 'clube', 'escola', 'sede', 'clube'] : ['igreja', 'escola', 'posto', 'sede', 'igreja', 'escola', 'posto'];
  return pool[Math.floor(rng() * pool.length)];
}

