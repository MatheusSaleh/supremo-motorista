// Elementos repetidos (sempre instanciados): árvores, postes de luz e placas de endereço.
// Roda depois das regiões, porque depende das áreas ocupadas e das linhas de postes registradas.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { inRect, instancedChunked, placeMatrix, type CityBuilder, type Rect } from './builder';
import { canvasTexture, factionFlagMaterial } from './materials';
import { TERRITORIES, type FactionId } from '../../data/factions';

/** Distâncias de desenho (m, na qualidade média; ver World.cullDetail). */
export const DRAW = { trees: 700, lamps: 800, signs: 320, boards: 500, stalls: 900 };

/** Postes a cada `spacing` metros ao longo das linhas registradas pelas pistas. */
export function buildStreetLights(b: CityBuilder, spacing = 42): void {
  const matrices: THREE.Matrix4[] = [];
  for (const line of b.lampLines) {
    const len = Math.hypot(line.x2 - line.x1, line.z2 - line.z1);
    const n = Math.floor(len / spacing);
    // Braço do poste aponta para a pista: o lado é deduzido pela posição relativa à linha da pista.
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const x = line.x1 + (line.x2 - line.x1) * k;
      const z = line.z1 + (line.z2 - line.z1) * k;
      if (b.roadRects.some((r) => inRect(r, x, z))) continue; // não cai em cima de outra pista
      const nearest = nearestRoadDir(b.roadRects, x, z);
      matrices.push(placeMatrix(x, 0, z, nearest));
    }
  }
  const pole = new THREE.CylinderGeometry(0.12, 0.18, 9, 6).translate(0, 4.5, 0);
  const arm = new THREE.BoxGeometry(0.12, 0.12, 2.2).translate(0, 8.8, 1.1);
  const head = new THREE.BoxGeometry(0.5, 0.2, 0.9).translate(0, 8.7, 2.1);
  // UV constante por peça: a luminária usa a metade "acesa" do emissiveMap do material.
  const flatUv = (g: THREE.BufferGeometry, u: number) => {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u, 0.5);
    return g;
  };
  const geo = mergeGeometries([flatUv(pole, 0.25), flatUv(arm, 0.25), flatUv(head, 0.75)].map((p) => p.toNonIndexed()));
  instancedChunked(b, b.root, geo, b.mats.streetLamp, matrices, undefined, 'postes').forEach((mesh, chunk) => {
    mesh.userData.cullDistance = DRAW.lamps;
    mesh.userData.collider = 'pole';
    mesh.userData.cameraIgnore = true;
    breakable(mesh, 'pole', `poste-${chunk}`);
  });
}

/** Yaw (rad) que aponta o braço do poste (+Z local) para a pista mais próxima. */
function nearestRoadDir(rects: Rect[], x: number, z: number): number {
  let best = Infinity;
  let yaw = 0;
  for (const r of rects) {
    const cx = Math.max(r.minX, Math.min(x, r.maxX));
    const cz = Math.max(r.minZ, Math.min(z, r.maxZ));
    const d = Math.hypot(cx - x, cz - z);
    if (d < best) {
      best = d;
      yaw = Math.atan2(cx - x, cz - z);
    }
  }
  return yaw;
}

/** Árvores: bosques aleatórios em terra livre + algumas fileiras. Semente fixa → mesmo mapa sempre. */
export function buildTrees(b: CityBuilder, land: Rect[], count: number): void {
  const pos: { x: number; z: number; s: number }[] = [];
  const cell = 8; // grade para checar distância mínima sem O(n²)
  const grid = new Set<string>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const tryAdd = (x: number, z: number, s: number) => {
    if (!b.isFree(x, z) || grid.has(key(x, z))) return false;
    grid.add(key(x, z));
    pos.push({ x, z, s });
    return true;
  };

  for (const t of b.treeSpots) tryAdd(t.x, t.z, t.s);
  const goal = pos.length + count; // os bosques vêm além das árvores plantadas

  // Bosques: escolhe um centro e espalha um punhado de árvores ao redor (parece mais natural).
  const area = land.map((r) => (r.maxX - r.minX) * (r.maxZ - r.minZ));
  const total = area.reduce((a, c) => a + c, 0);
  for (let tries = 0; tries < count * 3 && pos.length < goal; tries++) {
    let pick = b.rng() * total;
    let r = land[0];
    for (let i = 0; i < land.length; i++) {
      pick -= area[i];
      if (pick <= 0) {
        r = land[i];
        break;
      }
    }
    const cx = r.minX + b.rng() * (r.maxX - r.minX);
    const cz = r.minZ + b.rng() * (r.maxZ - r.minZ);
    const n = 3 + Math.floor(b.rng() * 6);
    for (let i = 0; i < n; i++) {
      const a = b.rng() * Math.PI * 2;
      const d = b.rng() * 22;
      tryAdd(cx + Math.cos(a) * d, cz + Math.sin(a) * d, 0.8 + b.rng() * 0.6);
    }
  }

  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 3, 6, 1, true).translate(0, 1.5, 0); // sem tampas (não aparecem)
  const crownGeo = new THREE.IcosahedronGeometry(2, 0).translate(0, 4.2, 0);
  const matrices = pos.map((p) => placeMatrix(p.x, 0, p.z, b.rng() * Math.PI * 2, p.s));
  const colors = pos.map(() => new THREE.Color().setHSL(0.24 + b.rng() * 0.08, 0.45 + b.rng() * 0.2, 0.28 + b.rng() * 0.1));
  const g = b.group('arvores');
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 1 });
  // Troncos e copas são divididos nos mesmos blocos e na mesma ordem: o id `arvore-<bloco>-<i>` liga os dois.
  instancedChunked(b, g, trunkGeo, trunkMat, matrices, undefined, 'troncos').forEach((trunks, chunk) => {
    trunks.userData.cullDistance = DRAW.trees;
    trunks.userData.collider = 'pole';
    trunks.userData.poleRadius = 0.3;
    trunks.userData.cameraIgnore = true;
    breakable(trunks, 'tree', `arvore-${chunk}`);
  });
  instancedChunked(b, g, crownGeo, b.mats.tintedFlat, matrices, colors, 'copas').forEach((crowns, chunk) => {
    crowns.userData.cullDistance = DRAW.trees;
    crowns.userData.noCollision = true;
    breakable(crowns, 'tree', `arvore-${chunk}`);
  });
}

/** Placas verdes de endereço (estilo das placas de Brasília), cada uma com sua textura de canvas. */
export function buildSigns(b: CityBuilder): void {
  const g = b.group('placas');
  const posts: THREE.Matrix4[] = [];
  for (const s of b.signs) {
    const tex = canvasTexture(512, 200, (ctx) => {
      ctx.fillStyle = '#0f6b3a';
      ctx.fillRect(0, 0, 512, 200);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.strokeRect(8, 8, 496, 184);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 64px system-ui, sans-serif';
      ctx.fillText(s.title, 256, s.subtitle ? 80 : 100, 470);
      if (s.subtitle) {
        ctx.font = '28px system-ui, sans-serif';
        ctx.fillText(s.subtitle, 256, 150, 470);
      }
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.95), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    board.position.set(s.x, 4.2, s.z);
    board.rotation.y = s.yaw;
    board.userData.noCollision = true;
    board.userData.cullDistance = DRAW.signs;
    board.userData.breakKind = 'sign';
    board.userData.breakId = `placa-${b.signs.indexOf(s)}`;
    g.add(board);
    // Verso cinza.
    const backPanel = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.95), b.mats.signPost);
    backPanel.position.copy(board.position);
    backPanel.rotation.y = s.yaw + Math.PI;
    backPanel.userData.noCollision = true;
    backPanel.userData.cullDistance = DRAW.signs;
    backPanel.userData.breakKind = 'sign';
    backPanel.userData.breakId = board.userData.breakId;
    g.add(backPanel);
    // Dois postes, um pouco atrás do painel (para não cobrir o texto).
    const right = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    const back = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw)).multiplyScalar(0.15);
    for (const k of [-2, 2]) posts.push(placeMatrix(s.x + right.x * k + back.x, 0, s.z + right.z * k + back.z));
  }
  const postMesh = b.instanced(g, new THREE.CylinderGeometry(0.09, 0.09, 5.2, 6).translate(0, 2.6, 0), b.mats.signPost, posts, undefined, 'postes-placas');
  postMesh.userData.collider = 'pole';
  postMesh.userData.cameraIgnore = true;
  postMesh.userData.breakKind = 'sign';
  postMesh.userData.breakIds = posts.map((_, i) => `placa-${Math.floor(i / 2)}`); // dois postes por placa
}

/** Paredes invisíveis nos limites da área jogável. */
export function buildBounds(b: CityBuilder, r: Rect): void {
  const g = b.group('limites');
  const h = 80;
  const t = 2;
  const mat = new THREE.MeshBasicMaterial({ visible: false });
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  for (const [sx, sz, x, z] of [
    [w, t, cx, r.minZ],
    [w, t, cx, r.maxZ],
    [t, d, r.minX, cz],
    [t, d, r.maxX, cz],
  ]) {
    const wall = b.box(g, sx, h, sz, mat, x, h / 2 - 10, z);
    wall.castShadow = wall.receiveShadow = false;
    wall.userData.cameraIgnore = true;
  }
}

/** Marca todas as instâncias como props quebráveis, com ids `${prefix}-${i}`. */
function breakable(mesh: THREE.InstancedMesh, kind: 'pole' | 'tree', prefix: string): void {
  mesh.userData.breakKind = kind;
  mesh.userData.breakIds = Array.from({ length: mesh.count }, (_, i) => `${prefix}-${i}`);
}

/**
 * Bandeiras das facções ao longo das ruas de cada território (a cada `spacing` metros, dos dois lados):
 * mostram de longe onde começa o território dos Vermelhos ou dos Amarelos.
 */
export function buildFactionFlags(b: CityBuilder, spacing = 55): void {
  const byFaction = new Map<FactionId, THREE.Matrix4[]>();
  for (const s of b.roadSegments) {
    const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
    const dx = (s.x2 - s.x1) / len;
    const dz = (s.z2 - s.z1) / len;
    for (let d = spacing / 2; d < len; d += spacing) {
      for (const side of [-1, 1]) {
        const off = s.width / 2 + 4.5;
        const x = s.x1 + dx * d - dz * side * off;
        const z = s.z1 + dz * d + dx * side * off;
        const terr = TERRITORIES.find((tr) => x > tr.minX && x < tr.maxX && z > tr.minZ && z < tr.maxZ);
        if (!terr || b.roadRects.some((r) => inRect(r, x, z))) continue;
        // Bandeira de frente para a rua.
        const list = byFaction.get(terr.faction) ?? [];
        list.push(placeMatrix(x, 0, z, Math.atan2(dx, dz)));
        byFaction.set(terr.faction, list);
      }
    }
  }
  const pole = new THREE.CylinderGeometry(0.05, 0.07, 6, 6).translate(0, 3, 0);
  const cloth = new THREE.PlaneGeometry(1.8, 1.1).translate(0.95, 5.3, 0);
  for (const [faction, matrices] of byFaction) {
    const poles = instancedChunked(b, b.root, pole, b.mats.signPost, matrices, undefined, 'mastros');
    const flags = instancedChunked(b, b.root, cloth, factionFlagMaterial(faction), matrices, undefined, `bandeiras-${faction}`);
    for (const m of [...poles, ...flags]) {
      m.userData.noCollision = true;
      m.userData.cullDistance = DRAW.signs;
      m.castShadow = false;
    }
  }
}
