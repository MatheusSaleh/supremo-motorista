// Grade espacial de malhas estáticas para raycasts curtos (câmera, piso). O raycast acelerado do
// three-mesh-bvh não testa a esfera envolvente antes de percorrer a BVH de cada malha, então uma consulta
// contra a cidade inteira (centenas de malhas) custava milissegundos. Aqui cada consulta só olha as malhas
// das células que o segmento do raio cruza.
import * as THREE from 'three';

export class MeshGrid {
  private readonly cells = new Map<number, THREE.Mesh[]>();
  private readonly stamp = new Map<THREE.Mesh, number>();
  private query = 0;
  private readonly out: THREE.Mesh[] = [];
  private readonly box = new THREE.Box3();

  constructor(private readonly cell = 64) {}

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  add(mesh: THREE.Mesh): void {
    mesh.updateMatrixWorld(true);
    if (mesh instanceof THREE.InstancedMesh) {
      mesh.computeBoundingBox();
      this.box.copy(mesh.boundingBox!).applyMatrix4(mesh.matrixWorld);
    } else {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      this.box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
    }
    const c = this.cell;
    const i0 = Math.floor(this.box.min.x / c);
    const i1 = Math.floor(this.box.max.x / c);
    const j0 = Math.floor(this.box.min.z / c);
    const j1 = Math.floor(this.box.max.z / c);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(mesh);
      }
  }

  /** Malhas que podem ser atingidas pelo segmento origem → origem + dir × far (sem repetição). */
  candidates(origin: THREE.Vector3Like, dir: THREE.Vector3Like, far: number): THREE.Mesh[] {
    const out = this.out;
    out.length = 0;
    const q = ++this.query;
    const c = this.cell;
    const ex = origin.x + dir.x * far;
    const ez = origin.z + dir.z * far;
    const i0 = Math.floor(Math.min(origin.x, ex) / c);
    const i1 = Math.floor(Math.max(origin.x, ex) / c);
    const j0 = Math.floor(Math.min(origin.z, ez) / c);
    const j1 = Math.floor(Math.max(origin.z, ez) / c);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const m of list) {
          if (this.stamp.get(m) === q) continue;
          this.stamp.set(m, q);
          out.push(m);
        }
      }
    return out;
  }
}
