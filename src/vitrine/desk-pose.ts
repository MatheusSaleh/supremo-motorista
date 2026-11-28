// Ajusta a pose de motorista ao mobiliário da vitrine. As medidas são locais à sala, em metros.
import * as THREE from 'three';
import type { Config } from '../config';
import { type CHAIR, RUG_TOP } from './office';

type FindBone = (name: string) => THREE.Object3D | undefined;
type Side = 'left' | 'right';

function setWorldRotation(bone: THREE.Object3D, rotation: THREE.Quaternion): void {
  const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  bone.quaternion.copy(parent.invert().multiply(rotation));
}

function pointBone(bone: THREE.Object3D, end: THREE.Object3D, direction: THREE.Vector3): void {
  const from = end.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(from, direction.normalize());
  setWorldRotation(bone, turn.multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
}

/** Prepara uma cópia da pose para a mesa; o mixer também usa essa pose ao chegar e ao levantar. */
export function fitDeskPose(body: THREE.Object3D, find: FindBone, cfg: Config['character'], sit: THREE.AnimationClip | undefined, seat: typeof CHAIR) {
  // Na pose de referência o modelo está normalizado com as solas no chão.
  const legs = [];
  for (const side of ['left', 'right'] as const) {
    const foot = find(cfg.footBones[side]);
    const knee = foot?.parent;
    const hip = knee?.parent;
    if (foot && knee instanceof THREE.Bone && hip instanceof THREE.Bone) {
      legs.push({
        hip, knee, foot,
        ankleY: foot.getWorldPosition(new THREE.Vector3()).y + RUG_TOP,
        flat: foot.getWorldQuaternion(new THREE.Quaternion()),
      });
    }
  }

  const mixer = new THREE.AnimationMixer(body);
  if (sit) mixer.clipAction(sit).play();
  mixer.update(0);
  const hips = find(cfg.hipsBone)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 0.45, 0);
  const position = new THREE.Vector3(seat.x - hips.x, 0, seat.z - 0.05 - hips.z);
  const rotations = new Map<string, THREE.Quaternion>();
  const save = (joint: THREE.Object3D) => rotations.set(joint.name, joint.quaternion.clone());

  for (const { hip, knee } of legs) {
    // Coxas com leve declive até a borda do assento.
    const direction = knee.getWorldPosition(new THREE.Vector3()).sub(hip.getWorldPosition(new THREE.Vector3()));
    direction.y = 0;
    direction.normalize();
    direction.y = -0.34;
    pointBone(hip, knee, direction);
    save(hip);
  }

  body.updateMatrixWorld(true);
  let contactY = Infinity;
  const vertex = new THREE.Vector3();
  body.traverse((mesh) => {
    if (!(mesh instanceof THREE.SkinnedMesh)) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
      if (Math.abs(vertex.x + position.x - seat.x) <= seat.width / 2 && Math.abs(vertex.z + position.z - seat.z) <= seat.depth / 2) {
        contactY = Math.min(contactY, vertex.y);
      }
    }
  });
  position.y = seat.seat - (Number.isFinite(contactY) ? contactY : hips.y - 0.12);

  for (const { knee, foot, ankleY, flat } of legs) {
    const from = knee.getWorldPosition(new THREE.Vector3());
    const length = from.distanceTo(foot.getWorldPosition(new THREE.Vector3()));
    const dy = THREE.MathUtils.clamp(ankleY - position.y - from.y, -length, length);
    // Mantém o comprimento da canela e coloca o calcanhar à frente do joelho, com a sola plana.
    pointBone(knee, foot, new THREE.Vector3(0, dy, -Math.sqrt(Math.max(0, length * length - dy * dy))));
    setWorldRotation(foot, flat);
    save(knee);
    save(foot);
  }

  const spine = find(cfg.spineBone);
  if (spine) {
    const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.36);
    setWorldRotation(spine, lean.multiply(spine.getWorldQuaternion(new THREE.Quaternion())));
    save(spine);
  }

  // Só os ossos ajustados recebem uma rotação fixa. As trilhas do modelo original são compartilhadas para leitura.
  const tracks = sit?.tracks.filter((track) => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    return propertyName !== 'quaternion' || !rotations.has(nodeName);
  }) ?? [];
  for (const [name, q] of rotations) tracks.push(new THREE.QuaternionKeyframeTrack(name + '.quaternion', [0], q.toArray()));
  mixer.stopAllAction();
  return { position, clip: new THREE.AnimationClip('sentado à mesa', sit?.duration ?? 1, tracks) };
}

/** Orientação da mão sobre as teclas e distância, nessa orientação, do pulso até o dedo médio. */
export function keyboardContact(find: FindBone, cfg: Config['character'], side: Side, hand: THREE.Object3D) {
  const names = cfg.fingertips[side];
  const index = find(names.index);
  const middle = find(names.middle);
  const pinky = find(names.pinky);
  if (!index || !middle || !pinky) return;
  const offset = middle.getWorldPosition(new THREE.Vector3()).sub(hand.getWorldPosition(new THREE.Vector3()));
  const z = offset.clone().negate().normalize();
  const across = index.getWorldPosition(new THREE.Vector3()).sub(pinky.getWorldPosition(new THREE.Vector3()));
  if (side === 'right') across.negate();
  const y = z.clone().cross(across).normalize();
  const basis = new THREE.Matrix4().makeBasis(y.clone().cross(z), y, z);
  const align = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.17)
    .multiply(new THREE.Quaternion().setFromRotationMatrix(basis).invert());
  return { offset: offset.applyQuaternion(align), rotation: align.multiply(hand.getWorldQuaternion(new THREE.Quaternion())) };
}
