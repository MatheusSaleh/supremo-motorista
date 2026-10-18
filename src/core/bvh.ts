// Instala o three-mesh-bvh nos protótipos do three.js para acelerar os raycasts.
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

let installed = false;

export function installBVH(): void {
  if (installed) return;
  installed = true;
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}
