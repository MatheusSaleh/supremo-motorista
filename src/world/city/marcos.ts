// Marcos reais de Brasília em low-poly, só como CENÁRIO (nomes reais permitidos apenas em placas e no
// minimapa; nunca em corridas, manchetes ou piadas — ver regras de conteúdo). O banco é fictício.
// Cada prédio busca a silhueta reconhecível, não a planta exata.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { t } from '../../core/i18n';
import { formatAddress, sectorName } from '../../data/addresses';
import { placeMatrix, rectOf, type CityBuilder } from './builder';
import { canvasTexture, createGlassFacadeTexture } from './materials';
import { createRng } from '../../core/random';
import { BOUNDS, EIXAO, EIXO, MARCOS, ROAD, ROAD_CENTER, ROAD_INNER, VIA_SUL } from './layout';

export function buildMarcos(b: CityBuilder): void {
  buildViaSul(b);
  buildEixoOeste(b);
  buildTst(b);
  buildPgr(b);
  buildInss(b);
  buildBanco(b);
  buildMuseuBiblioteca(b);
  buildPf(b);
  buildTeatro(b);
  buildAlvorada(b);
  buildTorreTv(b);
  buildEstadio(b);
  buildQg(b);
}

// ---------------------------------------------------------------------------
// Materiais próprios dos marcos (vidros coloridos com a textura de fachada)
// ---------------------------------------------------------------------------

function glass(tint: number, columns: number, floors: number, metalness = 0.3): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: tint, map: createGlassFacadeTexture(columns, floors), roughness: 0.3, metalness });
}

/** Coluna "de palácio" (perfil afilado, inspirada nas colunas do Planalto/Alvorada), extrudada fina. */
export function palaceColumnGeometry(h: number): THREE.BufferGeometry {
  const shape = new THREE.Shape([
    new THREE.Vector2(0, 0),
    new THREE.Vector2(1.6, h * 0.32),
    new THREE.Vector2(0.35, h),
    new THREE.Vector2(-0.35, h),
    new THREE.Vector2(-1.6, h * 0.32),
  ]);
  return new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false }).translate(0, 0, -0.25);
}

/**
 * Palácio com colunas afiladas nas fachadas longas (±X), caixa de vidro recuada e laje fina.
 * Usado pelo Planalto (Praça) e pelo Alvorada (beira do lago).
 */
export function buildColumnPalace(
  b: CityBuilder,
  g: THREE.Object3D,
  s: { x: number; z: number; w: number; d: number; h: number },
  options: { ramp?: 1 | -1; pool?: boolean } = {},
): void {
  const m = b.mats;
  b.slab(g, rectOf(s.x, s.z, s.w + 8, s.d + 8), 0.5, m.white);
  b.box(g, s.w - 8, s.h - 1.5, s.d - 6, m.glass, s.x, 0.5 + (s.h - 1.5) / 2, s.z);
  b.box(g, s.w + 6, 1.2, s.d + 4, m.white, s.x, s.h + 0.4, s.z);
  const cols: THREE.Matrix4[] = [];
  const n = Math.round(s.d / 9);
  for (let k = 0; k < n; k++) {
    const z = s.z - s.d / 2 + 4 + (k * (s.d - 8)) / (n - 1);
    for (const side of [-1, 1]) cols.push(placeMatrix(s.x + side * (s.w / 2 + 2), 0.5, z, Math.PI / 2));
  }
  b.instanced(g, palaceColumnGeometry(s.h - 0.2), m.white, cols, undefined, 'colunas-palacio');
  // Rampa de acesso diante da fachada (Planalto).
  if (options.ramp) {
    const front = s.x + options.ramp * (s.w / 2 + 4);
    b.wedge(g, 'x', Math.min(front, front + options.ramp * 30), Math.max(front, front + options.ramp * 30), options.ramp > 0 ? s.h * 0.45 : 0, options.ramp > 0 ? 0 : s.h * 0.45, s.z, 9, m.white);
  }
  if (options.pool) {
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(26, s.d * 0.9).rotateX(-Math.PI / 2), m.pool);
    pool.position.set(s.x + s.w / 2 + 22, 0.06, s.z);
    pool.userData.noCollision = true;
    g.add(pool);
  }
  b.occupy(rectOf(s.x, s.z, s.w + 10, s.d + 10, 4));
}

// ---------------------------------------------------------------------------
// Vias novas
// ---------------------------------------------------------------------------

function buildViaSul(b: CityBuilder): void {
  const g = b.group('via-sul');
  b.road(g, 'local', VIA_SUL.x, VIA_SUL.minZ, VIA_SUL.x, VIA_SUL.maxZ, 'right');
  b.signs.push({ x: VIA_SUL.x + ROAD.local / 2 + 4, z: -1300, yaw: Math.PI, title: 'SAA · TST · PGR', subtitle: sectorName('SAA') });
  b.signs.push({ x: VIA_SUL.x + ROAD.local / 2 + 4, z: 560, yaw: Math.PI, title: 'SBC · INSS', subtitle: sectorName('SBC') });
}

/** Eixo Monumental a oeste do Eixão (Torre de TV, Estádio, QG). */
function buildEixoOeste(b: CityBuilder): void {
  const g = b.group('eixo-oeste');
  const start = EIXAO.z + ROAD.main / 2;
  const end = BOUNDS.maxZ - 40;
  for (const side of [-1, 1]) b.road(g, 'main', side * ROAD_CENTER, start, side * ROAD_CENTER, end, side > 0 ? 'right' : 'left');
  b.occupy({ minX: -EIXO.lawnHalfWidth, maxX: EIXO.lawnHalfWidth, minZ: start, maxZ: end });
  // Transversal no fim (retorno).
  b.road(g, 'main', -ROAD_INNER, end - ROAD.main / 2, ROAD_INNER, end - ROAD.main / 2, 'none');
  b.signs.push({ x: ROAD_CENTER + ROAD.main / 2 + 4, z: start + 30, yaw: Math.PI, title: `SCR · ${t('place.torreTv')}`, subtitle: sectorName('SCR') });
}

// ---------------------------------------------------------------------------
// Prédios
// ---------------------------------------------------------------------------

/** TST: bloco horizontal longo de vidro escuro com brises verticais brancos e um anexo cilíndrico. */
function buildTst(b: CityBuilder): void {
  const s = MARCOS.tst;
  const g = b.group('tst');
  b.box(g, s.w, s.h, s.d, glass(0x6f8a92, s.d / 4, s.h / 4), s.x, s.h / 2, s.z, 'tst');
  b.box(g, s.w + 4, 1.4, s.d + 4, b.mats.white, s.x, s.h + 0.7, s.z);
  const fins: THREE.Matrix4[] = [];
  for (let z = s.z - s.d / 2 + 2; z <= s.z + s.d / 2 - 2; z += 4) fins.push(placeMatrix(s.x - s.w / 2 - 0.8, s.h / 2, z));
  b.instanced(g, new THREE.BoxGeometry(1.2, s.h, 0.5), b.mats.white, fins, undefined, 'brises-tst');
  // Anexo do plenário: cilindro baixo com cúpula rasa.
  const ax = s.x + s.w / 2 + 30;
  const annex = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 14, 28), b.mats.concrete);
  annex.position.set(ax, 7, s.z + 30);
  annex.castShadow = annex.receiveShadow = true;
  g.add(annex);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(22, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2), b.mats.white);
  dome.scale.y = 0.35;
  dome.position.set(ax, 14, s.z + 30);
  dome.castShadow = true;
  g.add(dome);
  b.occupy(rectOf(s.x + 25, s.z, s.w + 80, s.d + 10, 4));
  b.landmarks.push({ name: t('place.tst'), x: s.x, z: s.z });
  b.address('tst', formatAddress('SAA', [{ kind: 'quadra', v: 8 }, { kind: 'bloco', v: 'A' }]), VIA_SUL.x + ROAD.local / 2 + 5, s.z);
  b.letreiro(g, t('place.tst'), s.x - s.w / 2 - 1.6, s.h - 3, s.z, -Math.PI / 2, 42, 3.2, { bg: '#f3f1ea', fg: '#1d2a33' });
}

/** PGR: duas torres cilíndricas de vidro lado a lado, ligadas por passarela, sobre base horizontal. */
function buildPgr(b: CityBuilder): void {
  const p = MARCOS.pgr;
  const g = b.group('pgr');
  b.box(g, 70, 8, 120, b.mats.concrete, p.x, 4, p.z, 'pgr-base');
  const towers: [number, number, number][] = [
    [p.x, p.z - 30, 46],
    [p.x, p.z + 30, 36],
  ];
  for (const [x, z, h] of towers) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, h, 32), glass(0x7fa3b8, 14, h / 4));
    tower.position.set(x, 8 + h / 2, z);
    tower.castShadow = tower.receiveShadow = true;
    g.add(tower);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(21, 21, 1.2, 32), b.mats.white);
    cap.position.set(x, 8 + h + 0.6, z);
    g.add(cap);
  }
  b.box(g, 10, 5, 20, b.mats.glass, p.x, 30, p.z, 'pgr-passarela');
  b.occupy(rectOf(p.x, p.z, 74, 124, 4));
  b.landmarks.push({ name: t('place.pgr'), x: p.x, z: p.z });
  b.address('pgr', formatAddress('SAA', [{ kind: 'quadra', v: 4 }, { kind: 'lote', v: 1 }]), VIA_SUL.x + ROAD.local / 2 + 5, p.z);
}

/** INSS: lâmina alta de vidro azulado com letreiro no topo. */
function buildInss(b: CityBuilder): void {
  const s = MARCOS.inss;
  const g = b.group('inss');
  b.box(g, s.w, s.h, s.d, glass(0x9cc0de, s.d / 4, s.h / 3.5), s.x, s.h / 2, s.z, 'inss');
  b.box(g, s.w + 2, 2, s.d + 2, b.mats.concrete, s.x, s.h + 1, s.z);
  b.letreiro(g, t('place.inss'), s.x - s.w / 2 - 0.3, s.h - 4, s.z, -Math.PI / 2, 24, 5, { bg: '#1f5fa8', fg: '#ffffff' });
  b.occupy(rectOf(s.x, s.z, s.w, s.d, 4));
  b.landmarks.push({ name: t('place.inss'), x: s.x, z: s.z });
  b.address('inss', formatAddress('SBC', [{ kind: 'quadra', v: 2 }, { kind: 'bloco', v: 'O' }]), VIA_SUL.x + ROAD.local / 2 + 5, s.z);
}

/** Banco Confiança S.A. (fictício): torre de vidro dourado — onde, claro, sempre há um café servido. */
function buildBanco(b: CityBuilder): void {
  const s = MARCOS.banco;
  const g = b.group('banco-confianca');
  b.box(g, s.w + 20, 6, s.d + 20, b.mats.concreteDark, s.x, 3, s.z);
  b.box(g, s.w, s.h, s.d, glass(0xd8b45a, s.w / 3, s.h / 3.6, 0.5), s.x, s.h / 2 + 6, s.z, 'banco');
  b.box(g, s.w + 1, 4, s.d + 1, b.mats.metal, s.x, s.h + 8, s.z);
  b.letreiro(g, t('place.banco'), s.x - s.w / 2 - 0.6, s.h + 2, s.z, -Math.PI / 2, 28, 4, { bg: '#13213b', fg: '#e9c46a' });
  b.occupy(rectOf(s.x, s.z, s.w + 20, s.d + 20, 4));
  b.landmarks.push({ name: t('place.banco'), x: s.x, z: s.z });
  b.address('banco', formatAddress('SBC', [{ kind: 'quadra', v: 1 }, { kind: 'bloco', v: 'C' }]), VIA_SUL.x + ROAD.local / 2 + 5, s.z);
}

/** Museu Nacional (cúpula branca com rampa) e Biblioteca Nacional (bloco branco com brises). */
function buildMuseuBiblioteca(b: CityBuilder): void {
  const mu = MARCOS.museu;
  const g = b.group('setor-cultural-sul');
  const dome = new THREE.Mesh(new THREE.SphereGeometry(mu.r, 36, 12, 0, Math.PI * 2, 0, Math.PI / 2), b.mats.white);
  dome.scale.y = 0.62;
  dome.position.set(mu.x, 0, mu.z);
  dome.castShadow = dome.receiveShadow = true;
  dome.userData.collider = 'convex';
  g.add(dome);
  // Rampa curva externa (anel inclinado sugerido por uma faixa ao redor).
  const ring = new THREE.Mesh(new THREE.TorusGeometry(mu.r * 0.93, 0.8, 6, 48, Math.PI * 1.1), b.mats.white);
  ring.rotation.set(Math.PI / 2 - 0.25, 0, 0.6);
  ring.position.set(mu.x, 9, mu.z);
  ring.userData.noCollision = true;
  g.add(ring);
  b.occupy(rectOf(mu.x, mu.z, mu.r * 2, mu.r * 2, 4));
  b.landmarks.push({ name: t('place.museu'), x: mu.x, z: mu.z });
  b.address('museu', formatAddress('SCR', [{ kind: 'lote', v: 2 }]), mu.x + mu.r + 8, mu.z);

  const bi = MARCOS.biblioteca;
  b.box(g, bi.w, bi.h, bi.d, b.mats.white, bi.x, bi.h / 2, bi.z, 'biblioteca');
  const fins: THREE.Matrix4[] = [];
  for (let z = bi.z - bi.d / 2 + 2; z <= bi.z + bi.d / 2 - 2; z += 3) for (const sx of [-1, 1]) fins.push(placeMatrix(bi.x + sx * (bi.w / 2 + 0.6), bi.h / 2, z));
  b.instanced(g, new THREE.BoxGeometry(1, bi.h - 2, 0.35), b.mats.concreteDark, fins, undefined, 'brises-biblioteca');
  b.occupy(rectOf(bi.x, bi.z, bi.w + 4, bi.d, 4));
  b.landmarks.push({ name: t('place.biblioteca'), x: bi.x, z: bi.z });
  b.address('biblioteca', formatAddress('SCR', [{ kind: 'lote', v: 3 }]), bi.x + bi.w / 2 + 8, bi.z);
}

/**
 * Sede da Polícia Federal (SAIS): duas torres de ~18 andares, cada uma uma pilha de volumes facetados
 * (cantos chanfrados) deslocados e levemente girados entre si; na da direita, um volume em balanço no meio.
 * Fachada em faixas horizontais: peitoris brancos e vidros escuros, cinza e prateados em mosaico.
 * Na frente, muro baixo, letreiro de pedra escura e uma fileira de palmeiras. A frente fica em +Z (L2).
 */
function buildPf(b: CityBuilder): void {
  const s = MARCOS.pf;
  const g = b.group('pf');
  g.userData.drape = 'rigid'; // as torres sobem inteiras (não entortam com o relevo)
  const floor = 3.6;
  const facade = pfFacadeMaterial(floor);
  const roof = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.8 });

  b.slab(g, rectOf(s.x, s.z, s.w + 16, s.d + 10), 0.4, b.mats.plaza);
  /** Volume facetado: [w, d, chanfro, andar inicial, andares, dx, dz, giro]. */
  type Vol = [number, number, number, number, number, number, number, number];
  const towers: { cx: number; vols: Vol[] }[] = [
    {
      cx: s.x - 30,
      vols: [
        [50, 36, 8, 0, 5, -6, 5, 0], // embasamento largo
        [34, 31, 7, 0, 18, 3, -3, 0.07], // corpo principal
        [24, 29, 6, 8, 7, -16, -2, -0.06], // volume lateral, recuado no alto
      ],
    },
    {
      cx: s.x + 30,
      vols: [
        [34, 31, 7, 0, 19, -5, -5, -0.06], // corpo principal
        [46, 34, 8, 0, 5, 2, 5, 0], // embasamento
        [31, 33, 8, 6, 8, 11, 3, 0.1], // balanço no meio da torre
      ],
    },
  ];
  for (const t of towers) {
    let top = 0;
    for (const [w, d, ch, f0, n, dx, dz, rot] of t.vols) {
      const h = n * floor;
      const m = new THREE.Mesh(chamferedPrism(w, d, ch, h), [roof, facade]);
      m.position.set(t.cx + dx, 0.4 + f0 * floor, s.z + dz);
      m.rotation.y = rot;
      m.castShadow = m.receiveShadow = true;
      m.userData.collider = 'convex';
      g.add(m);
      if (f0 + n > top) top = f0 + n;
    }
    // Casa de máquinas escura no topo do corpo principal.
    const main = t.vols[0][4] > t.vols[1][4] ? t.vols[0] : t.vols[1];
    const cap = b.box(g, main[0] - 10, 3, main[1] - 10, roof, t.cx + main[5], 0.4 + top * floor + 1.5, s.z + main[6]);
    cap.rotation.y = main[7];
  }

  // Muro baixo na frente, com o letreiro em pedra escura.
  const front = s.z + s.d / 2 + 4;
  b.box(g, s.w - 10, 1.2, 0.5, b.mats.white, s.x, 1, front);
  b.box(g, 12, 2.6, 1.6, roof, s.x - 4, 1.7, front + 3);
  b.letreiro(g, t('place.pf'), s.x - 4, 1.8, front + 3.82, 0, 11, 1.1, { bg: '#2b2e33', fg: '#e8e4da' });

  // Palmeiras: tronco (colide como poste) e copa de folhas em leque.
  const palms: THREE.Matrix4[] = [];
  for (let x = s.x - s.w / 2; x <= s.x + s.w / 2; x += 10) palms.push(placeMatrix(x + (b.rng() - 0.5) * 2, 0.4, front - 3 + (b.rng() - 0.5) * 1.5, b.rng() * Math.PI * 2, 1.15 + b.rng() * 0.3));
  const trunks = b.instanced(g, new THREE.CylinderGeometry(0.2, 0.3, 8, 6).translate(0, 4, 0), new THREE.MeshStandardMaterial({ color: 0x7b6a55, roughness: 1 }), palms, undefined, 'palmeiras-troncos');
  trunks.userData.collider = 'pole';
  trunks.userData.poleRadius = 0.3;
  trunks.userData.cameraIgnore = true;
  const fronds = b.instanced(g, palmCrownGeometry(), new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.9, side: THREE.DoubleSide }), palms, undefined, 'palmeiras-copas');
  fronds.userData.noCollision = true;

  b.occupy(rectOf(s.x, s.z, s.w + 10, s.d + 10, 4));
  b.landmarks.push({ name: t('place.pf'), x: s.x, z: s.z });
  b.address('pf', formatAddress('SAA', [{ kind: 'quadra', v: 7 }, { kind: 'lote', v: 23 }]), s.x, s.z + s.d / 2 + 14);
}

/** Prisma vertical de planta retangular com os cantos chanfrados (octógono alongado), base em y = 0. */
function chamferedPrism(w: number, d: number, ch: number, h: number): THREE.BufferGeometry {
  const x = w / 2;
  const z = d / 2;
  const shape = new THREE.Shape([
    new THREE.Vector2(-x + ch, -z),
    new THREE.Vector2(x - ch, -z),
    new THREE.Vector2(x, -z + ch),
    new THREE.Vector2(x, z - ch),
    new THREE.Vector2(x - ch, z),
    new THREE.Vector2(-x + ch, z),
    new THREE.Vector2(-x, z - ch),
    new THREE.Vector2(-x, -z + ch),
  ]);
  // Extrude em Z (UV das laterais: u = metros ao longo da parede, v = metros de altura) e deita em Y.
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Fachada da PF: cada faixa é um andar (peitoril branco + vidro); o vidro alterna escuro/cinza/prata. */
function pfFacadeMaterial(floor: number): THREE.MeshStandardMaterial {
  const rng = createRng(77);
  const W = 512;
  const floors = 6;
  const H = 64 * floors;
  const tex = canvasTexture(W, H, (ctx) => {
    const dark = ['#2c343c', '#3a434c', '#4d5761'];
    const light = ['#8ea3b6', '#b4c6d6', '#d0dde7', '#6d7a87'];
    for (let f = 0; f < floors; f++) {
      const y = f * 64;
      ctx.fillStyle = '#eef0f0';
      ctx.fillRect(0, y, W, 12); // peitoril branco (a faixa que marca cada andar)
      // Cada andar tem um tom dominante (escuro ou prateado) com trechos longos do outro tom.
      const base = rng() < 0.5 ? dark : light;
      const other = base === dark ? light : dark;
      let x = 0;
      while (x < W) {
        const run = 32 * (2 + Math.floor(rng() * 6));
        const pal = rng() < 0.7 ? base : other;
        const c = pal[Math.floor(rng() * pal.length)];
        ctx.fillStyle = c;
        ctx.fillRect(x, y + 12, run, 52);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x, y + 44, run, 20); // metade de baixo do vidro, mais escura
        x += run;
      }
      ctx.fillStyle = 'rgba(220,224,226,0.18)';
      for (let k = 0; k < W; k += 32) ctx.fillRect(k, y + 12, 1, 52);
    }
  });
  // 1 textura = 24 m × 6 andares (UV das laterais em metros).
  tex.repeat.set(1 / 24, 1 / (floors * floor));
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.35 });
  m.emissive.set(0xffd9a0);
  m.emissiveMap = tex;
  m.emissiveIntensity = 0;
  m.userData.nightGlow = 0.25;
  return m;
}

/** Copa de palmeira: folhas em leque (planos finos inclinados para baixo) no alto de um tronco de 8 m. */
export function palmCrownGeometry(): THREE.BufferGeometry {
  const leaves: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.PlaneGeometry(0.9, 3.6).translate(0, 1.8, 0);
    leaf.rotateX(-1.1 + (i % 2) * 0.25); // abre e cai para fora
    leaf.rotateY((i / 7) * Math.PI * 2);
    leaves.push(leaf.translate(0, 7.8, 0));
  }
  return mergeGeometries(leaves);
}

/** Teatro Nacional: pirâmide truncada (tronco de base retangular). */
function buildTeatro(b: CityBuilder): void {
  const s = MARCOS.teatro;
  const g = b.group('teatro');
  // Cilindro de 4 lados girado 45° vira um tronco de pirâmide; escala para a base retangular.
  const geo = new THREE.CylinderGeometry(0.62, 1, 1, 4, 1).rotateY(Math.PI / 4);
  geo.scale(s.w / Math.SQRT2, s.h, s.d / Math.SQRT2);
  // Relevo de cubos nas faces inclinadas (a marca do Teatro), como textura de canvas.
  const rng = createRng(1966);
  const relief = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#d6d0c2';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) {
      for (let x = 0; x < 256; x += 16) {
        if (rng() < 0.45) continue;
        const v = 150 + Math.floor(rng() * 80);
        ctx.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
        ctx.fillRect(x + 2, y + 2, 12, 12);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x + 2, y + 13, 12, 2);
      }
    }
  });
  relief.repeat.set(8, 3);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: relief, roughness: 0.9, flatShading: true }));
  mesh.position.set(s.x, s.h / 2, s.z);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.collider = 'convex';
  g.add(mesh);
  b.occupy(rectOf(s.x, s.z, s.w, s.d, 4));
  b.landmarks.push({ name: t('place.teatro'), x: s.x, z: s.z });
  b.address('teatro', formatAddress('SCR', [{ kind: 'lote', v: 1 }]), s.x + s.w / 2 + 8, s.z);
}

/** Palácio da Alvorada à beira do lago, com espelho d'água. */
function buildAlvorada(b: CityBuilder): void {
  const s = MARCOS.alvorada;
  const g = b.group('alvorada');
  buildColumnPalace(b, g, s, { pool: true });
  b.landmarks.push({ name: t('place.alvorada'), x: s.x, z: s.z });
}

/** Torre de TV: quatro pernas que convergem até o mirante, fuste treliçado e antena. */
function buildTorreTv(b: CityBuilder): void {
  const { x, z } = MARCOS.torreTv;
  const g = b.group('torre-tv');
  const m = b.mats;
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.5, metalness: 0.6 });
  b.slab(g, rectOf(x, z, 70, 70), 0.3, m.plaza);
  const deckY = 75;
  const shaftTop = 180;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const foot = new THREE.Vector3(x + sx * 18, 0, z + sz * 18);
    const knee = new THREE.Vector3(x + sx * 4, deckY, z + sz * 4);
    const leg = b.cylinderBetween(g, foot, knee, 1.1, steel);
    leg.userData.collider = 'convex';
    leg.userData.cameraIgnore = true;
    const top = new THREE.Vector3(x + sx * 2.5, shaftTop, z + sz * 2.5);
    b.cylinderBetween(g, knee, top, 0.6, steel).userData.noCollision = true;
  }
  // Travamentos em X entre as pernas (só visuais).
  const brace = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.5 });
  for (let y = 20; y < shaftTop; y += y < deckY ? 18 : 15) {
    const spread = y < deckY ? 18 - (14 * y) / deckY : 4 - (1.5 * (y - deckY)) / (shaftTop - deckY);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => new THREE.Vector3(x + sx * spread, y, z + sz * spread));
    for (let i = 0; i < 4; i++) b.cylinderBetween(g, corners[i], corners[(i + 1) % 4], 0.25, brace, 4).userData.noCollision = true;
  }
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(13, 11, 7, 8), m.glass);
  deck.position.set(x, deckY + 3.5, z);
  deck.userData.noCollision = true;
  deck.castShadow = true;
  g.add(deck);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 1, 8), m.white);
  roof.position.set(x, deckY + 7.5, z);
  roof.userData.noCollision = true;
  g.add(roof);
  b.cylinderBetween(g, new THREE.Vector3(x, shaftTop, z), new THREE.Vector3(x, 224, z), 0.5, m.white, 6).userData.noCollision = true;
  b.landmarks.push({ name: t('place.torreTv'), x, z });
  b.address('torre-tv', formatAddress('SCR', [{ kind: 'lote', v: 7 }]), x + 45, z);
}

/** Estádio Nacional: anel elíptico de pilares, cobertura em anel e arquibancada. */
function buildEstadio(b: CityBuilder): void {
  const s = MARCOS.estadio;
  const g = b.group('estadio');
  const pillars: THREE.Matrix4[] = [];
  const n = 96;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pillars.push(placeMatrix(s.x + Math.cos(a) * s.a, 23, s.z + Math.sin(a) * s.b, -a));
  }
  b.instanced(g, new THREE.BoxGeometry(1.6, 46, 1.6), b.mats.white, pillars, undefined, 'pilares-estadio');
  // Cobertura: anel achatado na elipse (só visual).
  const roof = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.02, 64).rotateX(-Math.PI / 2), b.mats.whiteDouble);
  roof.scale.set(s.a, 1, s.b);
  roof.position.set(s.x, 46, s.z);
  roof.userData.noCollision = true;
  roof.castShadow = true;
  g.add(roof);
  // Arquibancada: tronco de cone aberto, achatado na elipse (colide: contorna o gramado).
  const stands = new THREE.Mesh(new THREE.CylinderGeometry(0.93, 0.62, 28, 48, 1, true), b.mats.concreteDark);
  stands.scale.set(s.a, 1, s.b);
  stands.position.set(s.x, 14, s.z);
  stands.material = (stands.material as THREE.MeshStandardMaterial).clone();
  (stands.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  stands.castShadow = stands.receiveShadow = true;
  g.add(stands);
  const field = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 1 }));
  field.scale.set(s.a * 0.6, 1, s.b * 0.6);
  field.position.set(s.x, 0.05, s.z);
  field.userData.noCollision = true;
  field.receiveShadow = true;
  g.add(field);
  b.occupy(rectOf(s.x, s.z, s.a * 2 + 10, s.b * 2 + 10, 4));
  b.landmarks.push({ name: t('place.estadio'), x: s.x, z: s.z });
  b.address('estadio', formatAddress('SCR', [{ kind: 'lote', v: 9 }]), s.x + s.a + 12, s.z);
}

/** QG do Exército: prédio longo em arco, praça em frente com obelisco e concha acústica. */
function buildQg(b: CityBuilder): void {
  const q = MARCOS.qg;
  const g = b.group('qg');
  const segs = 28;
  const segLen = (q.r * q.arc) / segs + 0.6;
  const matrices: THREE.Matrix4[] = [];
  for (let i = 0; i < segs; i++) {
    const a = -q.arc / 2 + ((i + 0.5) / segs) * q.arc;
    const x = q.cx + Math.cos(a) * q.r;
    const z = q.cz + Math.sin(a) * q.r;
    // Segmento tangente ao arco (comprimento ao longo da tangente).
    matrices.push(placeMatrix(x, 12, z, -a));
  }
  const geo = new THREE.BoxGeometry(18, 24, segLen);
  // Grupos: +X/−X são as fachadas longas (radiais ao arco); ±Z são as juntas entre segmentos.
  b.instanced(g, geo, [b.mats.blockFacade, b.mats.blockFacade, b.mats.roof, b.mats.roof, b.mats.concrete, b.mats.concrete], matrices, undefined, 'qg-arco');
  // Obelisco no centro da praça.
  const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.4, 42, 4).rotateY(Math.PI / 4), b.mats.white);
  obelisk.position.set(q.cx + 60, 21, q.cz);
  obelisk.castShadow = obelisk.receiveShadow = true;
  obelisk.userData.collider = 'convex';
  g.add(obelisk);
  // Concha acústica (meia cúpula voltada para a praça).
  const shell = new THREE.Mesh(new THREE.SphereGeometry(16, 20, 10, Math.PI / 2, Math.PI, 0, Math.PI / 2), b.mats.whiteDouble);
  shell.position.set(q.cx - 20, 0, q.cz);
  shell.castShadow = true;
  shell.userData.collider = 'convex';
  g.add(shell);
  b.slab(g, rectOf(q.cx + 40, q.cz, 200, 320), 0.1, b.mats.plaza);
  b.occupy(rectOf(q.cx + q.r / 2, q.cz, q.r + 60, q.r * 2 * Math.sin(q.arc / 2) + 40, 4));
  b.landmarks.push({ name: t('place.qg'), x: q.cx + q.r, z: q.cz });
  b.address('qg', formatAddress('SMB', [{ kind: 'quadra', v: 1 }, { kind: 'bloco', v: 'A' }]), q.cx + 140, q.cz);
}
