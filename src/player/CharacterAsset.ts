// Carrega o .glb do personagem uma única vez e o normaliza: altura em metros, pés em y=0,
// centralizado em XZ e olhando para +Z. Cada Avatar clona este template.
import * as THREE from 'three';
import type { Assets } from '../core/Assets';
import type { Config } from '../config';

export interface CharacterAsset {
  /** Modelo normalizado; não adicionar à cena diretamente (use SkeletonUtils.clone). */
  readonly template: THREE.Object3D;
  readonly clips: readonly THREE.AnimationClip[];
}

export async function loadCharacterAsset(
  assets: Assets,
  cfg: Config,
  onProgress?: (fraction: number) => void,
): Promise<CharacterAsset> {
  const c = cfg.character;
  const gltf = await assets.loadGLTF(c.url, onProgress);
  const model = gltf.scene;

  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
    // O bounding box de malhas com skinning é o da pose de bind; evita sumir em poses extremas.
    if (o instanceof THREE.SkinnedMesh) o.frustumCulled = false;
  });

  const p = cfg.player;
  const targetHeight = c.height ?? 2 * (p.halfHeight + p.radius);

  // Mede na orientação final e escala para a altura da cápsula.
  model.rotation.y = c.yawOffset;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.scale.multiplyScalar(targetHeight / size.y);

  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);

  // Wrapper: origem = pés; o mixer de cada clone usa este grupo como raiz.
  const template = new THREE.Group();
  template.name = 'character';
  template.add(model);

  console.info(
    `[character] ${c.url}: ${size.y.toFixed(2)} → ${targetHeight.toFixed(2)} m; clips: ${gltf.animations.map((a) => a.name).join(', ')}`,
  );
  return { template, clips: gltf.animations };
}
