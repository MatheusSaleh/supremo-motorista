// Carro oficial: corpo dinâmico do Rapier + DynamicRayCastVehicleController, com ajudas arcade
// (limite de velocidade suave, esterço que diminui com a velocidade, drift no freio de mão,
// downforce, controle no ar, turbo e desvirar automático).
// Frente do carro = +Z local. Não lê teclado: recebe CarControls.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Config } from '../config';
import { COLLISION } from '../core/collisionGroups';
import { clamp, damp, wrapAngle } from '../core/math';
import { createProceduralCarModel } from './carModel';
import { vehicleParams, type VehicleDef } from '../data/vehicles';
import { createCarModelFromAsset, DEFAULT_GEOMETRY, type CarAsset, type CarModel, type VehicleGeometry } from './CarVisual';

export interface CarControls {
  /** −1 (ré/freio) … 1 (acelerar). */
  throttle: number;
  /** −1 (direita) … 1 (esquerda). */
  steer: number;
  handbrake: boolean;
  turbo: boolean;
}

/** Eventos físicos para áudio/efeitos (consumidos por quem quiser via drainEvents). */
export type CarEvent =
  | { type: 'impact'; strength: number; /** direção do obstáculo, no espaço do carro */ localDir: THREE.Vector3 }
  | { type: 'land'; airTime: number };

/** Multiplicadores das melhorias da Oficina (Fase 11). */
export interface CarMods {
  engine: number;
  speed: number;
  grip: number;
  turboRecharge: number;
  turboForce: number;
  stiffness: number;
}

const NO_MODS: CarMods = { engine: 1, speed: 1, grip: 1, turboRecharge: 1, turboForce: 1, stiffness: 1 };

export const NO_CONTROLS: Readonly<CarControls> = { throttle: 0, steer: 0, handbrake: false, turbo: false };

/** Altura dos pontos de fixação das rodas no espaço do chassi. */
const WHEEL_Y = -0.08;

export class Car {
  readonly model: CarModel;
  readonly body: RAPIER.RigidBody;
  private readonly vehicle: RAPIER.DynamicRayCastVehicleController;

  /** Energia do turbo, 0..1. */
  turbo = 1;
  turboActive = false;
  /** Quanto o carro está derrapando, 0..1 (velocidade lateral dos pneus). */
  slip = 0;
  /** Freio de mão puxado no último passo. */
  handbrake = false;
  /** Freando (lanterna acesa) e engatado em ré (luz de ré), para o visual. */
  braking = false;
  reversing = false;
  /** Fora do asfalto (definido por quem conhece o piso, a cada poucos passos). */
  offroad = false;
  private gripMul = 1;
  /** Aderência do clima (1 = seco; pista molhada reduz). Ajustada pelo env/Atmosphere. */
  weatherGrip = 1;
  /** Melhorias da Oficina (ver setMods). */
  private mods: CarMods = NO_MODS;
  /** 0 = limpo … 1 = imundo (cada carro da frota tem a sua). */
  dirt = 0;
  /** Amassado desde a última passada na oficina. */
  damaged = false;
  /** Parâmetros efetivos (config.car + ajustes do modelo). */
  readonly p: Config['car'];
  readonly geo: VehicleGeometry;

  private steer = 0;
  private rearGrip: number;
  private flipTimer = 0;
  private airTime = 0;
  private readonly prevVel = new THREE.Vector3();
  private readonly events: CarEvent[] = [];
  private readonly inertia: RAPIER.Vector;

  // Transformações antes/depois do último passo fixo (interpolação visual).
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevRot = new THREE.Quaternion();
  private readonly currRot = new THREE.Quaternion();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();

  constructor(
    private readonly physics: RAPIER.World,
    private readonly cfg: Config,
    position: THREE.Vector3Like,
    yaw: number,
    asset: CarAsset | null = null,
    readonly def: VehicleDef | null = null,
  ) {
    this.geo = asset?.geometry ?? DEFAULT_GEOMETRY;
    const c = (this.p = vehicleParams(cfg.car, def, this.geo.wheelRadius));
    this.rearGrip = c.sideFriction;
    this.model = asset ? createCarModelFromAsset(asset, def ? def.paint : 0x111317, def?.modelInterior) : createProceduralCarModel(c.wheelRadius);
    const HALF = this.geo.half;

    this.body = physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.4),
    );
    // Massa e inércia explícitas, com centro de massa baixo (estabilidade arcade).
    const m = c.mass;
    const [w, h, d] = [HALF.x * 2, HALF.y * 2, HALF.z * 2];
    this.inertia = { x: (m / 12) * (h * h + d * d), y: (m / 12) * (w * w + d * d), z: (m / 12) * (w * w + h * h) };
    physics.createCollider(
      RAPIER.ColliderDesc.cuboid(HALF.x, HALF.y, HALF.z)
        .setMassProperties(m, { x: 0, y: c.centerOfMassY, z: 0 }, this.inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.4)
        .setCollisionGroups(COLLISION.car),
      this.body,
    );
    // Cabine (sem massa): o carro capotado apoia no teto em vez de afundar o chassi.
    physics.createCollider(
      RAPIER.ColliderDesc.cuboid(this.geo.cabin.x, this.geo.cabin.y, this.geo.cabin.z)
        .setTranslation(0, this.geo.cabin.cy, this.geo.cabin.cz)
        .setDensity(0)
        .setFriction(0.4)
        .setCollisionGroups(COLLISION.car),
      this.body,
    );

    this.vehicle = physics.createVehicleController(this.body);
    this.vehicle.indexUpAxis = 1;
    this.vehicle.setIndexForwardAxis = 2;
    for (const [x, z] of this.geo.wheels) {
      this.vehicle.addWheel({ x, y: WHEEL_Y, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, c.suspensionRest, c.wheelRadius);
    }
    this.applyWheelParams();
    this.reset(position, yaw);
  }

  /** Melhorias da Oficina: valem a partir do próximo passo. */
  setMods(mods: CarMods): void {
    this.mods = mods;
    this.applyWheelParams();
  }

  /** Reaplica parâmetros de suspensão/atrito (chamado também pelo lil-gui). */
  applyWheelParams(): void {
    const c = this.p;
    for (let i = 0; i < 4; i++) {
      const v = this.vehicle;
      v.setWheelRadius(i, c.wheelRadius);
      v.setWheelSuspensionRestLength(i, c.suspensionRest);
      v.setWheelSuspensionStiffness(i, c.suspensionStiffness * this.mods.stiffness);
      v.setWheelSuspensionCompression(i, c.suspensionCompression);
      v.setWheelSuspensionRelaxation(i, c.suspensionRelaxation);
      v.setWheelMaxSuspensionTravel(i, c.maxSuspensionTravel);
      v.setWheelMaxSuspensionForce(i, c.mass * 60);
      v.setWheelFrictionSlip(i, c.frictionSlip * this.mods.grip);
      v.setWheelSideFrictionStiffness(i, c.sideFriction * this.mods.grip);
    }
  }

  /** Velocidade para frente (m/s, negativa em ré). */
  get forwardSpeed(): number {
    return this.vehicle.currentVehicleSpeed();
  }

  /** Ângulo de esterço atual das rodas dianteiras (rad). */
  get steerAngle(): number {
    return this.vehicle.wheelSteering(0) ?? 0;
  }

  get speedKmh(): number {
    return Math.abs(this.forwardSpeed) * 3.6;
  }

  get wheelsOnGround(): number {
    let n = 0;
    for (let i = 0; i < 4; i++) if (this.vehicle.wheelIsInContact(i)) n++;
    return n;
  }

  /** Posição interpolada (para câmera, HUD). */
  get position(): THREE.Vector3 {
    return this.model.root.position;
  }

  /** Direção do carro em torno de Y (0 = +Z), a partir da rotação interpolada. */
  get heading(): number {
    const f = this.tmpV.set(0, 0, 1).applyQuaternion(this.model.root.quaternion);
    return Math.atan2(f.x, f.z);
  }

  /** Direção da velocidade no plano (rad) e módulo (m/s). */
  velocityHeading(): { yaw: number; speed: number } {
    const v = this.body.linvel();
    return { yaw: Math.atan2(v.x, v.z), speed: Math.hypot(v.x, v.z) };
  }

  /** Pés de quem sai pela porta (1 = motorista/esquerda, −1 = passageiro), em coordenadas de mundo. */
  doorPoint(side: 1 | -1 = 1, out = new THREE.Vector3()): THREE.Vector3 {
    // y local −0,6 ≈ 15 cm acima do chão com a suspensão em repouso.
    return out.set(side * (this.geo.half.x + 0.75), this.geo.groundOffset + 0.15, 0.3).applyQuaternion(this.currRot).add(this.currPos);
  }

  /** Coloca o carro em pé na posição/direção dada, parado. */
  reset(position: THREE.Vector3Like, yaw: number): void {
    const c = this.p;
    // Altura do chassi com a suspensão em repouso sobre o chão.
    const y = position.y + c.wheelRadius + c.suspensionRest - WHEEL_Y;
    this.currPos.set(position.x, y + 0.2, position.z);
    this.currRot.setFromAxisAngle(this.tmpV.set(0, 1, 0), yaw);
    this.body.setTranslation(this.currPos, true);
    this.body.setRotation(this.currRot, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    this.flipTimer = 0;
    this.steer = 0;
    this.prevVel.set(0, 0, 0);
    this.airTime = 0;
  }

  /** Reposiciona no lugar atual, em pé e um pouco acima (tecla R / desvirar automático). */
  resetInPlace(): void {
    const t = this.body.translation();
    this.reset({ x: t.x, y: t.y + 1, z: t.z }, this.headingFromBody());
  }

  /** Passo fixo: aplica controles. Deve ser chamado antes de physics.step(). */
  fixedUpdate(dt: number, ctl: CarControls): void {
    const c = this.p;
    const v = this.vehicle;
    const speed = v.currentVehicleSpeed();
    const absSpeed = Math.abs(speed);

    // Turbo: só com acelerador; precisa de um mínimo de carga para começar.
    const wantsTurbo = ctl.turbo && ctl.throttle > 0;
    if (!wantsTurbo || this.turbo <= 0) this.turboActive = false;
    else if (!this.turboActive && this.turbo >= c.turbo.minToStart) this.turboActive = true;
    const m = this.mods;
    this.turbo = clamp(this.turbo + (this.turboActive ? -c.turbo.drainPerSec : c.turbo.rechargePerSec * m.turboRecharge) * dt, 0, 1);
    const forceMul = (this.turboActive ? c.turbo.forceMul * m.turboForce : 1) * m.engine;
    const maxSpeed = c.maxSpeed * m.speed * (this.turboActive ? c.turbo.maxSpeedMul : 1) * (this.offroad ? c.offroad.maxSpeedMul : 1);
    // Aderência muda suavemente ao sair/entrar no asfalto (pneus da Oficina incluídos).
    this.gripMul += ((this.offroad ? c.offroad.grip : 1) * this.weatherGrip * m.grip - this.gripMul) * damp(6, dt);

    // Motor/freio. Acelerar contra o movimento freia primeiro; parado, troca de sentido.
    let engine = 0;
    let brake = 0;
    if (ctl.throttle > 0) {
      if (speed < -0.5) brake = c.brakeForce;
      else engine = ctl.throttle * c.engineForce * forceMul * speedLimiter(speed, maxSpeed);
    } else if (ctl.throttle < 0) {
      if (speed > 0.5) brake = c.brakeForce;
      else engine = ctl.throttle * c.engineForce * c.reverseForceFactor * speedLimiter(-speed, c.reverseMaxSpeed);
    } else {
      brake = c.rollingBrake;
    }
    this.braking = brake > c.rollingBrake || (ctl.handbrake && absSpeed > 1);
    this.reversing = ctl.throttle < 0 && speed < 0.5;

    // Esterço suavizado e reduzido com a velocidade (cai rápido: em alta, curvas abertas e estáveis).
    const falloff = absSpeed / c.steerFalloffSpeed;
    const maxSteer = Math.max(c.steerAtMaxSpeed, c.maxSteer / (1 + falloff * falloff));
    this.steer += (ctl.steer * maxSteer - this.steer) * damp(c.steerSpeed, dt);

    // Freio de mão: trava as traseiras e solta a aderência lateral delas (drift).
    const targetGrip = ctl.handbrake ? c.driftRearSideFriction : c.sideFriction;
    this.rearGrip += (targetGrip - this.rearGrip) * damp(ctl.handbrake ? 20 : c.gripRecovery, dt);

    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      v.setWheelFrictionSlip(i, c.frictionSlip * this.gripMul);
      if (front) v.setWheelSideFrictionStiffness(i, c.sideFriction * this.gripMul);
      v.setWheelSteering(i, front ? this.steer : 0);
      v.setWheelEngineForce(i, front || !ctl.handbrake ? engine : 0);
      v.setWheelBrake(i, !front && ctl.handbrake ? c.handbrakeForce : brake);
      if (!front) v.setWheelSideFrictionStiffness(i, this.rearGrip * this.gripMul);
    }
    // Rodas ignoram sensores e o colisor sólido dos props (o carro os derruba).
    v.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, COLLISION.car);

    const grounded = this.wheelsOnGround;
    this.handbrake = ctl.handbrake;
    // Derrapagem: componente lateral da velocidade em relação à frente do carro.
    {
      const lv = this.body.linvel();
      const yaw = this.headingFromBody();
      const lateral = Math.abs(lv.x * Math.cos(yaw) - lv.z * Math.sin(yaw));
      const locked = ctl.handbrake && absSpeed > 6 ? 0.5 : 0;
      this.slip = grounded >= 2 ? clamp(Math.max((lateral - 2.5) / 7, locked), 0, 1) : 0;
    }
    const rot = this.body.rotation();
    const up = this.tmpV.set(0, 1, 0).applyQuaternion(this.tmpQ.set(rot.x, rot.y, rot.z, rot.w));
    const upX = up.x;
    const upY = up.y;
    const upZ = up.z;

    if (grounded >= 2) {
      // Arrasto fora do asfalto e "esfregar" dos pneus em curva fechada (só sem freio de mão).
      const lv = this.body.linvel();
      const planar = Math.hypot(lv.x, lv.z);
      if (planar > 0.5) {
        const decel = (this.offroad ? c.offroad.drag : 0) + (ctl.handbrake ? 0 : c.cornerDrag * Math.abs(ctl.steer) * planar);
        const k = (-Math.min(decel * dt, planar) * c.mass) / planar;
        this.body.applyImpulse({ x: lv.x * k, y: 0, z: lv.z * k }, true);
      }
      // Downforce ao longo do "baixo" do carro.
      const f = c.downforce * speed * speed * dt;
      this.body.applyImpulse({ x: -upX * f, y: -upY * f, z: -upZ * f }, true);
      // Drift: o esterço define o ângulo de deriva desejado e um torque limitado leva o carro até ele.
      // Assim o drift é fácil de iniciar, mas o carro não roda sozinho.
      if (ctl.handbrake && speed > 4) {
        const lv = this.body.linvel();
        const slip = wrapAngle(this.headingFromBody() - Math.atan2(lv.x, lv.z));
        const desiredRate = c.driftSlipGain * (ctl.steer * c.driftMaxAngle - slip);
        const accel = clamp((desiredRate - this.body.angvel().y) * 8, -c.driftYawAssist, c.driftYawAssist);
        this.body.applyTorqueImpulse({ x: 0, y: accel * this.inertia.y * dt, z: 0 }, true);
        // Acelerando no drift: empurra na direção do movimento para não perder tanta velocidade.
        const planar = Math.hypot(lv.x, lv.z);
        if (ctl.throttle > 0 && planar < maxSpeed * 0.9) {
          const k = (c.driftSpeedAssist * c.mass * dt) / planar;
          this.body.applyImpulse({ x: lv.x * k, y: 0, z: lv.z * k }, true);
        }
      }
    } else if (grounded === 0) {
      // Controle no ar: A/D gira em torno do eixo vertical do mundo; W/S inclina o nariz.
      const yawK = ctl.steer * c.airControl * this.inertia.y * dt;
      const right = this.tmpV.set(-1, 0, 0).applyQuaternion(this.tmpQ);
      const pitchK = -ctl.throttle * c.airControl * this.inertia.x * dt * 0.6;
      this.body.applyTorqueImpulse(
        { x: right.x * pitchK, y: yawK + right.y * pitchK, z: right.z * pitchK },
        true,
      );
    }

    // Capotado (ou de lado) e quase parado por um tempo: desvira sozinho.
    if (upY < 0.35 && this.body.linvel().y < 1 && grounded < 2) {
      this.flipTimer += dt;
      if (this.flipTimer >= c.flipResetDelay) this.resetInPlace();
    } else {
      this.flipTimer = 0;
    }
  }

  /** Depois de physics.step(): guarda a transformação para interpolar. */
  postStep(): void {
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currRot.set(r.x, r.y, r.z, r.w);

    // Batidas: mudança brusca da velocidade horizontal num único passo (frear/acelerar não passa de ~0,2 m/s).
    const v = this.body.linvel();
    const dv = Math.hypot(v.x - this.prevVel.x, v.z - this.prevVel.z);
    if (dv > 1.5) {
      // O obstáculo está do lado oposto à variação de velocidade; leva para o espaço do carro.
      const localDir = new THREE.Vector3(-(v.x - this.prevVel.x), 0, -(v.z - this.prevVel.z)).applyQuaternion(this.currRot.clone().invert());
      this.events.push({ type: 'impact', strength: dv, localDir });
    }
    this.prevVel.set(v.x, v.y, v.z);
    // Pouso depois de um tempo no ar.
    const onGround = this.wheelsOnGround > 0;
    if (!onGround) this.airTime += this.cfg.physics.fixedStep;
    else {
      if (this.airTime > 0.35) this.events.push({ type: 'land', airTime: this.airTime });
      this.airTime = 0;
    }
    // Caiu para fora do mapa.
    if (t.y < -30) this.resetInPlace();
  }

  /** Por frame: interpola a carroceria e posiciona as rodas. */
  update(alpha: number): void {
    this.model.setLights(this.braking, this.reversing);
    const root = this.model.root;
    root.position.lerpVectors(this.prevPos, this.currPos, alpha);
    root.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);

    const v = this.vehicle;
    for (let i = 0; i < 4; i++) {
      const [x, z] = this.geo.wheels[i];
      const susp = v.wheelSuspensionLength(i) ?? this.p.suspensionRest;
      this.model.wheels[i].position.set(x, WHEEL_Y - susp, z);
      this.model.wheels[i].rotation.y = v.wheelSteering(i) ?? 0;
      this.model.wheelSpins[i].rotation.x = v.wheelRotation(i) ?? 0;
    }
  }

  /** Derrubou um prop: perde parte da velocidade (sem a parada seca de uma parede). */
  knockedProp(speedKeep: number): void {
    const v = this.body.linvel();
    this.body.setLinvel({ x: v.x * speedKeep, y: v.y, z: v.z * speedKeep }, true);
    this.prevVel.set(v.x * speedKeep, v.y, v.z * speedKeep); // não conta como batida
  }

  /** Retorna e limpa os eventos acumulados desde a última chamada. */
  drainEvents(): CarEvent[] {
    return this.events.splice(0);
  }

  dispose(): void {
    this.physics.removeVehicleController(this.vehicle);
    this.physics.removeRigidBody(this.body);
    this.model.root.removeFromParent();
  }

  private headingFromBody(): number {
    const r = this.body.rotation();
    const f = this.tmpV.set(0, 0, 1).applyQuaternion(this.tmpQ.set(r.x, r.y, r.z, r.w));
    return Math.atan2(f.x, f.z);
  }
}

/** Força total até ~80% da velocidade máxima, caindo a zero nela (aceleração arcade forte). */
function speedLimiter(speed: number, max: number): number {
  return clamp((max - speed) / (0.2 * max), 0, 1);
}
