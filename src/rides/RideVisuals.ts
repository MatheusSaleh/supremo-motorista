// Elementos 3D das corridas: farol no ponto de embarque/desembarque, seta de direção sobre o carro e o
// passageiro acenando na calçada.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterAsset } from '../player/CharacterAsset';
import { makeDresser, type Look } from '../player/outfit';

/**
 * Coluna de luz + anel no chão. Só aparece perto (revealDistance): de longe, o jogador tem que se virar
 * com a seta e as placas — achar endereço em Brasília faz parte da piada.
 */
export class Beacon {
  readonly root = new THREE.Group();
  private readonly column: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly columnMat: THREE.MeshBasicMaterial;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private t = 0;

  constructor(color: number, radius: number) {
    this.columnMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60, 24, 1, true).translate(0, 30, 0), this.columnMat);
    this.ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2), this.ringMat);
    this.ring.position.y = 0.08;
    this.root.add(this.column, this.ring);
    this.root.visible = false;
    this.setRadius(radius);
  }

  setRadius(r: number): void {
    this.ring.scale.set(r, 1, r);
    this.column.scale.set(r * 0.35, 1, r * 0.35);
  }

  place(x: number, y: number, z: number, color: number): void {
    this.root.position.set(x, y, z);
    this.columnMat.color.set(color);
    this.ringMat.color.set(color);
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  /** Aparece gradualmente ao se aproximar; pulsa. */
  update(dt: number, viewer: THREE.Vector3Like, reveal: number): void {
    if (!this.root.visible) return;
    this.t += dt;
    const d = Math.hypot(viewer.x - this.root.position.x, viewer.z - this.root.position.z);
    const k = THREE.MathUtils.clamp(1 - (d - reveal * 0.6) / (reveal * 0.4), 0, 1);
    const pulse = 0.85 + 0.15 * Math.sin(this.t * 4);
    this.columnMat.opacity = 0.28 * k * pulse;
    this.ringMat.opacity = 0.6 * k * pulse;
    this.column.visible = this.ring.visible = k > 0.01;
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

/** Seta 3D que aponta (no plano) para o alvo, acima do carro — ou à frente do para-brisa no cockpit. */
export class DirectionArrow {
  readonly root = new THREE.Group();
  private readonly mat: THREE.MeshStandardMaterial;
  private t = 0;

  constructor() {
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffa800, emissiveIntensity: 0.6, roughness: 0.4 });
    const shape = new THREE.Shape([
      new THREE.Vector2(0, 1.1),
      new THREE.Vector2(0.62, 0.25),
      new THREE.Vector2(0.24, 0.25),
      new THREE.Vector2(0.24, -0.75),
      new THREE.Vector2(-0.24, -0.75),
      new THREE.Vector2(-0.24, 0.25),
      new THREE.Vector2(-0.62, 0.25),
    ]);
    // Seta deitada: rotateX(90°) leva a ponta (+Y do shape) para +Z e a espessura para o eixo Y.
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false }).translate(0, 0, -0.09).rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.castShadow = false;
    this.root.add(mesh);
    this.root.visible = false;
  }

  /** @param anchor ponto no mundo onde a seta fica; @param target alvo (x, z) */
  update(dt: number, anchor: THREE.Vector3, target: { x: number; z: number }, scale: number, urgent: boolean): void {
    this.t += dt;
    this.root.visible = true;
    this.root.position.copy(anchor);
    this.root.position.y += Math.sin(this.t * 3) * 0.08 * scale;
    this.root.rotation.set(0, Math.atan2(target.x - anchor.x, target.z - anchor.z), 0);
    this.root.scale.setScalar(scale);
    this.mat.emissive.set(urgent && Math.sin(this.t * 10) > 0 ? 0xff3b1f : 0xffa800);
  }

  hide(): void {
    this.root.visible = false;
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

/** Passageiro esperando na calçada: acena até o carro chegar. */
export class PassengerNpc {
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer | null = null;
  /** Troca terno/pele (um passageiro diferente a cada corrida). */
  readonly setLook: (look: Look) => void;

  constructor(asset: CharacterAsset, waveClip: string) {
    const body = cloneSkinned(asset.template);
    body.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.root.add(body);
    this.setLook = makeDresser(body);
    const clip = asset.clips.find((c) => c.name.toLowerCase().includes(waveClip.toLowerCase()));
    if (clip) {
      this.mixer = new THREE.AnimationMixer(body);
      this.mixer.clipAction(clip).play();
    }
    this.root.visible = false;
  }

  place(x: number, y: number, z: number, faceX: number, faceZ: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = Math.atan2(faceX - x, faceZ - z);
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  update(dt: number): void {
    if (this.root.visible) this.mixer?.update(dt);
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
  }
}
