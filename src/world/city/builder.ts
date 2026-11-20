// Contexto compartilhado pelos geradores de cada região: raiz da cena, materiais, áreas ocupadas
// (para árvores/postes não nascerem dentro de prédios e pistas), pontos de interesse, endereços e placas.
import * as THREE from 'three';
import { createRng } from '../../core/random';
import type { AddressPoint, Landmark } from '../Level';
import { canvasTexture, createMaterials, type Materials } from './materials';
import { ROAD } from './layout';

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function rectOf(x: number, z: number, w: number, d: number, margin = 0): Rect {
  return { minX: x - w / 2 - margin, maxX: x + w / 2 + margin, minZ: z - d / 2 - margin, maxZ: z + d / 2 + margin };
}

export function inRect(r: Rect, x: number, z: number): boolean {
  return x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;
}

/** Linha onde postes de luz são distribuídos (um lado da pista). */
export interface LampLine {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** Placa de endereço: até duas linhas de texto; yaw = para onde a face aponta. */
export interface SignSpec {
  x: number;
  z: number;
  yaw: number;
  title: string;
  subtitle?: string;
}

export type RoadKind = 'main' | 'local';

/** Eixo de um trecho dirigível (pista, viaduto, ponte), para o grafo de navegação da IA. */
export interface RoadSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  width: number;
}

export class CityBuilder {
  readonly root = new THREE.Group();
  readonly mats: Materials = createMaterials();
  readonly rng: () => number;
  /** Áreas onde não se planta árvore nem poste. */
  readonly occupied: Rect[] = [];
  /** Só as pistas (postes não podem cair em cima de outra pista). */
  readonly roadRects: Rect[] = [];
  /** Eixos das pistas e ligações (viadutos, ponte), para a IA dirigir pelas ruas (world/RoadGraph). */
  readonly roadSegments: RoadSegment[] = [];
  readonly lampLines: LampLine[] = [];
  readonly landmarks: Landmark[] = [];
  readonly addresses: AddressPoint[] = [];
  readonly signs: SignSpec[] = [];
  /** Árvores em posições escolhidas (cinturões das quadras, alamedas); plantadas antes dos bosques. */
  readonly treeSpots: { x: number; z: number; s: number }[] = [];

  constructor(seed: number) {
    this.rng = createRng(seed);
    this.root.name = 'cidade';
  }

  group(name: string, parent: THREE.Object3D = this.root): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    parent.add(g);
    return g;
  }

  occupy(r: Rect): void {
    this.occupied.push(r);
  }

  isFree(x: number, z: number): boolean {
    return !this.occupied.some((r) => inRect(r, x, z));
  }

  /** O retângulo não encosta em nada já ocupado (prédios, pistas com margem, praças…). */
  isRectFree(r: Rect): boolean {
    return !this.occupied.some((o) => o.minX < r.maxX && o.maxX > r.minX && o.minZ < r.maxZ && o.maxZ > r.minZ);
  }

  address(id: string, label: string, x: number, z: number): void {
    this.addresses.push({ id, label, x, z });
  }

  /** Caixa com sombra; posição = centro. */
  box(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material | THREE.Material[],
    x: number,
    y: number,
    z: number,
    name = '',
  ): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    m.name = name;
    parent.add(m);
    return m;
  }

  /** Piso baixo (calçada, praça): caixa sem sombra projetada. */
  slab(parent: THREE.Object3D, rect: Rect, height: number, mat: THREE.Material, y = 0): THREE.Mesh {
    const m = this.box(parent, rect.maxX - rect.minX, height, rect.maxZ - rect.minZ, mat, (rect.minX + rect.maxX) / 2, y + height / 2, (rect.minZ + rect.maxZ) / 2);
    m.castShadow = false;
    return m;
  }

  /**
   * Pista reta alinhada a um eixo (x1==x2 → ao longo de Z; z1==z2 → ao longo de X).
   * Só visual (o chão colide). Registra área ocupada e, se pedido, linhas de postes.
   */
  road(
    parent: THREE.Object3D,
    kind: RoadKind,
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    lamps: 'none' | 'left' | 'right' | 'both' = 'right',
  ): THREE.Mesh {
    const width = ROAD[kind];
    const alongZ = x1 === x2;
    const length = alongZ ? Math.abs(z2 - z1) : Math.abs(x2 - x1);
    const geo = new THREE.PlaneGeometry(width, length);
    // Repete a textura no comprimento (tile de 12 m) ajustando os UVs; o material é compartilhado.
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (length / 12));
    geo.rotateX(-Math.PI / 2); // V passa a correr ao longo de Z
    if (!alongZ) geo.rotateY(Math.PI / 2);
    const m = new THREE.Mesh(geo, kind === 'main' ? this.mats.road : this.mats.roadLocal);
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;
    m.position.set(cx, 0.02, cz);
    m.receiveShadow = true;
    m.userData.noCollision = true;
    m.userData.surface = 'asphalt';
    m.name = `pista-${kind}`;
    parent.add(m);

    const r = alongZ ? rectOf(cx, cz, width, length) : rectOf(cx, cz, length, width);
    this.roadRects.push(r);
    this.roadSegments.push({ x1, z1, x2, z2, width });
    this.occupy({ minX: r.minX - 3, maxX: r.maxX + 3, minZ: r.minZ - 3, maxZ: r.maxZ + 3 });

    const off = width / 2 + 2.5;
    const sides = lamps === 'both' ? [-1, 1] : lamps === 'left' ? [-1] : lamps === 'right' ? [1] : [];
    for (const s of sides) {
      if (alongZ) this.lampLines.push({ x1: x1 + s * off, z1, x2: x2 + s * off, z2 });
      else this.lampLines.push({ x1, z1: z1 + s * off, x2, z2: z2 + s * off });
    }
    return m;
  }

  /** Trecho dirigível que não é uma pista comum (viaduto, ponte): só entra no grafo de navegação. */
  navLink(x1: number, z1: number, x2: number, z2: number, width: number): void {
    this.roadSegments.push({ x1, z1, x2, z2, width });
  }

  /**
   * Cunha sólida (rampa) alinhada a X ou Z: perfil de altura h0 → h1 entre a0 → a1 no eixo principal,
   * com largura `width` centrada em `c` no outro eixo. Colide como casco convexo.
   */
  wedge(
    parent: THREE.Object3D,
    axis: 'x' | 'z',
    a0: number,
    a1: number,
    h0: number,
    h1: number,
    c: number,
    width: number,
    mat: THREE.Material,
  ): THREE.Mesh {
    const shape = new THREE.Shape([
      new THREE.Vector2(a0, 0),
      new THREE.Vector2(a1, 0),
      new THREE.Vector2(a1, h1),
      new THREE.Vector2(a0, h0),
    ]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    // Shape no plano XY (a, h) extrudado em Z; centraliza a largura e, para 'z', gira −90° em Y
    // (rotação, não reflexão: as faces continuam voltadas para fora).
    geo.translate(0, 0, -width / 2);
    if (axis === 'z') {
      geo.rotateY(-Math.PI / 2); // (a, h, w) → (−w, h, a)
      geo.translate(c, 0, 0);
    } else {
      geo.translate(0, 0, c);
    }
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    m.userData.collider = 'convex';
    m.userData.surface = mat === this.mats.asphaltSolid ? 'asphalt' : 'concrete';
    parent.add(m);
    return m;
  }

  /** Letreiro de texto (plano com textura de canvas, sem colisão); yaw = para onde a face aponta. */
  letreiro(
    parent: THREE.Object3D,
    text: string,
    x: number,
    y: number,
    z: number,
    yaw: number,
    width: number,
    height: number,
    colors: { bg: string; fg: string } = { bg: '#1d2a33', fg: '#ffe9b0' },
  ): THREE.Mesh {
    const px = Math.max(256, Math.min(1024, Math.round((512 * width) / height / 4) * 4));
    const tex = canvasTexture(px, 128, (ctx) => {
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, px, 128);
      ctx.fillStyle = colors.fg;
      ctx.font = 'bold 72px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, px / 2, 68, px - 24);
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.userData.noCollision = true;
    m.userData.noBatch = true;
    m.userData.cullDistance = 500;
    parent.add(m);
    return m;
  }

  /** Cilindro entre dois pontos (pernas de torre, estais…). */
  cylinderBetween(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material, segments = 6): THREE.Mesh {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), segments), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** InstancedMesh a partir de uma lista de matrizes (e cores opcionais). */
  instanced(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material | THREE.Material[],
    matrices: THREE.Matrix4[],
    colors?: THREE.Color[],
    name = '',
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    colors?.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  }
}

/**
 * Como `instanced`, mas divide as instâncias em blocos espaciais de `cell` metros.
 * Um único InstancedMesh com milhares de árvores nunca sai do frustum (a esfera envolve o mapa
 * inteiro), então é desenhado sempre, inclusive no passe de sombra; em blocos, o culling funciona.
 */
export function instancedChunked(
  b: CityBuilder,
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material | THREE.Material[],
  matrices: THREE.Matrix4[],
  colors: THREE.Color[] | undefined,
  name: string,
  cell = 600,
): THREE.InstancedMesh[] {
  const buckets = new Map<string, number[]>();
  const p = new THREE.Vector3();
  matrices.forEach((m, i) => {
    p.setFromMatrixPosition(m);
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(i);
  });
  return [...buckets.values()].map((idx) =>
    b.instanced(parent, geo, mat, idx.map((i) => matrices[i]), colors && idx.map((i) => colors[i]), name),
  );
}

/** Matriz de translação + rotação em Y (+ escala uniforme). */
export function placeMatrix(x: number, y: number, z: number, yaw = 0, scale = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(scale, scale, scale),
  );
}
