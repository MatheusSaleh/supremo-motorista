// Variação do chão (M1 do plano de densificação): a grama deixa de ser um tapete uniforme. Depois do relevo,
// cada vértice da malha do chão recebe uma cor que multiplica a textura: manchas de capim seco (amarelado),
// de verde mais escuro e de terra vermelha do cerrado. Custo zero por quadro (só um atributo de cor).
import * as THREE from 'three';

/** Ruído de valor 2D (determinístico) em [0, 1]. */
function valueNoise(x: number, z: number, seed: number): number {
  const hash = (i: number, j: number) => {
    let h = (i * 374761393 + j * 668265263 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * sx;
  const b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * sx;
  return a + (b - a) * sz;
}

function fbm(x: number, z: number, seed: number): number {
  return valueNoise(x, z, seed) * 0.65 + valueNoise(x * 2.3, z * 2.3, seed + 7) * 0.35;
}

const DRY = new THREE.Color(1.18, 1.02, 0.7);
const DARK = new THREE.Color(0.8, 0.92, 0.78);
const EARTH = new THREE.Color(1.55, 0.78, 0.55);
const BASE = new THREE.Color(1, 1, 1);

/** Pinta os vértices das malhas de chão (userData.drape = 'ground') e liga vertexColors no material. */
export function tintGround(root: THREE.Object3D): void {
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.userData.drape !== 'ground') return;
    const pos = o.geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const dry = fbm(v.x / 260, v.z / 260, 11);
      const dark = fbm(v.x / 140, v.z / 140, 23);
      const earth = fbm(v.x / 90, v.z / 90, 37);
      c.copy(BASE);
      c.lerp(DRY, THREE.MathUtils.smoothstep(dry, 0.45, 0.75) * 0.85);
      c.lerp(DARK, THREE.MathUtils.smoothstep(dark, 0.55, 0.8) * 0.7);
      c.lerp(EARTH, THREE.MathUtils.smoothstep(earth, 0.74, 0.86) * 0.75);
      c.toArray(colors, i * 3);
    }
    o.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    for (const m of [o.material].flat()) {
      (m as THREE.MeshStandardMaterial).vertexColors = true;
      m.needsUpdate = true;
    }
  });
}
