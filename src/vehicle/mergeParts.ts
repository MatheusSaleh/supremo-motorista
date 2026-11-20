// Junta as malhas estáticas de um nó numa malha por material (no espaço do próprio nó). Um carro gerado por
// código tem ~100 peças; cada peça é uma draw call (e outra no passe de sombra). Depois de juntar, sobram
// poucas por carro. Malhas multimaterial são separadas pelos grupos. Geometrias indexadas e não indexadas
// ficam em malhas diferentes, para os amassados (computeVertexNormals) não perderem o sombreamento suave.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function mergeByMaterial(node: THREE.Object3D): THREE.Mesh[] {
  node.updateMatrixWorld(true);
  const toLocal = node.matrixWorld.clone().invert();
  const buckets = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean }>();
  const remove: THREE.Mesh[] = [];
  node.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o instanceof THREE.SkinnedMesh || !o.visible) return;
    const m = new THREE.Matrix4().multiplyMatrices(toLocal, o.matrixWorld);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = Array.isArray(o.material) && o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    for (const g of groups) {
      const material = mats[g.materialIndex ?? 0];
      if (!material) continue;
      const geo = extractGroup(o.geometry, g.start, g.count).applyMatrix4(m);
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const sig = `${material.uuid}|${geo.index ? 'i' : 'n'}|${Object.keys(geo.attributes).sort().join(',')}`;
      let b = buckets.get(sig);
      if (!b) buckets.set(sig, (b = { material, geos: [], cast: false, receive: false }));
      b.geos.push(geo);
      b.cast ||= o.castShadow;
      b.receive ||= o.receiveShadow;
    }
    remove.push(o);
  });
  for (const o of remove) o.removeFromParent();
  const out: THREE.Mesh[] = [];
  for (const b of buckets.values()) {
    const geo = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    node.add(mesh);
    out.push(mesh);
  }
  return out;
}

/** Cópia só do intervalo [start, start + count) da geometria (índices ou vértices). */
function extractGroup(src: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  if (start === 0 && !Number.isFinite(count)) return src.clone();
  if (src.index) {
    const idx = src.index.array;
    const end = Math.min(idx.length, start + count);
    // Reindexa só os vértices usados.
    const remap = new Map<number, number>();
    const order: number[] = [];
    const index: number[] = [];
    for (let i = start; i < end; i++) {
      let k = remap.get(idx[i]);
      if (k === undefined) {
        k = order.length;
        remap.set(idx[i], k);
        order.push(idx[i]);
      }
      index.push(k);
    }
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) {
      const a = attr as THREE.BufferAttribute;
      const data = new Float32Array(order.length * a.itemSize);
      order.forEach((v, j) => {
        for (let c = 0; c < a.itemSize; c++) data[j * a.itemSize + c] = a.getComponent(v, c);
      });
      geo.setAttribute(name, new THREE.BufferAttribute(data, a.itemSize, a.normalized));
    }
    geo.setIndex(index);
    return geo;
  }
  const geo = new THREE.BufferGeometry();
  const total = (src.attributes.position as THREE.BufferAttribute).count;
  const end = Math.min(total, start + count);
  for (const [name, attr] of Object.entries(src.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const data = new Float32Array((end - start) * a.itemSize);
    for (let v = start; v < end; v++) for (let c = 0; c < a.itemSize; c++) data[(v - start) * a.itemSize + c] = a.getComponent(v, c);
    geo.setAttribute(name, new THREE.BufferAttribute(data, a.itemSize, a.normalized));
  }
  return geo;
}
