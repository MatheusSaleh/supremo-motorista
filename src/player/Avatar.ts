// Representação visual de um jogador (sem física, sem input).
// Qualquer fonte de PlayerState (jogador, NPC, replay) só chama update(dt, state).
// Origem do grupo = pés do personagem.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Config } from '../config';
import type { CharacterAsset } from './CharacterAsset';
import { PlayerAnimator } from './PlayerAnimator';
import type { PlayerState } from './PlayerState';

export class Avatar {
  readonly root = new THREE.Group();
  private readonly animator: PlayerAnimator | null = null;
  private readonly colliderGizmo: THREE.LineSegments;
  /** Recursos criados aqui (os do template .glb são compartilhados e não são liberados). */
  private readonly owned: { dispose(): void }[] = [];

  /** Sem asset (falha no carregamento), usa a cápsula placeholder. */
  constructor(asset: CharacterAsset | null, cfg: Config) {
    const { radius, halfHeight } = cfg.player;
    if (asset) {
      const body = cloneSkinned(asset.template);
      this.root.add(body);
      this.animator = new PlayerAnimator(body, asset.clips, cfg);
    } else {
      this.root.add(this.createPlaceholderBody(radius, halfHeight));
    }

    // Wireframe da cápsula de colisão (debug).
    const geo = new THREE.WireframeGeometry(new THREE.CapsuleGeometry(radius, halfHeight * 2, 4, 12));
    const mat = new THREE.LineBasicMaterial({ color: 0x00ff88, depthTest: false, transparent: true, opacity: 0.6 });
    this.owned.push(geo, mat);
    this.colliderGizmo = new THREE.LineSegments(geo, mat);
    this.colliderGizmo.position.y = halfHeight + radius;
    this.colliderGizmo.renderOrder = 10;
    this.colliderGizmo.visible = false;
    this.root.add(this.colliderGizmo);
  }

  update(dt: number, state: PlayerState): void {
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.y = state.yaw;
    this.animator?.update(dt, state.moveState, state.speed);
  }

  set showCollider(v: boolean) {
    this.colliderGizmo.visible = v;
  }

  get showCollider(): boolean {
    return this.colliderGizmo.visible;
  }

  dispose(): void {
    this.animator?.dispose();
    this.owned.forEach((r) => r.dispose());
    this.root.removeFromParent();
  }

  /** Cápsula com um "nariz" apontando para +Z (frente). */
  private createPlaceholderBody(radius: number, halfHeight: number): THREE.Object3D {
    const group = new THREE.Group();
    const height = 2 * (halfHeight + radius);

    const bodyGeo = new THREE.CapsuleGeometry(radius, halfHeight * 2, 6, 16);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.6 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = height / 2;

    const noseGeo = new THREE.ConeGeometry(0.1, 0.3, 12);
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.rotation.x = Math.PI / 2; // cone aponta para +Z
    nose.position.set(0, height * 0.78, radius + 0.1);

    for (const m of [body, nose]) {
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    this.owned.push(bodyGeo, bodyMat, noseGeo, noseMat);
    return group;
  }
}
