// Carros fictícios gerados em código: lataria por "loft" (seções transversais ao longo do comprimento),
// estufa de vidro, faróis e lanternas que contornam as quinas, grade, retrovisores e rodas com aro.
// O resultado tem a mesma estrutura que os modelos .glb tinham (nó "body", nós "wheel-*" com origem no cubo,
// materiais com nome: paint, glass, black, trim, rim, tire, headlight, taillight), então CarVisual cuida do
// resto (interior, sujeira, amassados, luzes) sem saber que o carro veio daqui.
//
// Espaço do modelo: metros, chão em y = 0, frente em +Z, esquerda em +X, carro centrado.
import * as THREE from 'three';
import { measure, type CarAsset } from './CarVisual';

/** Desenho de um carro. Medidas em metros; posições z a partir do centro (frente = +). */
export interface CarDesign {
  length: number;
  width: number;
  /** Altura do teto. */
  height: number;
  /** z dos eixos dianteiro e traseiro. */
  axles: [number, number];
  /** Meia-bitola (x do centro das rodas). */
  track: number;
  wheelRadius: number;
  tireWidth: number;
  /** Altura do fundo da lataria (soleira). */
  sill: number;
  /** Linha de cintura (base dos vidros laterais). */
  belt: number;
  /** Altura do capô na ponta e da tampa traseira na ponta. */
  hood: number;
  deck: number;
  /** Comprimento do arredondamento (em planta) da frente e da traseira. */
  noseRound: number;
  tailRound: number;
  /** Estufa: pé do para-brisa, começo e fim do teto, pé do vidro traseiro (z) e meia-largura do teto. */
  glass: { base: number; roofFront: number; roofRear: number; rear: number; roofHalf: number };
  /** Colunas: z da coluna B e z a partir do qual (para trás) a lateral é lataria (coluna C/D). */
  bPillar: number;
  cPillar: number;
  /** Coluna extra (SUVs de três janelas): z, ou omitido. */
  midPillar?: number;
  /** Altura da faixa de plástico preto na parte de baixo (soleira, para-choques). */
  clad: number;
  style: {
    grille: 'slot' | 'wide' | 'tall' | 'bars';
    /** Lanterna traseira: nas quinas, ou de ponta a ponta. */
    tail: 'corners' | 'bar';
    /** Altura dos faróis (do topo da frente para baixo) e quanto contornam para a lateral. */
    headlight: { height: number; inner: number; wrap: number };
    rails?: boolean;
    /** Teto preto (dois tons). */
    blackRoof?: boolean;
    /** Frisos cromados na base dos vidros e nas maçanetas. */
    chrome?: boolean;
    rim: { spokes: number; color: number; twin?: boolean };
  };
}

type V2 = [number, number];
type Mats = ReturnType<typeof materials>;
type MatId = 'paint' | 'glass' | 'black' | 'trim';
const LOFT_MATS: MatId[] = ['paint', 'glass', 'black', 'trim'];

function materials(d: CarDesign) {
  const std = (name: string, p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ name, ...p });
  return {
    paint: std('paint', { color: 0x15171a, roughness: 0.25, metalness: 0.35 }),
    glass: std('glass', { color: 0x1a252d, roughness: 0.05, metalness: 0.3 }),
    black: std('black', { color: 0x141518, roughness: 0.65 }),
    trim: std('trim', { color: 0xd3d6dc, roughness: 0.18, metalness: 0.9 }),
    rim: std('rim', { color: d.style.rim.color, roughness: 0.3, metalness: 0.75 }),
    tire: std('tire', { color: 0x121212, roughness: 0.92 }),
    headlight: std('headlight', { color: 0xdfe6ea, roughness: 0.08, metalness: 0.4 }),
    taillight: std('taillight', { color: 0x5e0a0a, roughness: 0.15, emissive: 0xd01515, emissiveIntensity: 0.35 }),
    plate: std('plate', { color: 0xf2f2ee, roughness: 0.5 }),
    plateBand: std('plate-band', { color: 0x1b3d8f, roughness: 0.5 }),
  };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Gera o carro (template + medidas para a física). `low` = menos polígonos (qualidade Baixa/Média). */
export function buildCarAsset(d: CarDesign, low = false): CarAsset {
  const mats = materials(d);
  const shape = new BodyShape(d);
  const root = new THREE.Group();
  root.name = 'carro-ficticio';
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]) => {
    const m = new THREE.Mesh(geo, mat);
    body.add(m);
    return m;
  };
  const loftMats = LOFT_MATS.map((k) => mats[k]);
  mesh(shape.lowerGeometry(low ? 0.075 : 0.035), loftMats);
  mesh(shape.glassGeometry(low ? 0.08 : 0.04), loftMats);
  addLights(shape, mats, mesh);
  addDetails(shape, mats, mesh);

  const names = ['wheel-front-left', 'wheel-front-right', 'wheel-rear-left', 'wheel-rear-right'];
  names.forEach((name, i) => {
    const w = new THREE.Group();
    w.name = name;
    const left = i % 2 === 0;
    w.position.set(left ? d.track : -d.track, d.wheelRadius, d.axles[i < 2 ? 0 : 1]);
    const inner = buildWheel(d, mats, low ? 14 : 30, low);
    if (!left) inner.rotation.y = Math.PI; // face do aro para fora
    w.add(inner);
    root.add(w);
  });
  return { template: root, geometry: measure(root) };
}

/** Perfis da lataria e geometria do loft. */
class BodyShape {
  readonly L2: number;
  constructor(readonly d: CarDesign) {
    this.L2 = d.length / 2;
  }

  /** 0 na ponta do carro → 1 fora da zona de arredondamento (quarto de círculo em planta). */
  endF(z: number): number {
    const R = z > 0 ? this.d.noseRound : this.d.tailRound;
    const k = clamp01((this.L2 - Math.abs(z)) / R);
    return Math.sqrt(1 - (1 - k) ** 2);
  }

  topAt(z: number): number {
    const { d } = this;
    const g = d.glass;
    let y = d.belt;
    if (z > g.base) y = d.belt + (d.hood - d.belt) * ((z - g.base) / (this.L2 - g.base)) ** 1.4;
    else if (z < g.rear) y = d.belt + (d.deck - d.belt) * ((g.rear - z) / (g.rear + this.L2)) ** 1.2;
    return y - (1 - this.endF(z)) * 0.1;
  }

  /** Altura do assoalho (fundo plano), mais alto nas pontas (para-choques). */
  floorAt(z: number): number {
    return this.d.sill + (1 - this.endF(z)) * 0.1;
  }

  /** Fundo da lateral: o assoalho, ou o arco do para-lama sobre as rodas. */
  bottomAt(z: number): number {
    const { d } = this;
    let y = this.floorAt(z);
    const R = d.wheelRadius + 0.07;
    for (const wz of d.axles) {
      const dz = z - wz;
      if (Math.abs(dz) < R) y = Math.max(y, d.wheelRadius + Math.sqrt(R * R - dz * dz));
    }
    return y;
  }

  hwAt(z: number): number {
    return (this.d.width / 2) * (0.86 + 0.14 * this.endF(z));
  }

  /** Meia-seção da lataria (lado esquerdo, x ≥ 0): do centro do topo, pela lateral, até o centro do fundo. */
  ring(z: number): V2[] {
    const hw = this.hwAt(z);
    const top = this.topAt(z);
    const bot = this.bottomAt(z);
    const h = Math.max(0.02, top - bot);
    const rs = Math.min(0.08, h * 0.3);
    const rb = Math.min(0.1, h * 0.3);
    const tuck = Math.min(0.05, h * 0.12);
    const crown = 0.015;
    const pts: V2[] = [
      [0, top + crown],
      [(hw - rs) * 0.55, top + crown * 0.7],
    ];
    for (let i = 0; i <= 4; i++) {
      const a = (Math.PI / 2) * (1 - i / 4);
      pts.push([hw - rs + rs * Math.cos(a), top - rs + rs * Math.sin(a)]);
    }
    for (let i = 1; i <= 3; i++) {
      const u = i / 4;
      pts.push([hw - tuck * u * u, top - rs - u * (h - rs - rb)]);
    }
    for (let i = 0; i <= 3; i++) {
      const a = (-Math.PI / 2) * (i / 3);
      pts.push([hw - tuck - rb + rb * Math.cos(a), bot + rb + rb * Math.sin(a)]);
    }
    // Caixa de roda: do arco, para dentro até a parede interna (logo por dentro do pneu) e desce ao assoalho.
    // Fora dos arcos os dois pontos coincidem com o fundo (faces degeneradas, invisíveis).
    const floor = this.floorAt(z);
    const xin = Math.min(this.d.track - this.d.tireWidth / 2 - 0.04, hw - tuck - rb - 0.01);
    pts.push([xin, bot], [xin, floor], [0, floor]);
    return pts;
  }

  /** x da superfície externa na altura y (seção em z). */
  surfaceX(z: number, y: number): number {
    const r = this.ring(z);
    let best = 0;
    for (let i = 0; i < r.length - 1; i++) {
      const [x0, y0] = r[i];
      const [x1, y1] = r[i + 1];
      if ((y - y0) * (y - y1) > 0 || y0 === y1) continue;
      best = Math.max(best, x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    return best;
  }

  /** Estações ao longo do comprimento: passo uniforme + mais densas nas pontas arredondadas. */
  stations(step: number, from = -this.L2, to = this.L2): number[] {
    const zs: number[] = [];
    for (let z = from; z < to; z += step) zs.push(z);
    zs.push(to);
    for (const [end, R] of [[this.L2, this.d.noseRound], [-this.L2, this.d.tailRound]] as const) {
      for (let k = 1; k < 8; k++) {
        const e = R * (1 - Math.cos(((k / 8) * Math.PI) / 2));
        const z = end - Math.sign(end) * e;
        if (z > from && z < to) zs.push(z);
      }
    }
    zs.sort((a, b) => a - b);
    return zs.filter((z, i) => i === 0 || z - zs[i - 1] > 0.004);
  }

  /** Lataria (abaixo da cintura), com o topo aberto sob a estufa e tampas nas pontas. */
  lowerGeometry(step: number): THREE.BufferGeometry {
    const { d } = this;
    const zs = this.stations(step);
    const g = d.glass;
    const rings = zs.map((z) => {
      const half = this.ring(z);
      return half.concat(half.slice(1, -1).reverse().map(([x, y]) => [-x, y] as V2));
    });
    const n = rings[0].length; // fechado
    const halfN = (n + 2) / 2; // pontos da meia-seção
    const b = new LoftBuilder();
    const base = b.addRings(rings, zs);
    for (let i = 0; i < zs.length - 1; i++) {
      const z = (zs[i] + zs[i + 1]) / 2;
      const cabin = z > g.rear && z < g.base;
      const bot = this.bottomAt(z);
      const clad = d.clad + (1 - this.endF(z) ** 4) * 0.08;
      for (let j = 0; j < n; j++) {
        const k = j < halfN - 1 ? j : n - 1 - j; // índice do segmento na meia-seção
        if (cabin && k <= 1) continue; // abertura da cabine (a estufa cobre)
        const yc = (rings[i][j][1] + rings[i][(j + 1) % n][1]) / 2;
        b.quad(base, n, i, j, (j + 1) % n, yc < bot + clad ? 'black' : 'paint');
      }
    }
    b.cap(rings[0], zs[0], -1, 'paint');
    b.cap(rings[rings.length - 1], zs[zs.length - 1], 1, 'paint');
    return b.build();
  }

  /** Meia-largura da estufa na altura y (afunila da cintura até o teto). */
  glassX(z: number, y: number): number {
    const { d } = this;
    const xb = this.hwAt(z) - 0.07;
    return xb + (d.glass.roofHalf - xb) * clamp01((y - d.belt) / (d.height - d.belt));
  }

  glassTop(z: number): number {
    const { d } = this;
    const g = d.glass;
    if (z >= g.roofFront) return d.height - (d.height - d.belt) * clamp01((z - g.roofFront) / (g.base - g.roofFront)) ** 1.15;
    if (z <= g.roofRear) return d.height - (d.height - d.belt) * clamp01((g.roofRear - z) / (g.roofRear - g.rear)) ** 1.3;
    const mid = (g.roofFront + g.roofRear) / 2;
    const half = (g.roofFront - g.roofRear) / 2;
    return d.height - 0.025 * ((z - mid) / half) ** 2;
  }

  /** Estufa: para-brisa, vidros laterais, colunas, teto e vidro traseiro. */
  glassGeometry(step: number): THREE.BufferGeometry {
    const { d } = this;
    const g = d.glass;
    const zs = this.stations(step, g.rear, g.base);
    const rings = zs.map((z) => {
      const top = this.glassTop(z);
      const gh = Math.max(0, top - d.belt);
      const o = Math.min(1, gh / 0.25);
      const xr = this.glassX(z, top);
      const left: V2[] = [
        [0, top],
        [xr * 0.55, top - 0.008 * o],
        [xr - 0.035 * o, top - 0.014 * o],
        [this.glassX(z, top - 0.05 * o), top - 0.05 * o],
        [this.glassX(z, d.belt + 0.03 * o), d.belt + 0.03 * o],
        [this.hwAt(z) - 0.06, d.belt - 0.04],
      ];
      // Sentido horário visto de frente: lado direito de baixo para cima, depois o esquerdo de cima para baixo.
      return left.slice(1).reverse().map(([x, y]) => [-x, y] as V2).concat(left);
    });
    const n = rings[0].length; // aberto (sem fundo)
    const b = new LoftBuilder();
    const base = b.addRings(rings, zs);
    for (let i = 0; i < zs.length - 1; i++) {
      const z = (zs[i] + zs[i + 1]) / 2;
      for (let j = 0; j < n - 1; j++) {
        const k = j < 5 ? j : n - 2 - j; // 0 vedação, 1 vidro lateral, 2 moldura, 3–4 teto
        b.quad(base, n, i, j, j + 1, this.glassMat(z, k));
      }
    }
    return b.build();
  }

  private glassMat(z: number, k: number): MatId {
    const { d } = this;
    const g = d.glass;
    if (k === 0) return d.style.chrome ? 'trim' : 'black';
    if (k === 2) return d.style.blackRoof ? 'black' : 'paint';
    if (k >= 3) return z > g.roofFront || z < g.roofRear ? 'glass' : d.style.blackRoof ? 'black' : 'paint';
    // Lateral.
    if (z > g.roofFront - 0.05) return 'black'; // triângulo da coluna A
    if (Math.abs(z - d.bPillar) < 0.055) return 'black';
    if (d.midPillar !== undefined && Math.abs(z - d.midPillar) < 0.06) return 'black';
    if (z < d.cPillar) return d.style.blackRoof ? 'black' : 'paint';
    return 'glass';
  }

  /**
   * Contorno em planta, na altura y, a partir do centro da frente (end = 1) ou da traseira (−1), passando
   * pela quina e seguindo pela lateral: pontos (x, z) e comprimento acumulado.
   */
  outline(y: number, end: 1 | -1): { pts: V2[]; s: number[] } {
    const zEnd = end * this.L2;
    const pts: V2[] = [[0, zEnd]];
    const R = end > 0 ? this.d.noseRound : this.d.tailRound;
    for (let k = 0; k <= 16; k++) {
      const e = (R + 0.6) * (k / 16) ** 1.8;
      pts.push([this.surfaceX(zEnd - end * e, y), zEnd - end * e]);
    }
    const s = [0];
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, s };
  }
}

/** Monta geometria indexada com um grupo por material (ordem de LOFT_MATS). */
class LoftBuilder {
  private readonly pos: number[] = [];
  private readonly idx: Record<MatId, number[]> = { paint: [], glass: [], black: [], trim: [] };

  addRings(rings: V2[][], zs: number[]): number {
    const base = this.pos.length / 3;
    rings.forEach((r, i) => r.forEach(([x, y]) => this.pos.push(x, y, zs[i])));
    return base;
  }

  /** Quadrilátero entre as estações i e i+1, pontos j e j2 (normais para fora com anéis em sentido horário). */
  quad(base: number, n: number, i: number, j: number, j2: number, mat: MatId): void {
    const a = base + i * n + j;
    const b = base + i * n + j2;
    const c = base + (i + 1) * n + j2;
    const d = base + (i + 1) * n + j;
    this.idx[mat].push(a, d, b, b, d, c);
  }

  /** Tampa plana numa ponta (vértices próprios: quina nítida). */
  cap(ring: V2[], z: number, dir: 1 | -1, mat: MatId): void {
    const base = this.pos.length / 3;
    let cy = 0;
    for (const [, y] of ring) cy += y / ring.length;
    this.pos.push(0, cy, z);
    for (const [x, y] of ring) this.pos.push(x, y, z);
    for (let j = 0; j < ring.length; j++) {
      const a = base + 1 + j;
      const b = base + 1 + ((j + 1) % ring.length);
      if (dir > 0) this.idx[mat].push(base, b, a);
      else this.idx[mat].push(base, a, b);
    }
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    const all: number[] = [];
    LOFT_MATS.forEach((m, mi) => {
      if (!this.idx[m].length) return;
      geo.addGroup(all.length, this.idx[m].length, mi);
      for (const v of this.idx[m]) all.push(v);
    });
    geo.setIndex(all);
    geo.computeVertexNormals();
    return geo;
  }
}

/**
 * Faixa que acompanha a superfície (farol, lanterna), entre os comprimentos s0 e s1 do contorno, das alturas
 * y0 a y1, nos dois lados do carro.
 */
function surfaceBand(shape: BodyShape, end: 1 | -1, y0: number, y1: number, s0: number, s1: number, lift = 0.008): THREE.BufferGeometry {
  const rows = [shape.outline(y0, end), shape.outline(y1, end)];
  const N = 14;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    rows.forEach(({ pts, s }, r) => {
      const y = r === 0 ? y0 : y1;
      for (let k = 0; k <= N; k++) {
        const t = s0 + ((s1 - s0) * k) / N;
        let i = 1;
        while (i < s.length - 1 && s[i] < t) i++;
        const f = clamp01((t - s[i - 1]) / (s[i] - s[i - 1] || 1));
        const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f;
        const z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
        // Normal em planta: perpendicular ao contorno, para fora.
        const tx = pts[i][0] - pts[i - 1][0];
        const tz = pts[i][1] - pts[i - 1][1];
        const len = Math.hypot(tx, tz) || 1;
        const nx = (-end * tz) / len;
        const nz = (end * tx) / len;
        pos.push(side * (x + nx * lift), y, z + nz * lift);
      }
    });
    for (let k = 0; k < N; k++) {
      const a = base + k;
      const b = base + k + 1;
      const c = base + N + 1 + k + 1;
      const d = base + N + 1 + k;
      // Face para fora: depende do lado e da ponta.
      if (side * end > 0) idx.push(a, b, d, b, c, d);
      else idx.push(a, d, b, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

type AddMesh = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]) => THREE.Mesh;

function addLights(shape: BodyShape, mats: Mats, mesh: AddMesh): void {
  const { d } = shape;
  const L2 = shape.L2;
  const st = d.style;
  // Faróis: na frente, logo abaixo do topo, contornando a quina.
  const frontTop = shape.topAt(L2 - 0.01) - 0.06;
  const hl = st.headlight;
  const cornerF = (y: number) => shape.surfaceX(L2, y);
  const hy1 = frontTop;
  const hy0 = frontTop - hl.height;
  mesh(surfaceBand(shape, 1, hy0, hy1, hl.inner, cornerF((hy0 + hy1) / 2) + hl.wrap), mats.headlight);
  // Moldura escura sob o farol (dá profundidade).
  mesh(surfaceBand(shape, 1, hy0 - 0.025, hy0, hl.inner, cornerF(hy0) + hl.wrap * 0.8, 0.006), mats.black);

  // Lanternas traseiras.
  const rearTop = shape.topAt(-L2 + 0.01) - 0.05;
  const ty1 = rearTop;
  const ty0 = rearTop - 0.12;
  const rc = shape.surfaceX(-L2, (ty0 + ty1) / 2);
  mesh(surfaceBand(shape, -1, ty0, ty1, st.tail === 'bar' ? 0 : rc * 0.42, rc + 0.18), mats.taillight);
  if (st.tail === 'bar' && st.chrome) mesh(surfaceBand(shape, -1, ty0 - 0.03, ty0 - 0.012, 0, rc * 0.6, 0.006), mats.trim);

  // Grade (plana, na tampa da frente), entre os faróis.
  const gw = hl.inner - 0.04;
  const gTop = hy1 - 0.02;
  const tallGrille = st.grille === 'tall' || st.grille === 'bars';
  const gBot = tallGrille ? Math.max(hy0 - 0.26, d.sill + 0.3) : hy0 - 0.06;
  const plane = (w: number, h: number, mat: THREE.Material, x: number, y: number, z: number, flip = false) => {
    const m = mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    if (flip) m.rotation.y = Math.PI;
    return m;
  };
  const zf = L2 + 0.004;
  plane(gw * 2, gTop - gBot, mats.black, 0, (gTop + gBot) / 2, zf);
  const box = (w: number, h: number, dd: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = mesh(new THREE.BoxGeometry(w, h, dd), mat);
    m.position.set(x, y, z);
    return m;
  };
  switch (st.grille) {
    case 'slot':
      box(gw * 2, 0.02, 0.02, mats.trim, 0, gTop - 0.01, zf);
      box(gw * 2, 0.012, 0.015, mats.trim, 0, (gTop + gBot) / 2, zf);
      break;
    case 'wide':
      for (let k = 1; k < 4; k++) box(gw * 2 - 0.04, 0.008, 0.012, mats.black, 0, gBot + ((gTop - gBot) * k) / 4, zf + 0.004);
      box(gw * 2, 0.018, 0.02, mats.trim, 0, gTop - 0.01, zf);
      break;
    case 'tall':
      for (let k = -6; k <= 6; k++) box(0.012, gTop - gBot - 0.03, 0.015, mats.trim, (k / 6.5) * gw, (gTop + gBot) / 2, zf);
      box(gw * 2 + 0.03, 0.025, 0.025, mats.trim, 0, gTop, zf);
      box(gw * 2 + 0.03, 0.025, 0.025, mats.trim, 0, gBot, zf);
      break;
    case 'bars':
      for (let k = 0; k < 3; k++) box(gw * 2 - 0.02, 0.035, 0.03, mats.trim, 0, gTop - 0.05 - k * ((gTop - gBot - 0.1) / 2.2), zf + 0.005);
      break;
  }
  // Emblema fictício: um losango cromado (sem marca real).
  const emblem = box(0.07, 0.07, 0.02, mats.trim, 0, gTop - (gTop - gBot) * 0.3, zf + 0.012);
  emblem.rotation.z = Math.PI / 4;
  // Entrada de ar inferior.
  const intakeY = d.sill + 0.12;
  if (!tallGrille) plane(shape.surfaceX(L2, intakeY) * 1.3, 0.09, mats.black, 0, intakeY, zf);

  // Placas Mercosul em branco (sem letras): frente e traseira.
  const plate = (y: number, z: number, flip: boolean) => {
    plane(0.43, 0.155, mats.black, 0, y, z + (flip ? 0.002 : -0.002), flip); // moldura
    plane(0.4, 0.13, mats.plate, 0, y, z, flip);
    plane(0.4, 0.028, mats.plateBand, 0, y + 0.051, z + (flip ? -0.001 : 0.001), flip);
  };
  plate(Math.min(d.sill + 0.24, gBot - 0.095), zf + 0.004, false);
  plate(ty0 - 0.16, -L2 - 0.008, true);
}

function addDetails(shape: BodyShape, mats: Mats, mesh: AddMesh): void {
  const { d } = shape;
  const g = d.glass;
  const st = d.style;
  const box = (w: number, h: number, dd: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = mesh(new THREE.BoxGeometry(w, h, dd), mat);
    m.position.set(x, y, z);
    return m;
  };

  // Linhas das portas: frisos escuros finos acompanhando a lateral.
  const doorLines = [g.base - 0.12, d.bPillar, d.cPillar + 0.05];
  if (d.midPillar !== undefined) doorLines[2] = d.midPillar;
  for (const z of doorLines) {
    const y0 = shape.bottomAt(z) + 0.05;
    const y1 = d.belt - 0.02;
    const N = 8;
    const pos: number[] = [];
    const idx: number[] = [];
    for (const side of [1, -1]) {
      const base = pos.length / 3;
      for (let k = 0; k <= N; k++) {
        const y = y0 + ((y1 - y0) * k) / N;
        const x = side * (shape.surfaceX(z, y) + 0.003);
        pos.push(x, y, z - 0.006, x, y, z + 0.006);
      }
      for (let k = 0; k < N; k++) {
        const a = base + k * 2;
        if (side > 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    mesh(geo, mats.black);
  }
  // Maçanetas (perto da borda traseira de cada porta).
  const hy = d.belt - 0.09;
  for (const z of [d.bPillar + 0.12, (d.midPillar ?? d.cPillar + 0.05) + 0.12]) {
    for (const s of [1, -1]) box(0.025, 0.03, 0.15, st.chrome ? mats.trim : mats.paint, s * (shape.surfaceX(z, hy) + 0.01), hy, z);
  }

  // Retrovisores: haste e carcaça, no pé da coluna A.
  const mz = g.base - 0.22;
  const my = d.belt + 0.08;
  for (const s of [1, -1]) {
    const x = shape.hwAt(mz) - 0.02;
    box(0.1, 0.04, 0.08, mats.black, s * (x + 0.04), my - 0.03, mz);
    const housing = box(0.09, 0.1, 0.14, st.blackRoof ? mats.black : mats.paint, s * (x + 0.13), my, mz - 0.02);
    housing.rotation.y = s * 0.12;
    const glassM = box(0.075, 0.085, 0.01, mats.glass, s * (x + 0.13), my, mz - 0.095);
    glassM.rotation.y = s * 0.12;
  }

  // Barras de teto (SUVs).
  if (st.rails) {
    const len = g.roofFront - g.roofRear - 0.1;
    const zc = (g.roofFront + g.roofRear) / 2;
    for (const s of [1, -1]) box(0.04, 0.045, len, mats.black, s * (g.roofHalf - 0.1), d.height + 0.02, zc);
  }
}

/** Roda: pneu (perfil revolucionado), aro com raios, cubo. Face externa em +X (lado esquerdo). */
function buildWheel(d: CarDesign, mats: Mats, segs: number, low: boolean): THREE.Group {
  const g = new THREE.Group();
  const r = d.wheelRadius;
  const tw = d.tireWidth;
  const rimR = r * 0.68;
  const profile = [
    [rimR, -tw / 2],
    [r * 0.94, -tw / 2],
    [r, -tw * 0.32],
    [r, tw * 0.32],
    [r * 0.94, tw / 2],
    [rimR, tw / 2],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const tire = new THREE.Mesh(new THREE.LatheGeometry(profile, segs).rotateZ(-Math.PI / 2), mats.tire);
  g.add(tire);
  // Fundo escuro do aro (entre os raios) e borda.
  const back = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, tw * 0.6, segs, 1, true).rotateZ(Math.PI / 2), mats.black);
  back.material.side = THREE.DoubleSide;
  g.add(back);
  const dish = new THREE.Mesh(new THREE.CircleGeometry(rimR, segs).rotateY(Math.PI / 2), mats.black);
  dish.position.x = tw * 0.05;
  g.add(dish);
  const face = tw / 2 - 0.025;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.008, 0.014, 6, segs).rotateY(Math.PI / 2), mats.rim);
  lip.position.x = face;
  g.add(lip);
  const sp = d.style.rim;
  const count = low ? Math.min(sp.spokes, 6) : sp.spokes;
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    const offsets = sp.twin && !low ? [-0.06, 0.06] : [0];
    for (const o of offsets) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, rimR * 0.82, sp.twin ? 0.028 : 0.05), mats.rim);
      spoke.position.set(face - 0.01, 0, 0);
      const pivot = new THREE.Group();
      pivot.rotation.x = a + o;
      spoke.position.y = rimR * 0.5;
      pivot.add(spoke);
      g.add(pivot);
    }
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.26, rimR * 0.3, 0.05, 12).rotateZ(Math.PI / 2), mats.rim);
  hub.position.x = face - 0.005;
  g.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.13, rimR * 0.13, 0.02, 10).rotateZ(Math.PI / 2), mats.trim);
  cap.position.x = face + 0.02;
  g.add(cap);
  return g;
}
