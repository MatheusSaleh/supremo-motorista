// A cidade da vitrine: os mesmos geradores do jogo (world/city), na mesma ordem de createCity(), mas para uma câmera
// fixa já conhecida. Diferenças, todas para caber num celular:
//  - plana: sem assentar no relevo (drape), que era ~80% do tempo (vista da janela, a inclinação do Eixo quase
//    não aparece); o chão é subdividido só para o tingimento (tintGround) ter detalhe;
//  - só o que os enquadramentos da câmera (paisagem e retrato) alcançam, e o chão só cobre essa área;
//  - montada em etapas, com uma pausa entre elas: nenhum trecho trava a página por muito tempo (no iOS o iframe
//    divide o processo com o portfólio);
//  - malhas estáticas de mesmo material agrupadas (poucas centenas de draw calls).
// Sem garagens, colisores, muros-limite nem diagnóstico. Se createCity() ganhar regiões novas, acrescente aqui
// também (senão só não aparecem).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildAeroporto } from '../world/city/aeroporto';
import { buildAsas } from '../world/city/asas';
import { CityBuilder, type Rect } from '../world/city/builder';
import { buildCentro } from '../world/city/centro';
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
import { buildVida } from '../world/city/vida';

export interface ShowcaseCity {
  root: THREE.Group;
}

/** Devolve a vez ao navegador entre as etapas (desenha a tela de carregamento, atende a rolagem). */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * @param views frustums dos enquadramentos da câmera (com folga), em coordenadas do mundo.
 * @param area retângulo em planta que contém tudo o que eles alcançam (corta o chão).
 */
export async function createShowcaseCity(views: THREE.Frustum[], area: Rect, seed = 1960): Promise<ShowcaseCity> {
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
    // Sem o relevo, quem subdividia o chão era o drape: aqui, uma grade de ~40 m para o tingimento.
    m.geometry.dispose();
    m.geometry = new THREE.BoxGeometry(w, 1, d, Math.min(96, Math.ceil(w / 40)), 1, Math.min(96, Math.ceil(d / 40)));
    m.castShadow = false;
    m.userData.surface = 'grass';
    m.userData.drape = 'ground';
  }
  b.occupy({ minX: -EIXO.lawnHalfWidth, maxX: EIXO.lawnHalfWidth, minZ: EIXO.walkStartZ, maxZ: EIXO.walkEndZ });

  const steps: (() => void)[] = [
    () => buildEsplanada(b),
    () => buildPraca(b),
    () => buildLago(b),
    () => buildEixao(b),
    () => buildAeroporto(b),
    () => buildMarcos(b),
    () => buildPonte(b),
  ];
  for (const step of steps) {
    step();
    await breathe();
  }
  const kit = new CityKit(b);
  for (const step of [() => buildAsas(b, kit), () => buildCentro(b, kit), () => buildOeste(b, kit), () => buildOrla(b, kit), () => buildVida(b)]) {
    step();
    await breathe();
  }
  kit.flush();
  await breathe();
  buildSigns(b);
  buildStreetLights(b);
  buildFactionFlags(b);
  buildTrees(b, land, 2600, new Date().getMonth());
  await breathe();

  pruneOutside(b.root, views);
  await breathe();
  tintGround(b.root);
  b.root.updateMatrixWorld(true);
  mergeStatic(b.root);
  return { root: b.root };
}

/**
 * Tira da cena o que o frustum não alcança: grupos e malhas inteiros e, nas instâncias (prédios, carros
 * parados, árvores), cada instância fora dele. O chão fica (já foi cortado pela área).
 */
function pruneOutside(root: THREE.Object3D, views: THREE.Frustum[]): void {
  const seen = (box: THREE.Box3) => views.some((v) => v.intersectsBox(box));
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  const visit = (obj: THREE.Object3D) => {
    for (const child of [...obj.children]) {
      if (child.userData.drape === 'ground') continue;
      if (child instanceof THREE.InstancedMesh) {
        compactInstances(child, seen, box, m);
        if (child.count === 0) child.removeFromParent();
        continue;
      }
      box.setFromObject(child);
      if (box.isEmpty()) continue;
      if (!seen(box)) {
        child.removeFromParent();
        continue;
      }
      visit(child);
    }
  };
  visit(root);
}

/** Mantém só as instâncias dentro do frustum, no começo do buffer (a ordem das demais não importa aqui). */
function compactInstances(mesh: THREE.InstancedMesh, seen: (box: THREE.Box3) => boolean, box: THREE.Box3, m: THREE.Matrix4): void {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const local = mesh.geometry.boundingBox!;
  let kept = 0;
  const color = new THREE.Color();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    m.premultiply(mesh.matrixWorld);
    box.copy(local).applyMatrix4(m);
    if (!seen(box)) continue;
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
