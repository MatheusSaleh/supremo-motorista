// O Josué da vitrine:
//  - entrada (só quando o portfólio pede, com ?intro): começa fora da sala, entra caminhando, vai até a mesa,
//    gira e senta para trabalhar;
//  - sentado digitando: pose "Sitting" + IK das mãos no teclado;
//  - nos links de contato, vira por cima do ombro e acena sentado; nas conquistas, levanta e comemora.
//
// Os clips do executivo.glb são poses paradas ou loops curtos (Sitting e Jump não têm movimento): levantar e
// sentar são uma mistura entre as poses, com o corpo subindo, girando e saindo de lado da cadeira ao mesmo tempo.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { fitDeskPose, keyboardContact } from './desk-pose';
import type { CHAIR } from './office';
import type { Config } from '../config';
import type { CharacterAsset } from '../player/CharacterAsset';
import { TwoBoneIK } from '../player/TwoBoneIK';

export type Reaction = 'wave' | 'cheer';

/** Alvos da IK das mãos (pontos no teclado) e para onde os cotovelos dobram. */
export interface Grips {
  left: THREE.Object3D;
  right: THREE.Object3D;
  poleLeft: THREE.Object3D;
  poleRight: THREE.Object3D;
}

/** Segundos para levantar (ou sentar) e para cada reação, de pé. */
const RISE = 0.65;
/** Sentar depois de chegar caminhando (inclui o giro de frente para a mesa). */
const SIT_DOWN = 0.9;
const WAVE_TIME = 1.85;
const CHEER_TIME = 1.7;
/** Passo da entrada (m/s) e rapidez com que os pesos das animações seguem o alvo (troca suave entre clips). */
const WALK_SPEED = 1.35;
const BLEND_RATE = 9;

type State = 'away' | 'walking' | 'waving' | 'sitting' | 'rising' | 'acting' | 'returning';
type Clip = 'sit' | 'idle' | 'walk' | 'cheer';

interface TypingArm {
  ik: TwoBoneIK;
  side: 'left' | 'right';
  upper: THREE.Bone;
  lower: THREE.Bone;
  hand: THREE.Object3D;
  contact: ReturnType<typeof keyboardContact>;
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export class ShowcaseCharacter {
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Partial<Record<Clip, THREE.AnimationAction>> = {};
  private readonly weights: Partial<Record<Clip, number>> = {};
  private readonly arms: TypingArm[] = [];
  private readonly roomRotation = new THREE.Quaternion();
  private readonly wave?: THREE.AnimationAction;
  private readonly chest?: THREE.Object3D;
  private readonly head?: THREE.Object3D;
  private waveTurn = 0;
  // O mixer pode pular a escrita de uma pose constante. Devolve os ossos à pose do clip antes de cada quadro.
  private readonly basePose = new Map<THREE.Object3D, THREE.Quaternion>();
  private state: State;
  /** Clip de pé da fase atual (reação, ou "idle" ao sentar depois de chegar). */
  private standing: 'idle' | 'cheer' = 'idle';
  private t = 0;
  private time = 0;
  /** Sentado (calculado na montagem), de pé ao lado da cadeira, e de onde ele entra. */
  private readonly sitPos = new THREE.Vector3();
  private readonly standPos = new THREE.Vector3();
  private readonly entryPos = new THREE.Vector3();
  private readonly sitYaw = Math.PI;
  private standYaw = 0;
  private readonly tmpT = new THREE.Vector3();
  private readonly tipOffset = new THREE.Vector3();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  /**
   * @param seat assento (local à sala): x, z e altura; o quadril é assentado nele.
   * @param stand onde fica de pé (para reagir, e onde a entrada termina), local à sala.
   * @param entry de onde ele entra caminhando (fora do quadro).
   * @param startAway começa fora da sala, esperando arrive().
   */
  constructor(
    asset: CharacterAsset,
    cfg: Config,
    seat: typeof CHAIR,
    stand: { x: number; z: number },
    entry: { x: number; z: number },
    startAway: boolean,
  ) {
    const c = cfg.character;
    const body = cloneSkinned(asset.template);
    this.root.add(body);
    body.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });

    const bone = (name: string) => body.getObjectByName(name) ?? body.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
    const findClip = (name: string) => asset.clips.find((cl) => cl.name.toLowerCase().includes(name.toLowerCase()));
    this.root.rotation.y = this.sitYaw;
    const seated = fitDeskPose(body, bone, c, findClip(c.sitClip), seat);
    this.sitPos.copy(seated.position);
    this.mixer = new THREE.AnimationMixer(body);
    const add = (key: Clip, clip: THREE.AnimationClip | undefined, timeScale = 1) => {
      if (!clip) return;
      const a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.timeScale = timeScale;
      a.play();
      a.setEffectiveWeight(0);
      this.actions[key] = a;
      this.weights[key] = 0;
    };
    add('sit', seated.clip);
    add('idle', findClip(c.clips.idle || 'Idle'));
    add('walk', findClip(c.clips.walk || 'Walking'), WALK_SPEED / c.walkClipSpeed); // passos casando com a velocidade
    add('cheer', findClip(c.clips.jump || 'Jump'));

    this.actions.sit?.setEffectiveWeight(1);
    this.mixer.update(0);
    for (const side of ['left', 'right'] as const) {
      const names = c.armBones[side];
      const upper = bone(names.upper);
      const lower = bone(names.lower);
      const end = bone(names.end);
      if (upper instanceof THREE.Bone && lower instanceof THREE.Bone && end) {
        this.arms.push({
          ik: new TwoBoneIK(upper, lower, end), side, upper, lower, hand: end,
          contact: keyboardContact(bone, c, side, end),
        });
      }
    }
    this.chest = bone(c.chestBone);
    this.head = bone(c.headBone);
    for (const joint of [this.chest, this.head, ...this.arms.flatMap(({ upper, lower, hand }) => [upper, lower, hand])]) {
      if (joint) this.basePose.set(joint, joint.quaternion.clone());
    }

    // Sobrepõe apenas o braço direito (incluindo mão e dedos) à pose sentada.
    const sit = this.actions.sit?.getClip();
    const wave = findClip(c.waveClip);
    const armNames = new Set<string>();
    bone(c.armBones.right.upper)?.traverse((joint) => armNames.add(joint.name));
    if (sit && wave) {
      const tracks = wave.tracks.filter((track) => {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
        return propertyName === 'quaternion' && armNames.has(nodeName) && sit.tracks.some((ref) => ref.name === track.name);
      });
      if (tracks.length) {
        const gesture = new THREE.AnimationClip('aceno sentado', wave.duration, tracks.map((track) => track.clone()));
        this.wave = this.mixer.clipAction(THREE.AnimationUtils.makeClipAdditive(gesture, 0, sit));
      }
    }

    this.standPos.set(stand.x, 0, stand.z);
    this.entryPos.set(entry.x, 0, entry.z);

    this.state = startAway ? 'away' : 'sitting';
    const start: Clip = startAway ? 'walk' : 'sit';
    this.weights[start] = 1;
    this.root.position.copy(startAway ? this.entryPos : this.sitPos);
    this.root.visible = !startAway;
  }

  /** Só sentado aceita reação nova (evita repetir em sequência quando o mouse passa várias vezes). */
  get busy(): boolean {
    return this.state !== 'sitting';
  }

  /** Ainda fora da sala, esperando a entrada. */
  get away(): boolean {
    return this.state === 'away';
  }

  /** Entra caminhando até a mesa e senta. */
  arrive(): boolean {
    if (this.state !== 'away') return false;
    this.root.visible = true;
    this.next('walking');
    return true;
  }

  /** Reage para o lado da câmera, em coordenadas da sala. */
  react(kind: Reaction, face: THREE.Vector3): boolean {
    if (this.busy) return false;
    if (kind === 'wave') {
      if (!this.wave) return false;
      const yaw = Math.atan2(face.x - this.sitPos.x, face.z - this.sitPos.z) - this.sitYaw;
      this.waveTurn = THREE.MathUtils.clamp(Math.atan2(Math.sin(yaw), Math.cos(yaw)), -0.85, 0.85);
      this.wave.reset().setEffectiveWeight(0).play();
      this.next('waving');
      return true;
    }
    if (!this.actions.cheer) return false;
    this.standing = kind;
    this.standYaw = Math.atan2(face.x - this.standPos.x, face.z - this.standPos.z);
    this.next('rising');
    return true;
  }

  /** Por quadro. `typing`: mãos pulando sobre o teclado (há caracteres saindo na tela). */
  update(dt: number, typing: boolean, grips: Grips): void {
    if (this.state === 'away') return;
    this.time += dt;
    this.t += dt;
    const sitTime = this.standing === 'idle' ? SIT_DOWN : RISE;
    const walkLength = this.entryPos.distanceTo(this.standPos);
    if (this.state === 'walking' && this.t * WALK_SPEED >= walkLength) {
      // Chegou: senta (de "idle"), girando do rumo da caminhada para a mesa.
      this.standing = 'idle';
      this.standYaw = Math.atan2(this.standPos.x - this.entryPos.x, this.standPos.z - this.entryPos.z);
      this.next('returning');
    } else if (this.state === 'rising' && this.t >= RISE) this.next('acting');
    else if (this.state === 'acting' && this.t >= CHEER_TIME) this.next('returning');
    else if (this.state === 'returning' && this.t >= sitTime) this.next('sitting');

    if (this.state === 'waving' && this.t >= WAVE_TIME) {
      this.wave?.stop();
      this.next('sitting');
    }
    const waveWeight = this.state === 'waving' ? smooth(this.t / 0.38) * smooth((WAVE_TIME - this.t) / 0.45) : 0;

    // 0 = sentado, 1 = de pé.
    const s =
      this.state === 'rising'
        ? smooth(this.t / RISE)
        : this.state === 'acting' || this.state === 'walking'
          ? 1
          : this.state === 'returning'
            ? 1 - smooth(this.t / (this.standing === 'idle' ? SIT_DOWN : RISE))
            : 0;
    for (const [joint, pose] of this.basePose) joint.quaternion.copy(pose);
    this.wave?.setEffectiveWeight(waveWeight);
    this.blendClips(dt, s);
    this.mixer.update(dt);
    for (const [joint, pose] of this.basePose) pose.copy(joint.quaternion);

    if (this.state === 'walking') {
      const dir = this.tmpT.subVectors(this.standPos, this.entryPos).normalize();
      this.root.position.copy(this.entryPos).addScaledVector(dir, Math.min(walkLength, this.t * WALK_SPEED));
      this.root.rotation.y = Math.atan2(dir.x, dir.z);
    } else {
      // Chega de lado, já virado para a mesa, antes de baixar sobre a almofada.
      const seatedWeight = this.actions.sit?.getEffectiveWeight() ?? 1 - s;
      const upright = 1 - seatedWeight;
      this.root.position.lerpVectors(this.sitPos, this.standPos, smooth(upright / 0.49));
      this.root.position.y = THREE.MathUtils.lerp(this.standPos.y, this.sitPos.y, seatedWeight);
      this.root.position.y += 0.085 * Math.sin(Math.PI * upright);
      if (this.state === 'acting') this.root.position.y += Math.max(0, Math.sin(this.t * Math.PI * 2.4)) * 0.22;
      let dyaw = this.standYaw - this.sitYaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)); // gira pelo lado mais curto
      this.root.rotation.y = this.sitYaw + dyaw * smooth((s - 0.5) / 0.5);
    }
    this.root.updateMatrixWorld(true);

    if (waveWeight > 0) {
      this.turnUpperBody(this.chest, this.waveTurn * 0.25 * waveWeight);
      this.turnUpperBody(this.head, this.waveTurn * 0.75 * waveWeight);
    }
    const ikWeight = 1 - smooth(s * 3);
    if (ikWeight > 0.001) this.typingIK(typing, grips, ikWeight, waveWeight);
  }

  private turnUpperBody(joint: THREE.Object3D | undefined, angle: number): void {
    if (!joint) return;
    // Converte a vertical da sala para o eixo local do osso, inclusive em rigs exportados com eixos diferentes.
    this.tmpT.set(0, 1, 0).applyQuaternion(joint.getWorldQuaternion(this.tmpQ).invert());
    joint.rotateOnAxis(this.tmpT, angle);
  }

  /**
   * Pesos das animações: alvos pela fase (sentado ↔ de pé, caminhando), seguidos de forma suave e normalizados
   * para somar 1 (senão a pose de repouso do esqueleto vaza na mistura).
   */
  private blendClips(dt: number, s: number): void {
    const target: Partial<Record<Clip, number>> = {};
    if (this.state === 'walking') target.walk = 1;
    else {
      target.sit = 1 - s;
      target[this.standing] = (target[this.standing] ?? 0) + s;
    }
    const k = Math.min(1, dt * BLEND_RATE);
    let sum = 0;
    for (const key of Object.keys(this.actions) as Clip[]) {
      const w = (this.weights[key] ?? 0) + ((target[key] ?? 0) - (this.weights[key] ?? 0)) * k;
      this.weights[key] = w;
      sum += w;
    }
    for (const key of Object.keys(this.actions) as Clip[]) this.actions[key]!.setEffectiveWeight(sum > 0 ? (this.weights[key] ?? 0) / sum : 0);
  }

  private next(state: State): void {
    this.state = state;
    this.t = 0;
  }

  private typingIK(typing: boolean, grips: Grips, weight: number, waveWeight: number): void {
    const t = this.time;
    const on = typing ? 1 : 0;
    const hop = (phase: number) => on * Math.max(0, Math.sin(t * 17 + phase)) * 0.005;
    const base = grips.left.userData.base as THREE.Vector3 | undefined;
    const baseR = grips.right.userData.base as THREE.Vector3 | undefined;
    if (base) grips.left.position.set(base.x + Math.sin(t * 2.3) * 0.02 * on, base.y + hop(0), base.z);
    if (baseR) grips.right.position.set(baseR.x + Math.sin(t * 1.9 + 1) * 0.02 * on, baseR.y + hop(Math.PI * 0.7), baseR.z);
    grips.left.parent?.updateMatrixWorld(true);

    grips.left.parent?.getWorldQuaternion(this.roomRotation);
    for (const { ik, side, upper, lower, hand, contact } of this.arms) {
      const armWeight = side === 'right' ? weight * (1 - waveWeight) : weight;
      if (armWeight <= 0) continue;
      grips[side].getWorldPosition(this.tmpT);
      (side === 'left' ? grips.poleLeft : grips.poleRight).getWorldPosition(this.tmpP);
      if (contact) this.tmpT.sub(this.tipOffset.copy(contact.offset).applyQuaternion(this.roomRotation));
      ik.solve(this.tmpT, this.tmpP);
      if (contact && hand.parent) {
        hand.parent.getWorldQuaternion(this.tmpQ).invert().multiply(this.roomRotation).multiply(contact.rotation);
        hand.quaternion.copy(this.tmpQ);
      }
      if (armWeight < 1) {
        hand.quaternion.slerp(this.basePose.get(hand)!, 1 - armWeight);
        upper.quaternion.slerp(this.basePose.get(upper)!, 1 - armWeight);
        lower.quaternion.slerp(this.basePose.get(lower)!, 1 - armWeight);
      }
    }
  }
}
