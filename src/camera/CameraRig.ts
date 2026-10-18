// Câmera em terceira pessoa: orbita o alvo com yaw/pitch, zoom no scroll,
// suavização exponencial e raycast (BVH) para não atravessar paredes.
// Modo perseguição (passando `chase` em update): fica atrás da direção do movimento,
// afasta com a velocidade e abre o FOV; mexer o mouse olha em volta por alguns instantes.
import * as THREE from 'three';
import type { Config } from '../config';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math';

export interface ChaseTarget {
  /** Direção para onde a câmera deve olhar (rad, 0 = +Z). */
  heading: number;
  /** Velocidade (m/s). */
  speed: number;
}

export class CameraRig {
  yaw = 0;
  pitch: number;
  /** Distância desejada pelo jogador (zoom). */
  distance: number;

  /** Multiplicador da distância no modo perseguição (scroll). */
  chaseZoom = 1;

  private currentDistance: number;
  private lookIdle = Infinity; // tempo desde o último movimento do mouse
  private readonly smoothTarget = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly dir = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private initialized = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly cfg: Config,
    /** Malhas contra as quais a câmera colide (devem ter BVH). */
    private readonly colliders: () => readonly THREE.Object3D[],
  ) {
    this.pitch = cfg.camera.pitch;
    this.distance = cfg.camera.distance;
    this.currentDistance = this.distance;
    this.raycaster.firstHitOnly = true;
  }

  handleInput(mouseDX: number, mouseDY: number, wheel: number): void {
    const c = this.cfg.camera;
    this.yaw = wrapAngle(this.yaw - mouseDX * c.mouseSensitivity);
    this.pitch = clamp(this.pitch + mouseDY * c.mouseSensitivity, c.minPitch, c.maxPitch);
    const zoom = Math.exp(wheel * c.zoomSensitivity);
    this.distance = clamp(this.distance * zoom, c.minDistance, c.maxDistance);
    this.chaseZoom = clamp(this.chaseZoom * zoom, 0.6, 1.8);
    if (mouseDX !== 0 || mouseDY !== 0) this.lookIdle = 0;
  }

  // Câmera de cockpit: olhar livre (relativo ao carro) que volta para a frente sozinho.
  private lookYaw = 0;
  private lookPitch = 0;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler(0, 0, 0, 'YXZ');

  /**
   * Primeira pessoa no banco do motorista. `eyes` é um objeto preso ao carro (frente = +Z local).
   * Usa os mesmos deltas de mouse: chame handleInput antes, como no modo normal.
   */
  updateCockpit(dt: number, eyes: THREE.Object3D, mouseDX: number, mouseDY: number): void {
    const c = this.cfg.camera;
    this.lookIdle += dt;
    if (mouseDX !== 0 || mouseDY !== 0) {
      this.lookYaw = clamp(this.lookYaw - mouseDX * c.mouseSensitivity, -1.9, 1.9);
      this.lookPitch = clamp(this.lookPitch - mouseDY * c.mouseSensitivity, -0.7, 0.5);
    } else if (this.lookIdle > c.chase.freeLookTime) {
      const k = damp(c.chase.yawDamping, dt);
      this.lookYaw -= this.lookYaw * k;
      this.lookPitch -= this.lookPitch * k;
    }
    eyes.getWorldPosition(this.camera.position);
    eyes.getWorldQuaternion(this.tmpQ);
    // A câmera olha para −Z; o carro anda para +Z: meia-volta + olhar livre.
    // Olhar um pouco para baixo por padrão: volante e mãos entram no quadro.
    this.camera.quaternion.copy(this.tmpQ).multiply(new THREE.Quaternion().setFromEuler(this.tmpE.set(this.lookPitch + c.cockpitPitch, Math.PI + this.lookYaw, 0)));
    if (Math.abs(this.camera.fov - c.cockpitFov) > 0.01) {
      this.camera.fov = c.cockpitFov;
      this.camera.updateProjectionMatrix();
    }
    // Ao voltar para a câmera externa, ela recomeça suave a partir de onde o carro está.
    this.smoothTarget.copy(this.camera.position);
  }

  /** Direção "para frente" da câmera projetada no chão (XZ), normalizada. */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** @param focus pés do personagem ou centro do carro; @param chase ativa o modo perseguição. */
  update(dt: number, focus: THREE.Vector3Like, chase?: ChaseTarget): void {
    const c = this.cfg.camera;
    this.distance = clamp(this.distance, c.minDistance, c.maxDistance);
    this.lookIdle += dt;

    let distance = this.distance;
    let height = c.targetHeight;
    let fov = c.fov;
    if (chase) {
      const ch = c.chase;
      if (this.lookIdle > ch.freeLookTime) {
        this.yaw = wrapAngle(dampAngle(this.yaw, chase.heading + Math.PI, ch.yawDamping, dt));
        this.pitch += (ch.pitch - this.pitch) * damp(ch.yawDamping, dt);
      }
      distance = Math.min(ch.distance + chase.speed * ch.distancePerSpeed, ch.maxDistance) * this.chaseZoom;
      height = ch.targetHeight;
      fov += ch.fovBoost * clamp(chase.speed / this.cfg.car.maxSpeed, 0, 1);
    }
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * damp(4, dt);
      this.camera.updateProjectionMatrix();
    }

    const target = this.target.set(focus.x, focus.y + height, focus.z);
    if (!this.initialized) {
      this.smoothTarget.copy(target);
      this.initialized = true;
    } else {
      this.smoothTarget.lerp(target, damp(c.followDamping, dt));
    }

    // Direção do alvo para a câmera (coordenadas esféricas).
    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    // Colisão: se algo estiver entre o alvo e a câmera, aproxima na hora; afasta suavemente.
    let allowed = distance;
    this.raycaster.set(this.smoothTarget, this.dir);
    this.raycaster.far = distance + c.collisionPadding;
    const hit = this.raycaster.intersectObjects(this.colliders() as THREE.Object3D[], false)[0];
    if (hit) allowed = Math.max(c.minDistance * 0.25, hit.distance - c.collisionPadding);

    if (allowed < this.currentDistance) this.currentDistance = allowed;
    else this.currentDistance += (allowed - this.currentDistance) * damp(c.zoomDamping, dt);

    this.camera.position.copy(this.smoothTarget).addScaledVector(this.dir, this.currentDistance);
    this.camera.lookAt(this.smoothTarget);
  }
}
