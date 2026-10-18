// Josué sentado ao volante (visual): clona o personagem, congela a pose "sentado" do clip e usa IK
// para levar as mãos até a pegada do volante (os pontos de pegada giram com o volante).
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Config } from '../config';
import type { CharacterAsset } from './CharacterAsset';
import { TwoBoneIK } from './TwoBoneIK';
import { makeDresser, type Look } from './outfit';

export interface Grips {
  left: THREE.Object3D;
  right: THREE.Object3D;
  /** Referências para onde os cotovelos dobram (presas ao carro). */
  poleLeft: THREE.Object3D;
  poleRight: THREE.Object3D;
}

export class SeatedDriver {
  readonly root = new THREE.Group();
  private readonly arms: { ik: TwoBoneIK; side: 'left' | 'right' }[] = [];
  /** Pose de base (após o clip) dos ossos mexidos pela IK; restaurada antes de cada solução. */
  private readonly basePose: { bone: THREE.Object3D; q: THREE.Quaternion }[] = [];
  private readonly head: THREE.Object3D | null;
  private readonly tmpT = new THREE.Vector3();
  private readonly tmpP = new THREE.Vector3();
  /** Troca terno/pele (usado pelo passageiro do banco de trás). */
  readonly setLook: (look: Look) => void;

  constructor(asset: CharacterAsset, cfg: Config) {
    const c = cfg.character;
    const body = cloneSkinned(asset.template);
    body.scale.setScalar(c.driverScale);
    this.root.add(body);
    body.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
    this.setLook = makeDresser(body);
    const lower = c.sitClip.toLowerCase();
    const clip = asset.clips.find((cl) => cl.name.toLowerCase().includes(lower));
    if (clip) {
      const mixer = new THREE.AnimationMixer(body);
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      mixer.update(clip.duration + 0.01); // pose final, parada (sem mixer rodando depois)
    }

    // O GLTFLoader normaliza nomes (ex.: "UpperArm.L" → "UpperArmL"); aceita os dois.
    const bone = (name: string) => body.getObjectByName(name) ?? body.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
    for (const side of ['left', 'right'] as const) {
      const names = c.armBones[side];
      const upper = bone(names.upper);
      const low = bone(names.lower);
      const end = bone(names.end);
      if (upper instanceof THREE.Bone && low instanceof THREE.Bone && end) {
        this.arms.push({ ik: new TwoBoneIK(upper, low, end), side });
        this.basePose.push({ bone: upper, q: upper.quaternion.clone() }, { bone: low, q: low.quaternion.clone() });
      } else {
        console.warn(`[motorista] ossos do braço ${side} não encontrados; confira config.character.armBones`);
      }
    }
    this.head = bone(c.headBone) ?? null;
    this.root.visible = false;
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** Câmera interna: esconde a cabeça (a câmera fica no lugar dela), mantendo braços e mãos. */
  set headHidden(hidden: boolean) {
    this.head?.scale.setScalar(hidden ? 1e-4 : 1);
  }

  /** Leva as mãos às pegadas do volante. Chamar por frame, com as matrizes do carro atualizadas. */
  update(grips: Grips): void {
    if (!this.root.visible || this.arms.length === 0) return;
    for (const p of this.basePose) p.bone.quaternion.copy(p.q);
    for (const { ik, side } of this.arms) {
      (side === 'left' ? grips.left : grips.right).getWorldPosition(this.tmpT);
      (side === 'left' ? grips.poleLeft : grips.poleRight).getWorldPosition(this.tmpP);
      ik.solve(this.tmpT, this.tmpP);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
