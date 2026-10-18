// Jogador local: corpo cinemático do Rapier + KinematicCharacterController.
// Não lê o teclado diretamente; recebe um MoveIntent (direção já em espaço de mundo).
// Isso permite reaproveitar a lógica com outras fontes de input e manter o Avatar desacoplado.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Config } from '../config';
import { COLLISION } from '../core/collisionGroups';
import { damp, dampAngle, wrapAngle } from '../core/math';
import type { Avatar } from './Avatar';
import { createPlayerState, type PlayerState } from './PlayerState';

export interface MoveIntent {
  /** Direção desejada no plano XZ (mundo), comprimento 0..1. */
  x: number;
  z: number;
  run: boolean;
}

export interface SpawnPoint {
  /** Posição dos pés. */
  position: THREE.Vector3Like;
  yaw: number;
}

export type PlayerEvent = { type: 'jump' } | { type: 'land'; airTime: number };

export class Player {
  readonly state: PlayerState;

  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;

  private readonly velocity = new THREE.Vector3();
  // Posições do centro da cápsula antes/depois do último passo fixo, para interpolar o render.
  private readonly prevCenter = new THREE.Vector3();
  private readonly currCenter = new THREE.Vector3();
  private readonly renderCenter = new THREE.Vector3();

  private grounded = false;
  private timeSinceGrounded = 0;
  private jumpBufferTimer = 0;
  private targetYaw = 0;
  private actualSpeed = 0;
  private enabled = true;
  private airTime = 0;
  private readonly events: PlayerEvent[] = [];
  /** Distância andada no chão (m), acumulada; usada para o ritmo dos passos. */
  distanceWalked = 0;

  constructor(
    private readonly physics: RAPIER.World,
    private readonly cfg: Config,
    readonly avatar: Avatar,
    private readonly spawn: SpawnPoint,
    id = 'local',
    name = 'Você',
  ) {
    const p = cfg.player;
    this.state = createPlayerState(id, name);

    this.body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = physics.createCollider(RAPIER.ColliderDesc.capsule(p.halfHeight, p.radius).setCollisionGroups(COLLISION.player), this.body);

    this.controller = physics.createCharacterController(p.controllerOffset);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(p.maxSlopeDeg));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(p.maxSlopeDeg + 5));
    this.controller.enableAutostep(p.autostepHeight, 0.2, false);
    this.controller.enableSnapToGround(p.snapToGround);
    this.controller.setApplyImpulsesToDynamicBodies(true);

    this.respawn();
  }

  /** Registra a intenção de pular; vale por alguns ms (jump buffer). */
  requestJump(): void {
    this.jumpBufferTimer = this.cfg.player.jumpBuffer;
  }

  /** Passo de física fixo. Deve ser chamado antes de physics.step(). */
  fixedUpdate(dt: number, intent: MoveIntent): void {
    const p = this.cfg.player;
    const g = this.cfg.physics.gravity;

    // Velocidade horizontal converge para o alvo (mais lento no ar = pouco controle aéreo).
    const speed = intent.run ? p.runSpeed : p.walkSpeed;
    const k = damp(this.grounded ? p.groundAccel : p.airAccel, dt);
    this.velocity.x += (intent.x * speed - this.velocity.x) * k;
    this.velocity.z += (intent.z * speed - this.velocity.z) * k;

    if (intent.x !== 0 || intent.z !== 0) this.targetYaw = Math.atan2(intent.x, intent.z);

    // Pulo com coyote time + buffer.
    this.jumpBufferTimer -= dt;
    this.timeSinceGrounded = this.grounded ? 0 : this.timeSinceGrounded + dt;
    if (this.jumpBufferTimer > 0 && this.timeSinceGrounded <= p.coyoteTime && this.velocity.y <= 0) {
      this.velocity.y = Math.sqrt(2 * g * p.jumpHeight);
      this.events.push({ type: 'jump' });
      this.jumpBufferTimer = 0;
      this.timeSinceGrounded = Infinity; // impede pulo duplo via coyote time
    }

    this.velocity.y -= g * dt;

    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    // Snap to ground só faz sentido quando não estamos subindo (senão "cola" o pulo no chão).
    if (this.velocity.y > 0) this.controller.disableSnapToGround();
    else this.controller.enableSnapToGround(p.snapToGround);

    this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, COLLISION.player);
    const moved = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (!this.grounded) this.airTime += dt;
    else {
      if (this.airTime > 0.25) this.events.push({ type: 'land', airTime: this.airTime });
      this.airTime = 0;
    }

    // Bateu a cabeça: zera a subida.
    if (desired.y > 1e-4 && moved.y < desired.y * 0.5) this.velocity.y = 0;
    if (this.grounded && this.velocity.y < 0) this.velocity.y = -1; // mantém contato leve com o chão
    // Velocidade efetiva (após colisões) para escolher animação. Não sobrescrevemos this.velocity
    // com ela: zerar a velocidade ao encostar num degrau impede o autostep do Rapier de subir.
    this.actualSpeed = dt > 0 ? Math.hypot(moved.x, moved.z) / dt : 0;
    if (this.grounded) this.distanceWalked += Math.hypot(moved.x, moved.z);

    const t = this.body.translation();
    this.prevCenter.copy(this.currCenter);
    this.currCenter.set(t.x + moved.x, t.y + moved.y, t.z + moved.z);
    this.body.setNextKinematicTranslation(this.currCenter);

    // Caiu do mapa: volta para o spawn.
    if (this.currCenter.y < -50) this.respawn();
  }

  /** Atualização por frame (render). alpha = fração entre o último e o próximo passo fixo. */
  update(dt: number, alpha: number): void {
    this.renderCenter.lerpVectors(this.prevCenter, this.currCenter, alpha);
    this.state.yaw = wrapAngle(dampAngle(this.state.yaw, this.targetYaw, this.cfg.player.turnSpeed, dt));
    this.syncState(alpha);
    this.avatar.update(dt, this.state);
  }

  /** Move instantaneamente (posição dos pés). */
  teleport(x: number, y: number, z: number, yaw?: number): void {
    const p = this.cfg.player;
    this.currCenter.set(x, y + p.halfHeight + p.radius + p.controllerOffset, z);
    this.prevCenter.copy(this.currCenter);
    this.body.setTranslation(this.currCenter, true);
    this.velocity.set(0, 0, 0);
    if (yaw !== undefined) this.state.yaw = this.targetYaw = yaw;
    this.syncState(1);
  }

  /** Retorna e limpa os eventos acumulados desde a última chamada. */
  drainEvents(): PlayerEvent[] {
    return this.events.splice(0);
  }

  /** Desativado = dentro do carro: sem colisor, invisível e sem simulação. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.collider.setEnabled(on);
    this.avatar.root.visible = on;
    this.velocity.set(0, 0, 0);
  }

  /** Verdadeiro se a cápsula cabe com os pés em `feet` (ex.: ao sair do carro). */
  canFitAt(feet: THREE.Vector3Like, ignore?: RAPIER.RigidBody): boolean {
    const p = this.cfg.player;
    const center = { x: feet.x, y: feet.y + p.halfHeight + p.radius + 0.05, z: feet.z };
    const shape = new RAPIER.Capsule(p.halfHeight, p.radius);
    const hit = this.physics.intersectionWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, COLLISION.player, this.collider, ignore);
    return hit === null;
  }

  /** Mantém o estado (minimapa etc.) seguindo um ponto externo enquanto desativado. */
  followExternal(x: number, y: number, z: number, yaw: number): void {
    this.state.x = x;
    this.state.y = y;
    this.state.z = z;
    this.state.yaw = this.targetYaw = yaw;
    this.state.moveState = 'idle';
  }

  respawn(): void {
    const s = this.spawn;
    this.teleport(s.position.x, s.position.y, s.position.z, s.yaw);
  }

  /** Posição dos pés interpolada (para câmera, sombra etc.). */
  get position(): THREE.Vector3Like {
    return this.state;
  }

  dispose(): void {
    this.physics.removeCharacterController(this.controller);
    this.physics.removeRigidBody(this.body);
    this.avatar.dispose();
  }

  private syncState(alpha: number): void {
    const p = this.cfg.player;
    const c = alpha === 1 ? this.currCenter : this.renderCenter;
    this.state.x = c.x;
    this.state.y = c.y - (p.halfHeight + p.radius);
    this.state.z = c.z;

    const hSpeed = this.actualSpeed;
    this.state.speed = hSpeed;
    if (!this.grounded) this.state.moveState = this.velocity.y > 0 ? 'jump' : 'fall';
    else if (hSpeed < 0.3) this.state.moveState = 'idle';
    else this.state.moveState = hSpeed > (p.walkSpeed + p.runSpeed) / 2 ? 'run' : 'walk';
  }
}
