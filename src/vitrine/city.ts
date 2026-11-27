// A cidade da vitrine: os mesmos geradores do jogo (world/city), na mesma ordem de createCity(), mas com a
// câmera fixa já conhecida. Antes de assentar tudo no relevo (a etapa cara: ~10 s para o mapa inteiro), descarta o
// que fica fora do campo de visão da janela, e o chão só cobre a área que aparece. Sem garagens, colisores
// nem diagnóstico. Em produção, num PC bom, a montagem leva uns 5 s: por isso o portfólio mostra antes uma imagem
// estática e embute esta página de outro domínio (processo separado, não trava a rolagem do site). Se createCity() ganhar regiões novas, acrescente aqui também (senão só não aparecem).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildAeroporto } from '../world/city/aeroporto';
import { buildAsas } from '../world/city/asas';
import { CityBuilder, type Rect } from '../world/city/builder';
import { buildCentro } from '../world/city/centro';
import { drapeOnTerrain } from '../world/city/drape';
import { buildEixao } from '../world/city/eixao';
import { buildEsplanada } from '../world/city/esplanada';
import { tintGround } from '../world/city/ground';
import { buildLago } from '../world/city/lago';
import { BOUNDS, EIXO, LAKE } from '../world/city/layout';
import { buildMarcos } from '../world/city/marcos';
import { lawnMaterial } from '../world/city/materials';
import { buildOeste } from '../world/city/oeste';
import { buildOrla } from '../world/city/orla';
import { buildPonte } from '../world/city/ponte';
import { buildPraca } from '../world/city/praca';
import { buildFactionFlags, buildSigns, buildStreetLights, buildTrees } from '../world/city/props';
import { CityKit } from '../world/city/quadras';
import { createTerrain } from '../world/city/terrain';
import { buildVida } from '../world/city/vida';

export interface ShowcaseCity {
  root: THREE.Group;
  heightAt: (x: number, z: number) => number;
}

/**
 * @param view frustum da câmera da vitrine (com folga), no plano antes do relevo (chão em y = 0).
 * @param area retângulo em planta que contém tudo o que o frustum alcança (corta o chão).
 */
export function createShowcaseCity(view: THREE.Frustum, area: Rect, seed = 1960): ShowcaseCity {
  const b = new CityBuilder(seed);

  const land: Rect[] = [
    { minX: BOUNDS.minX, maxX: BOUNDS.maxX, minZ: LAKE.shoreZ, maxZ: BOUNDS.maxZ },
    { minX: LAKE.shoreX, maxX: BOUNDS.maxX, minZ: BOUNDS.minZ, maxZ: LAKE.shoreZ },
  ]
    .map((r) => ({ minX: Math.max(r.minX, area.minX), maxX: Math.min(r.maxX, area.maxX), minZ: Math.max(r.minZ, area.minZ), maxZ: Math.min(r.maxZ, area.maxZ) }))
    .filter((r) => r.maxX > r.minX && r.maxZ > r.minZ);
  const ground = b.group('chao');
  for (const r of land) {
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const m = b.box(ground, w, 1, d, lawnMaterial(b.mats, w, d), (r.minX + r.maxX) / 2, -0.5, (r.minZ + r.maxZ) / 2);
    m.castShadow = false;
    m.userData.surface = 'grass';
    m.userData.drape = 'ground';
  }
  b.occupy({ minX: -EIXO.lawnHalfWidth, maxX: EIXO.lawnHalfWidth, minZ: EIXO.walkStartZ, maxZ: EIXO.walkEndZ });

  buildEsplanada(b);
  buildPraca(b);
  buildLago(b);
  buildEixao(b);
  buildAeroporto(b);
  buildMarcos(b);
  buildPonte(b);
  const kit = new CityKit(b);
  buildAsas(b, kit);
  buildCentro(b, kit);
  buildOeste(b, kit);
  buildOrla(b, kit);
  buildVida(b);
  kit.flush();
  buildSigns(b);
  buildStreetLights(b);
  buildFactionFlags(b);
  buildTrees(b, land, 2600, new Date().getMonth());
  // Sem os muros-limite do mapa: ficam na neblina e eram ~0,8 s de relevo.

  pruneOutside(b.root, view);

  const terrain = createTerrain();
  const heightAt = (x: number, z: number) => terrain.heightAt(x, z);
  drapeOnTerrain(b.root, heightAt);
  tintGround(b.root);
  b.root.updateMatrixWorld(true);
  mergeStatic(b.root);
  return { root: b.root, heightAt };
}

/**
 * Tira da cena o que o frustum não alcança: grupos e malhas inteiros e, nas instâncias (prédios, carros
 * parados, árvores), cada instância fora dele. O chão fica (já foi cortado pela área).
 */
function pruneOutside(root: THREE.Object3D, view: THREE.Frustum): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  const visit = (obj: THREE.Object3D) => {
    for (const child of [...obj.children]) {
      if (child.userData.drape === 'ground') continue;
      if (child instanceof THREE.InstancedMesh) {
        compactInstances(child, view, box, m);
        if (child.count === 0) child.removeFromParent();
        continue;
      }
      box.setFromObject(child);
      if (box.isEmpty()) continue;
      if (!view.intersectsBox(box)) {
        child.removeFromParent();
        continue;
      }
      visit(child);
    }
  };
  visit(root);
}

/** Mantém só as instâncias dentro do frustum, no começo do buffer (a ordem das demais não importa aqui). */
function compactInstances(mesh: THREE.InstancedMesh, view: THREE.Frustum, box: THREE.Box3, m: THREE.Matrix4): void {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const local = mesh.geometry.boundingBox!;
  let kept = 0;
  const color = new THREE.Color();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    m.premultiply(mesh.matrixWorld);
    box.copy(local).applyMatrix4(m);
    if (!view.intersectsBox(box)) continue;
    if (kept !== i) {
      mesh.getMatrixAt(i, m);
      mesh.setMatrixAt(kept, m);
      if (mesh.instanceColor) {
        mesh.getColorAt(i, color);
        mesh.setColorAt(kept, color);
      }
    }
    kept++;
  }
  mesh.count = kept;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/**
 * Junta as malhas comuns de mesmo material (e mesmas flags de sombra e atributos) numa só: com a câmera parada e
 * nada se mexendo lá fora, centenas de draw calls viram dezenas. Pula instâncias, transparentes e multimaterial.
 */
function mergeStatic(root: THREE.Object3D): void {
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o instanceof THREE.SkinnedMesh) return;
    const mat = o.material;
    if (Array.isArray(mat) || mat.transparent || !o.visible) return;
    const attrs = Object.keys(o.geometry.attributes).sort().join();
    const key = `${mat.uuid}|${o.castShadow}|${o.receiveShadow}|${attrs}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(o);
  });
  const merged = new THREE.Group();
  merged.name = 'lotes-vitrine';
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.clearGroups();
      return g.applyMatrix4(m.matrixWorld);
    });
    const geo = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, list[0].material);
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    merged.add(mesh);
    // Sem dispose: a geometria pode ser compartilhada com uma malha que ficou fora do lote.
    for (const m of list) m.removeFromParent();
  }
  root.add(merged);
  merged.updateMatrixWorld(true);
}
