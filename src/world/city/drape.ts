// "Assenta" a cidade (gerada no plano y = 0) sobre o relevo:
//  - objetos pequenos (prédios comuns, placas, quiosques) sobem inteiros, pela altura mais baixa do
//    terreno sob eles (ficam nivelados e sem vão por baixo);
//  - malhas grandes (chão, pistas, calçadões, ministérios, muretas) são subdivididas e cada vértice
//    acompanha o terreno;
//  - instâncias (árvores, postes) sobem cada uma pela altura do seu ponto;
//  - userData.drape = 'rigid' faz um grupo grande subir inteiro (torres que não podem entortar).
// Malhas deformadas deixam de ser BoxGeometry, então o World gera trimesh para elas.
// userData.noDrape = true deixa um objeto (e seus filhos) como está (água, fundo do lago).
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

type HeightFn = (x: number, z: number) => number;

/** Até este tamanho (m, maior lado em planta) o objeto sobe inteiro. */
const RIGID_SIZE = 32;
/** Arestas mais longas que isto (m, em planta) são divididas antes de deformar. */
const MAX_EDGE = 24;
/**
 * Arestas em que o relevo se afasta mais que isto (m) da reta entre as pontas também são divididas
 * (até MIN_EDGE). Onde o terreno faz curva (transição das áreas planas, margem do lago), triângulos de
 * 24 m chegavam a ficar ~1 m acima ou abaixo do relevo, e a grama atravessava o asfalto.
 */
const MAX_SAG = 0.015;
const MIN_EDGE = 1.5;
/** Altura (m) até a qual uma malha conta como piso (pista, calçada, praça). */
const FLAT_HEIGHT = 1;

/**
 * O chão (userData.drape = 'ground') é deformado primeiro. Os pisos deformados (pistas, calçadas) seguem
 * o mais alto entre o relevo e a superfície já triangulada do chão, para nunca ficarem abaixo da grama.
 */
export function drapeOnTerrain(root: THREE.Object3D, heightAt: HeightFn): void {
  root.updateMatrixWorld(true);
  const grounds: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.drape === 'ground') grounds.push(o);
  });
  for (const g of grounds) deformMesh(g, heightAt, heightAt);
  const groundAt = groundSampler(grounds);
  const surfaceAt: HeightFn = (x, z) => Math.max(heightAt(x, z), groundAt(x, z) ?? -Infinity);

  const box = new THREE.Box3();
  const visit = (obj: THREE.Object3D) => {
    if (obj.userData.noDrape || obj.userData.drape === 'ground') return;
    if (obj instanceof THREE.InstancedMesh) {
      shiftInstances(obj, heightAt);
      return;
    }
    if (obj !== root && hasMesh(obj)) {
      box.setFromObject(obj);
      const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      if ((size <= RIGID_SIZE || obj.userData.drape === 'rigid') && !(obj instanceof THREE.Mesh && obj.userData.drape === 'deform')) {
        const dy = Math.min(
          heightAt(box.min.x, box.min.z),
          heightAt(box.max.x, box.min.z),
          heightAt(box.min.x, box.max.z),
          heightAt(box.max.x, box.max.z),
          heightAt((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2),
        );
        liftWorld(obj, dy);
        return; // os filhos sobem junto
      }
      if (obj instanceof THREE.Mesh) {
        // Só pisos disputam espaço com a grama; prédios e muros seguem o relevo.
        const flat = box.max.y - box.min.y <= FLAT_HEIGHT;
        deformMesh(obj, flat ? surfaceAt : heightAt, heightAt);
      }
    }
    for (const child of [...obj.children]) visit(child);
  };
  visit(root);
  root.updateMatrixWorld(true);
}

/** Face voltada para baixo no nível do chão (base de prédio, fundo do chão): nunca aparece. */
function buriedBottom(a: number[], b: number[], c: number[]): boolean {
  if (Math.max(a[1], b[1], c[1]) > 0.05) return false;
  const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return ny < -0.95 * Math.hypot(nx, ny, nz);
}

function hasMesh(obj: THREE.Object3D): boolean {
  let found = false;
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) found = true;
  });
  return found;
}

/** Sobe o objeto `dy` metros em Y de mundo (o pai pode ter transformação própria). */
function liftWorld(obj: THREE.Object3D, dy: number): void {
  if (dy === 0) return;
  const world = obj.getWorldPosition(new THREE.Vector3());
  world.y += dy;
  obj.position.copy(obj.parent ? obj.parent.worldToLocal(world) : world);
  obj.updateMatrixWorld(true);
}

function shiftInstances(mesh: THREE.InstancedMesh, heightAt: HeightFn): void {
  const inst = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const inv = mesh.matrixWorld.clone().invert();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, inst);
    world.multiplyMatrices(mesh.matrixWorld, inst);
    world.elements[13] += heightAt(world.elements[12], world.elements[14]);
    mesh.setMatrixAt(i, inst.multiplyMatrices(inv, world));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
}

/** Altura (mundo) da face de cima das malhas do chão já deformadas em (x, z); null fora delas. */
function groundSampler(grounds: THREE.Mesh[]): (x: number, z: number) => number | null {
  const parts = grounds.map((mesh) => {
    mesh.updateMatrixWorld(true);
    return { mesh, bvh: new MeshBVH(mesh.geometry), inv: mesh.matrixWorld.clone().invert() };
  });
  const ray = new THREE.Ray();
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  return (x, z) => {
    for (const { mesh, bvh, inv } of parts) {
      ray.set(origin.set(x, 1e4, z), down).applyMatrix4(inv);
      const hit = bvh.raycastFirst(ray, THREE.FrontSide);
      if (hit) return hit.point.applyMatrix4(mesh.matrixWorld).y;
    }
    return null;
  };
}

/**
 * Subdivide (em espaço de mundo) e desloca cada vértice por `heightAt`. `relief` decide onde subdividir.
 * O critério de divisão depende só da aresta (comprimento e desvio do relevo), então os dois triângulos
 * que a compartilham a dividem igual: a malha continua sem frestas.
 */
function deformMesh(mesh: THREE.Mesh, heightAt: HeightFn, relief: HeightFn): void {
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  const names = Object.keys(src.attributes).filter((n) => n === 'position' || n === 'normal' || n === 'uv');
  const m = mesh.matrixWorld;
  const inv = m.clone().invert();
  const pos = src.attributes.position as THREE.BufferAttribute;
  const world = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) v.fromBufferAttribute(pos, i).applyMatrix4(m).toArray(world, i * 3);

  // Atributos por vértice (mundo para posição; o resto copiado como está).
  const attrs = names.map((n) => ({ name: n, size: src.attributes[n].itemSize, data: n === 'position' ? world : (src.attributes[n].array as Float32Array) }));
  const out = attrs.map(() => [] as number[]);
  const vert = (i: number) => attrs.map((a) => Array.from(a.data.subarray(i * a.size, (i + 1) * a.size)));
  type V = number[][];
  const lerp = (a: V, b: V): V => a.map((arr, k) => arr.map((x, j) => (x + b[k][j]) / 2));
  const xz2 = (a: V, b: V) => (a[0][0] - b[0][0]) ** 2 + (a[0][2] - b[0][2]) ** 2;
  const sag = (a: V, b: V) =>
    Math.abs(relief((a[0][0] + b[0][0]) / 2, (a[0][2] + b[0][2]) / 2) - (relief(a[0][0], a[0][2]) + relief(b[0][0], b[0][2])) / 2);
  /** Comprimento² da aresta se ela precisa ser dividida; 0 se não. */
  const split = (a: V, b: V) => {
    const l2 = xz2(a, b);
    return l2 > MAX_EDGE * MAX_EDGE || (l2 > MIN_EDGE * MIN_EDGE && sag(a, b) > MAX_SAG) ? l2 : 0;
  };
  const emit = (a: V, b: V, c: V, depth: number) => {
    if (depth === 0 && buriedBottom(a[0], b[0], c[0])) return;
    const e = [split(a, b), split(b, c), split(c, a)];
    const longest = Math.max(...e);
    if (longest > 0 && depth < 40) {
      // Divide ao meio a mais longa das arestas que precisam (mantém triângulos bem formados).
      if (longest === e[0]) {
        const m = lerp(a, b);
        emit(a, m, c, depth + 1);
        emit(m, b, c, depth + 1);
      } else if (longest === e[1]) {
        const m = lerp(b, c);
        emit(a, b, m, depth + 1);
        emit(a, m, c, depth + 1);
      } else {
        const m = lerp(c, a);
        emit(a, b, m, depth + 1);
        emit(m, b, c, depth + 1);
      }
      return;
    }
    for (const p of [a, b, c]) p.forEach((arr, k) => out[k].push(...arr));
  };
  // Por grupo de material (caixas com material diferente por face), refazendo os intervalos.
  const groups = src.groups.length ? src.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
  const newGroups: { start: number; count: number; materialIndex: number }[] = [];
  for (const g of groups) {
    const before = out[0].length / 3;
    for (let i = g.start; i < g.start + g.count; i += 3) emit(vert(i), vert(i + 1), vert(i + 2), 0);
    newGroups.push({ start: before, count: out[0].length / 3 - before, materialIndex: g.materialIndex ?? 0 });
  }

  const geo = new THREE.BufferGeometry();
  if (src.groups.length) for (const g of newGroups) geo.addGroup(g.start, g.count, g.materialIndex);
  attrs.forEach((a, k) => {
    const data = new Float32Array(out[k]);
    if (a.name === 'position') {
      for (let i = 0; i < data.length; i += 3) {
        v.set(data[i], data[i + 1], data[i + 2]);
        v.y += heightAt(v.x, v.z);
        v.applyMatrix4(inv).toArray(data, i);
      }
    }
    geo.setAttribute(a.name, new THREE.BufferAttribute(data, a.size));
  });
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  mesh.geometry = geo;
}
