// Mundo estático: ambiente (céu, luzes, neblina) + nível carregado.
// O nível é um Level (procedural ou .glb). World percorre as malhas (inclusive InstancedMesh) e cria
// colisores Rapier automaticamente, então trocar a fonte do cenário não afeta o resto do jogo.
//
// Convenções de userData nas malhas do nível:
//   noCollision: true  → sem colisor físico e ignorada pela câmera
//   cameraIgnore: true → tem colisor, mas a câmera atravessa (ex.: troncos finos)
//   collider: 'convex' → usa casco convexo em vez de trimesh (mais barato e robusto)
//   collider: 'pole'   → cilindro vertical fino (postes, troncos); raio em userData.poleRadius
//   collider: 'box'    → cuboide da caixa envolvente da geometria (peças compostas pequenas, ex.: carros parados)
//   surface: 'grass' | 'asphalt' | 'wood' | 'concrete' → tipo de piso (som dos passos, aderência)
//   breakKind + breakIds (InstancedMesh) / breakId (malha) → prop quebrável (ver Breakables)
//   cullDistance: m → some além dessa distância × qualidade (distância de desenho)
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Config } from '../config';
import { Breakables, type PropKind } from './Breakables';
import type { Level } from './Level';
import { MeshGrid } from './MeshGrid';

export class World {
  readonly scene = new THREE.Scene();
  /** Malhas usadas no raycast da câmera (com BVH). */
  readonly cameraColliders: THREE.Mesh[] = [];
  /** Malhas consultadas por surfaceAt (colisores + pistas, que são só visuais). */
  private readonly surfaceMeshes: THREE.Mesh[] = [];
  private readonly surfaceRay = new THREE.Raycaster();
  /** Grades espaciais para os raycasts curtos de câmera e de piso (ver MeshGrid). */
  private readonly cameraGrid = new MeshGrid();
  private readonly surfaceGrid = new MeshGrid();
  private shadowRange: number;
  private drawDistance = 1;
  private readonly detail: { obj: THREE.Object3D; center: THREE.Vector3; radius: number; distance: number }[] = [];
  level: Level | null = null;
  readonly breakables: Breakables;

  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly sunOffset: THREE.Vector3;
  // Base do espaço da luz, para alinhar a área de sombra à grade de texels (evita "tremer").
  private readonly lightBasis = new THREE.Matrix4();
  private readonly lightBasisInv = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly physics: RAPIER.World,
    cfg: Config,
  ) {
    this.breakables = new Breakables(physics, this.scene);
    this.shadowRange = cfg.render.shadowRange;
    const w = cfg.world;
    this.scene.background = new THREE.Color(w.skyBottom);
    this.scene.fog = new THREE.Fog(w.skyBottom, w.fogNear, w.fogFar);

    this.sky = createSky(w.skyTop, w.skyBottom, cfg.camera.far * 0.9);
    this.scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xdcecff, 0x6b7a4f, 1.1);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
    this.sunOffset = new THREE.Vector3();
    this.setSunDirection(new THREE.Vector3(w.sunDirection.x, w.sunDirection.y, w.sunDirection.z));

    const s = this.sun.shadow;
    s.mapSize.setScalar(2048);
    s.camera.near = 50;
    s.camera.far = 600;
    // Bias levemente positivo: sem as listras sob o carro na grama e sem acne nos prédios.
    s.bias = 0.0002;
    s.normalBias = 0.02;
    this.setShadowRange(cfg.render.shadowRange);
    this.sun.castShadow = false; // ligado por Game.applySettings()
    this.scene.add(this.sun, this.sun.target);
  }

  /** Adiciona o nível e gera colisores para todas as suas malhas. */
  setLevel(level: Level): void {
    this.level = level;
    const root = level.root;
    this.scene.add(root);
    root.updateMatrixWorld(true);
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) this.registerBreakable(obj);
      if (obj instanceof THREE.Mesh && typeof obj.userData.cullDistance === 'number') {
        if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
        if (obj instanceof THREE.InstancedMesh) obj.computeBoundingSphere(); // abrange todas as instâncias
        const sphere = (obj instanceof THREE.InstancedMesh ? obj.boundingSphere! : obj.geometry.boundingSphere!).clone().applyMatrix4(obj.matrixWorld);
        this.detail.push({ obj, center: sphere.center, radius: sphere.radius, distance: obj.userData.cullDistance });
      }
      if (obj instanceof THREE.Mesh && obj.userData.noCollision && obj.userData.surface) {
        obj.geometry.computeBoundsTree();
        this.surfaceMeshes.push(obj);
      }
      if (!(obj instanceof THREE.Mesh) || obj.userData.noCollision) return;
      if (obj instanceof THREE.InstancedMesh) {
        const m = new THREE.Matrix4();
        const breakIds = obj.userData.breakIds as string[] | undefined;
        for (let i = 0; i < obj.count; i++) {
          obj.getMatrixAt(i, m);
          m.premultiply(obj.matrixWorld);
          if (breakIds && obj.userData.collider === 'pole') this.createBreakablePole(obj, m, breakIds[i]);
          else this.createCollider(obj, m);
        }
      } else {
        this.createCollider(obj, obj.matrixWorld);
      }
      if (!obj.userData.cameraIgnore) {
        obj.geometry.computeBoundsTree();
        this.cameraColliders.push(obj);
      }
    });
    // Piso: instâncias (prédios, pilares, carros parados) não são chão, e o raycast do three percorre cada
    // instância de cada bloco: com milhares delas, uma consulta custava milissegundos.
    this.surfaceMeshes.push(...this.cameraColliders.filter((m) => !(m instanceof THREE.InstancedMesh)));
    for (const m of this.cameraColliders) this.cameraGrid.add(m);
    for (const m of this.surfaceMeshes) this.surfaceGrid.add(m);
    this.surfaceRay.firstHitOnly = true;
    this.batchStatic(root);
    // Cenário estático: não recalcula matrizes a cada frame.
    root.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.matrixWorldAutoUpdate = false;
    });
  }

  /**
   * Tipo de piso sob um ponto (userData.surface da malha atingida; padrão 'concrete').
   * Usado pelos passos. Custa um raycast com BVH; chame só quando precisar (a cada passo).
   */
  surfaceAt(p: THREE.Vector3Like): string {
    this.surfaceRay.set(new THREE.Vector3(p.x, p.y + 0.6, p.z), new THREE.Vector3(0, -1, 0));
    this.surfaceRay.far = 2;
    const hit = this.surfaceRay.intersectObjects(this.surfaceGrid.candidates(this.surfaceRay.ray.origin, this.surfaceRay.ray.direction, 2), false)[0];
    return (hit?.object.userData.surface as string | undefined) ?? 'concrete';
  }

  /** Malhas do cenário que um raio curto (câmera) pode atingir: só as das células que ele cruza. */
  cameraCandidates(origin: THREE.Vector3Like, dir: THREE.Vector3Like, far: number): THREE.Mesh[] {
    return this.cameraGrid.candidates(origin, dir, far);
  }

  /** Mantém a área de sombra e o céu centrados no jogador/câmera. */
  update(focus: THREE.Vector3Like, cameraPos: THREE.Vector3): void {
    this.cullDetail(cameraPos);
    // Arredonda o centro da sombra para múltiplos de 1 texel no espaço da luz.
    const texel = (2 * this.shadowRange) / this.sun.shadow.mapSize.x;
    const p = this.tmp.set(focus.x, focus.y, focus.z).applyMatrix4(this.lightBasisInv);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(this.lightBasis);

    this.sun.target.position.copy(p);
    this.sun.position.copy(p).add(this.sunOffset);
    this.sky.position.copy(cameraPos);
  }

  /** Direção do chão para o sol (ou a lua); a área de sombra passa a seguir essa direção. */
  setSunDirection(dir: THREE.Vector3): void {
    const d = this.tmp.copy(dir).normalize();
    // Longe o bastante para que prédios altos (torres de 100 m) fiquem dentro do frustum da sombra.
    this.sunOffset.copy(d).multiplyScalar(300);
    this.lightBasis.lookAt(d, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    this.lightBasisInv.copy(this.lightBasis).invert();
  }

  /** Céu, neblina e luzes (hora do dia e clima; ver env/Atmosphere). */
  setLighting(l: Lighting): void {
    const u = this.sky.material.uniforms;
    (u.topColor.value as THREE.Color).copy(l.skyTop);
    (u.bottomColor.value as THREE.Color).copy(l.skyBottom);
    (this.scene.background as THREE.Color).copy(l.skyBottom);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(l.fogColor);
    fog.near = l.fogNear;
    fog.far = l.fogFar;
    this.sun.color.copy(l.sunColor);
    this.sun.intensity = l.sunIntensity;
    this.hemi.color.copy(l.hemiSky);
    this.hemi.groundColor.copy(l.hemiGround);
    this.hemi.intensity = l.hemiIntensity;
  }

  /** Materiais do cenário (para efeitos de noite/chuva). */
  levelMaterials(): THREE.Material[] {
    const set = new Set<THREE.Material>();
    this.level?.root.traverse((o) => {
      if (o instanceof THREE.Mesh) for (const m of [o.material].flat()) set.add(m);
    });
    return [...set];
  }

  setShadowsEnabled(on: boolean): void {
    this.sun.castShadow = on;
  }

  setShadowMapSize(size: number): void {
    const s = this.sun.shadow;
    if (s.mapSize.x === size) return;
    s.mapSize.setScalar(size);
    s.map?.dispose();
    s.map = null; // recriado pelo renderer no próximo frame
  }

  /** Objetos que não devem aparecer na captura do minimapa. */
  get minimapHidden(): THREE.Object3D[] {
    return [this.sky];
  }

  /** Multiplicador da distância de desenho dos detalhes (qualidade gráfica). */
  setDrawDistance(mul: number): void {
    this.drawDistance = mul;
  }

  /**
   * Distância de desenho: malhas com userData.cullDistance (árvores, postes, placas, letreiros) somem
   * além de cullDistance × drawDistance da câmera. Corta draw calls de coisas que, de longe, viram
   * poucos pixels. `all = true` mostra tudo (captura do minimapa).
   */
  cullDetail(cameraPos: THREE.Vector3Like, all = false): void {
    for (const d of this.detail) {
      const max = d.distance * this.drawDistance + d.radius;
      const dx = d.center.x - cameraPos.x;
      const dz = d.center.z - cameraPos.z;
      d.obj.visible = all || dx * dx + dz * dz < max * max;
    }
  }

  setShadowRange(range: number): void {
    this.shadowRange = range;
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -range;
    c.right = c.top = range;
    c.updateProjectionMatrix();
  }

  /**
   * Cria um colisor fixo para a geometria transformada por `matrix` (espaço de mundo).
   * BoxGeometry → cuboide; userData.collider === 'convex' → casco convexo;
   * 'pole' → cilindro vertical fino na origem (postes, troncos); resto → trimesh.
   */
  private createCollider(mesh: THREE.Mesh, matrix: THREE.Matrix4): void {
    const geom = mesh.geometry;
    if (mesh.userData.collider === 'pole') {
      this.createPoleCollider(mesh, matrix);
      return;
    }
    let desc: RAPIER.ColliderDesc | null;

    if (mesh.userData.collider === 'box') {
      if (!geom.boundingBox) geom.computeBoundingBox();
      const bb = geom.boundingBox!;
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      matrix.decompose(pos, quat, scale);
      const c = bb.getCenter(new THREE.Vector3()).multiply(scale).applyQuaternion(quat).add(pos);
      const h = bb.getSize(new THREE.Vector3()).multiply(scale).multiplyScalar(0.5);
      this.physics.createCollider(RAPIER.ColliderDesc.cuboid(Math.abs(h.x), Math.abs(h.y), Math.abs(h.z)).setTranslation(c.x, c.y, c.z).setRotation(quat));
      return;
    }
    if (geom instanceof THREE.BoxGeometry) {
      this.createBoxColliders(geom, matrix);
      return;
    } else {
      const src = geom.attributes.position as THREE.BufferAttribute;
      const vertices = new Float32Array(src.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < src.count; i++) {
        v.fromBufferAttribute(src, i).applyMatrix4(matrix);
        vertices[i * 3] = v.x;
        vertices[i * 3 + 1] = v.y;
        vertices[i * 3 + 2] = v.z;
      }
      if (mesh.userData.collider === 'convex') {
        desc = RAPIER.ColliderDesc.convexHull(vertices);
      } else {
        const indices = geom.index
          ? new Uint32Array(geom.index.array)
          : Uint32Array.from({ length: src.count }, (_, i) => i);
        desc = RAPIER.ColliderDesc.trimesh(vertices, indices);
      }
    }
    if (desc) this.physics.createCollider(desc);
    else console.warn('[world] colisor inválido para', mesh.name);
  }

  /**
   * Agrupa malhas estáticas comuns (mesmo material, mesmas flags de sombra, mesma região de 500 m)
   * numa só malha: menos draw calls. As originais ficam invisíveis, mas continuam nas listas de
   * raycast (câmera e piso) — o Raycaster não olha visibilidade. Pula transparentes, instanciadas,
   * multimaterial, props quebráveis e qualquer malha com userData.noBatch.
   */
  private batchStatic(root: THREE.Object3D): void {
    const CELL = 500;
    const groups = new Map<string, THREE.Mesh[]>();
    const box = new THREE.Box3();
    const center = new THREE.Vector3();
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o instanceof THREE.SkinnedMesh) return;
      const mat = o.material;
      if (Array.isArray(mat) || mat.transparent || !o.visible || o.userData.noBatch || o.userData.breakKind) return;
      box.setFromObject(o).getCenter(center);
      // Malhas com distância de desenho só se juntam a outras com a mesma distância (o lote herda o corte).
      const cull = typeof o.userData.cullDistance === 'number' ? o.userData.cullDistance : '';
      const key = `${mat.uuid}|${o.castShadow}|${o.receiveShadow}|${cull}|${Math.floor(center.x / CELL)},${Math.floor(center.z / CELL)}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(o);
    });

    const batched = new THREE.Group();
    batched.name = 'lotes-estaticos';
    let merged = 0;
    const absorbed = new Set<THREE.Object3D>();
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
        g.clearGroups();
        return g.applyMatrix4(m.matrixWorld);
      });
      // Todas precisam ter os mesmos atributos (ex.: uv); se não, deixa este grupo como está.
      const keys = Object.keys(geos[0].attributes).sort().join();
      const geo = geos.every((g) => Object.keys(g.attributes).sort().join() === keys) ? mergeGeometries(geos) : null;
      geos.forEach((g) => g.dispose());
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, list[0].material);
      mesh.castShadow = list[0].castShadow;
      mesh.receiveShadow = list[0].receiveShadow;
      batched.add(mesh);
      list.forEach((m) => (m.visible = false));
      merged += list.length;
      const cull = list[0].userData.cullDistance;
      if (typeof cull === 'number') {
        // As originais saem da lista de detalhes (senão o corte por distância as reacenderia).
        list.forEach((m) => absorbed.add(m));
        geo.computeBoundingSphere();
        const sphere = geo.boundingSphere!;
        this.detail.push({ obj: mesh, center: sphere.center.clone(), radius: sphere.radius, distance: cull });
      }
    }
    if (absorbed.size) {
      const kept = this.detail.filter((d) => !absorbed.has(d.obj));
      this.detail.length = 0;
      this.detail.push(...kept);
    }
    root.add(batched);
    batched.updateMatrixWorld(true);
    if (import.meta.env.DEV) console.info(`[world] ${merged} malhas estáticas agrupadas em ${batched.children.length} lotes`);
  }

  /**
   * Visuais de props quebráveis: InstancedMesh com userData.breakIds (um id por instância) ou malha
   * avulsa com userData.breakId; userData.breakKind = 'pole' | 'tree' | 'sign'.
   */
  private registerBreakable(mesh: THREE.Mesh): void {
    const kind = mesh.userData.breakKind as PropKind | undefined;
    if (!kind) return;
    const ids = mesh.userData.breakIds as string[] | undefined;
    if (mesh instanceof THREE.InstancedMesh && ids) {
      for (let i = 0; i < mesh.count; i++) this.breakables.addInstanceVisual(ids[i], kind, mesh, i);
    } else if (typeof mesh.userData.breakId === 'string') {
      this.breakables.addObjectVisual(mesh.userData.breakId, kind, mesh);
    }
  }

  private createBreakablePole(mesh: THREE.Mesh, matrix: THREE.Matrix4, id: string): void {
    const { pos, height, radius } = this.poleShape(mesh, matrix);
    this.breakables.addPoleColliders(id, mesh.userData.breakKind as PropKind, pos, height, radius);
  }

  private poleShape(mesh: THREE.Mesh, matrix: THREE.Matrix4): { pos: THREE.Vector3; height: number; radius: number } {
    const geom = mesh.geometry;
    if (!geom.boundingBox) geom.computeBoundingBox();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(pos, quat, scale);
    return {
      pos,
      height: geom.boundingBox!.max.y * scale.y,
      radius: ((mesh.userData.poleRadius as number | undefined) ?? 0.22) * scale.x,
    };
  }

  private createPoleCollider(mesh: THREE.Mesh, matrix: THREE.Matrix4): void {
    const { pos, height, radius } = this.poleShape(mesh, matrix);
    this.physics.createCollider(RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(pos.x, pos.y + height / 2, pos.z));
  }

  /**
   * Cuboide(s) para uma caixa. Caixas muito grandes são divididas em blocos de até MAX_TILE metros:
   * com cuboides de quilômetros, a imprecisão numérica do Rapier faz a cápsula afundar ~20 cm.
   */
  private createBoxColliders(geom: THREE.BoxGeometry, matrix: THREE.Matrix4): void {
    const MAX_TILE = 200;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(pos, quat, scale);
    const p = geom.parameters;
    const size = [p.width * Math.abs(scale.x), p.height * Math.abs(scale.y), p.depth * Math.abs(scale.z)];
    const n = size.map((s) => Math.max(1, Math.ceil(s / MAX_TILE)));
    const tile = size.map((s, i) => s / n[i]);
    const offset = new THREE.Vector3();

    for (let ix = 0; ix < n[0]; ix++)
      for (let iy = 0; iy < n[1]; iy++)
        for (let iz = 0; iz < n[2]; iz++) {
          offset
            .set(
              (ix + 0.5) * tile[0] - size[0] / 2,
              (iy + 0.5) * tile[1] - size[1] / 2,
              (iz + 0.5) * tile[2] - size[2] / 2,
            )
            .applyQuaternion(quat)
            .add(pos);
          const desc = RAPIER.ColliderDesc.cuboid(tile[0] / 2, tile[1] / 2, tile[2] / 2)
            .setTranslation(offset.x, offset.y, offset.z)
            .setRotation(quat);
          this.physics.createCollider(desc);
        }
  }
}

export interface Lighting {
  skyTop: THREE.Color;
  skyBottom: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
}

/** Esfera invertida com gradiente vertical; acompanha a câmera para parecer infinita. */
function createSky(top: number, bottom: number, radius: number): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(top) },
      bottomColor: { value: new THREE.Color(bottom) },
      exponent: { value: 0.6 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float exponent;
      varying vec3 vDir;
      void main() {
        float h = max(normalize(vDir).y, 0.0);
        gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, exponent)), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.userData.noCollision = true;
  return sky;
}
