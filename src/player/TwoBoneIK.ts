// IK analítica de dois ossos (braço → antebraço → ponta), em espaço de mundo.
// Leva a ponta (mão) até o alvo, dobrando o "cotovelo" na direção de um ponto de referência (pole).
// Se o alvo estiver longe demais, estica o braço o máximo possível na direção dele.
import * as THREE from 'three';

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const dirT = new THREE.Vector3();
const bend = new THREE.Vector3();
const desiredB = new THREE.Vector3();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const qDelta = new THREE.Quaternion();
const qWorld = new THREE.Quaternion();
const qParent = new THREE.Quaternion();

export class TwoBoneIK {
  constructor(
    private readonly upper: THREE.Bone,
    private readonly lower: THREE.Bone,
    private readonly end: THREE.Object3D,
  ) {}

  solve(target: THREE.Vector3, pole: THREE.Vector3): void {
    this.upper.updateWorldMatrix(true, true);
    this.upper.getWorldPosition(a);
    this.lower.getWorldPosition(b);
    this.end.getWorldPosition(c);
    const lenA = a.distanceTo(b);
    const lenB = b.distanceTo(c);
    if (lenA < 1e-6 || lenB < 1e-6) return;

    dirT.subVectors(target, a);
    const d = THREE.MathUtils.clamp(dirT.length(), Math.abs(lenA - lenB) + 1e-4, lenA + lenB - 1e-4);
    dirT.normalize();

    // Lei dos cossenos: ângulo entre o braço e a linha ombro→alvo.
    const cosAlpha = THREE.MathUtils.clamp((lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d), -1, 1);
    const sinAlpha = Math.sqrt(1 - cosAlpha * cosAlpha);
    // Direção da dobra: componente do pole perpendicular à linha ombro→alvo.
    bend.subVectors(pole, a);
    bend.addScaledVector(dirT, -bend.dot(dirT));
    if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0).addScaledVector(dirT, -dirT.y);
    bend.normalize();
    desiredB.copy(a).addScaledVector(dirT, cosAlpha * lenA).addScaledVector(bend, sinAlpha * lenA);

    // 1) Gira o braço para o cotovelo ir à posição desejada.
    rotateBoneToward(this.upper, v1.subVectors(b, a), v2.subVectors(desiredB, a));
    // 2) Gira o antebraço para a ponta apontar para o alvo.
    this.upper.updateWorldMatrix(false, true);
    this.lower.getWorldPosition(b);
    this.end.getWorldPosition(c);
    rotateBoneToward(this.lower, v1.subVectors(c, b), v2.subVectors(target, b));
    this.lower.updateWorldMatrix(false, true);
  }
}

/** Aplica ao osso a rotação (em mundo) que leva o vetor `from` ao vetor `to`. */
function rotateBoneToward(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  qDelta.setFromUnitVectors(from.normalize(), to.normalize());
  bone.getWorldQuaternion(qWorld);
  qWorld.premultiply(qDelta);
  if (bone.parent) bone.parent.getWorldQuaternion(qParent);
  else qParent.identity();
  bone.quaternion.copy(qParent.invert().multiply(qWorld));
}
