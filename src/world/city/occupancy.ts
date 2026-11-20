// Diagnóstico do plano de densificação (docs/PLANO-MAPA.md): uma grade em planta que marca onde há
// "ocupação" (prédio, pista, praça, estacionamento, mobiliário) e mede quanto da terra firme fica longe
// de tudo, isto é, gramado vazio. Árvores e o próprio chão não contam como ocupação.
// Roda sobre a cidade ainda no plano (antes do relevo e do agrupamento de malhas), só em modo dev.
import * as THREE from 'three';
import { inRect, type Rect } from './builder';

export interface OccupancyReport {
  /** Lado da célula (m). */
  cell: number;
  cols: number;
  rows: number;
  minX: number;
  minZ: number;
  /** Por célula: 0 = água/fora, 1 = ocupada, 2 = livre mas perto de algo, 3 = vazia (longe de tudo), 4 = vazio intencional. */
  grid: Uint8Array;
  /** Fração da terra firme (sem as áreas abertas de propósito) que está vazia. */
  emptyFraction: number;
  /** Maior mancha vazia contígua (km²). */
  largestEmptyKm2: number;
}

/** Distância (m) até a ocupação mais próxima a partir da qual a célula conta como gramado vazio. */
export const EMPTY_RADIUS = 60;

const IGNORE_NAMES = new Set(['troncos', 'copas', 'chao', 'arvores', 'limites']);

export function measureOccupancy(root: THREE.Object3D, bounds: Rect, land: Rect[], openOnPurpose: Rect[], cell = 10): OccupancyReport {
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
  const grid = new Uint8Array(cols * rows);
  const occupied = new Uint8Array(cols * rows);
  const mark = (r: { minX: number; maxX: number; minZ: number; maxZ: number }) => {
    const c0 = Math.max(0, Math.floor((r.minX - bounds.minX) / cell));
    const c1 = Math.min(cols - 1, Math.floor((r.maxX - bounds.minX) / cell));
    const r0 = Math.max(0, Math.floor((r.minZ - bounds.minZ) / cell));
    const r1 = Math.min(rows - 1, Math.floor((r.maxZ - bounds.minZ) / cell));
    for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) occupied[j * cols + i] = 1;
  };

  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  const skip = (o: THREE.Object3D): boolean => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      if (IGNORE_NAMES.has(p.name) || p.userData.drape === 'ground') return true;
    }
    return false;
  };
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || skip(o)) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mat && (mat as THREE.Material).visible === false) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (o instanceof THREE.InstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        mark(boxToRect(box.copy(o.geometry.boundingBox!).applyMatrix4(m.premultiply(o.matrixWorld))));
      }
      return;
    }
    // Água e fundo do lago não contam.
    if (o.userData.noDrape) return;
    mark(boxToRect(box.copy(o.geometry.boundingBox!).applyMatrix4(o.matrixWorld)));
  });

  // Distância (em células) até a ocupação mais próxima: transformada de distância por chanfro (2 passadas).
  const INF = 1e9;
  const dist = new Float32Array(cols * rows);
  for (let k = 0; k < dist.length; k++) dist[k] = occupied[k] ? 0 : INF;
  const D = Math.SQRT2;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (i > 0) dist[k] = Math.min(dist[k], dist[k - 1] + 1);
      if (j > 0) dist[k] = Math.min(dist[k], dist[k - cols] + 1);
      if (i > 0 && j > 0) dist[k] = Math.min(dist[k], dist[k - cols - 1] + D);
      if (i < cols - 1 && j > 0) dist[k] = Math.min(dist[k], dist[k - cols + 1] + D);
    }
  for (let j = rows - 1; j >= 0; j--)
    for (let i = cols - 1; i >= 0; i--) {
      const k = j * cols + i;
      if (i < cols - 1) dist[k] = Math.min(dist[k], dist[k + 1] + 1);
      if (j < rows - 1) dist[k] = Math.min(dist[k], dist[k + cols] + 1);
      if (i < cols - 1 && j < rows - 1) dist[k] = Math.min(dist[k], dist[k + cols + 1] + D);
      if (i > 0 && j < rows - 1) dist[k] = Math.min(dist[k], dist[k + cols - 1] + D);
    }

  let landCells = 0;
  let emptyCells = 0;
  const limit = EMPTY_RADIUS / cell;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const x = bounds.minX + (i + 0.5) * cell;
      const z = bounds.minZ + (j + 0.5) * cell;
      if (!land.some((r) => inRect(r, x, z))) continue; // água
      if (occupied[k]) grid[k] = 1;
      else if (openOnPurpose.some((r) => inRect(r, x, z))) grid[k] = 4;
      else grid[k] = dist[k] > limit ? 3 : 2;
      if (grid[k] === 4) continue;
      landCells++;
      if (grid[k] === 3) emptyCells++;
    }

  // Maior mancha vazia (busca em largura sobre as células 3).
  const seen = new Uint8Array(cols * rows);
  let largest = 0;
  const queue: number[] = [];
  for (let s = 0; s < grid.length; s++) {
    if (grid[s] !== 3 || seen[s]) continue;
    let size = 0;
    queue.length = 0;
    queue.push(s);
    seen[s] = 1;
    while (queue.length) {
      const k = queue.pop()!;
      size++;
      const i = k % cols;
      for (const n of [k - 1, k + 1, k - cols, k + cols]) {
        if (n < 0 || n >= grid.length || seen[n] || grid[n] !== 3) continue;
        if ((n === k - 1 && i === 0) || (n === k + 1 && i === cols - 1)) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    largest = Math.max(largest, size);
  }

  return {
    cell,
    cols,
    rows,
    minX: bounds.minX,
    minZ: bounds.minZ,
    grid,
    emptyFraction: landCells ? emptyCells / landCells : 0,
    largestEmptyKm2: (largest * cell * cell) / 1e6,
  };
}

function boxToRect(b: THREE.Box3): Rect {
  return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
}

/** Desenha o relatório num canvas (norte do mapa = −Z no topo, como o minimapa). */
export function drawOccupancy(r: OccupancyReport, px = 2): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = r.cols * px;
  canvas.height = r.rows * px;
  const ctx = canvas.getContext('2d')!;
  const colors = ['#2a5f86', '#3b3b3f', '#6f9a4a', '#d23b3b', '#a7c98a'];
  for (let j = 0; j < r.rows; j++)
    for (let i = 0; i < r.cols; i++) {
      ctx.fillStyle = colors[r.grid[j * r.cols + i]];
      ctx.fillRect(i * px, j * px, px, px);
    }
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, canvas.width, 34);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillText(`vazio: ${(r.emptyFraction * 100).toFixed(1)}% · maior mancha: ${r.largestEmptyKm2.toFixed(2)} km²`, 10, 23);
  return canvas;
}
