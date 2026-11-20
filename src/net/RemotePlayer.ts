// Outro jogador do multiplayer: o carro dele (visual + corpo cinemático, para o nosso carro bater nele)
// ou, a pé, um marcador simples; e o apelido flutuando em cima.
//
// Os estados chegam ~20x por segundo com atraso variável. O carro é desenhado um pouco no passado
// (interpDelay) e interpolado entre os dois estados em volta desse instante: o movimento fica liso
// mesmo com a internet oscilando. Se os pacotes atrasarem, projeta para frente por um instante.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Config } from '../config';
import { COLLISION } from '../core/collisionGroups';
import { FLEET, vehicleParams, type VehicleDef } from '../data/vehicles';
import { WHEEL_Y } from '../vehicle/Car';
import { createCarModelFromAsset, type CarAsset, type CarModel } from '../vehicle/CarVisual';
import { FLAG, type PlayerState } from './protocol';
import { SnapshotBuffer, TELEPORT_DISTANCE } from './SnapshotBuffer';

export const REMOTE_COLOR = '#4fd1ff';

/** Apelido some de longe. */
const NAME_DISTANCE = 300;

export interface RemoteAssets {
  carAsset(def: VehicleDef): CarAsset | null;
  environment: THREE.Texture | null;
  /** Lanternas/faróis acendem à noite (env/Atmosphere). */
  addLights(root: THREE.Object3D): void;
  removeLights(root: THREE.Object3D): void;
}

export class RemotePlayer {
  name: string;
  private readonly buffer = new SnapshotBuffer<PlayerState>();
  private vehicleIndex = -1;
  private def: VehicleDef | null = null;
  private model: CarModel | null = null;
  private body: RAPIER.RigidBody | null = null;
  private wheelY = 0;
  private wheelRadius = 0.35;
  private wheelSpin = 0;
  private readonly pedestrian: THREE.Mesh;
  private readonly tag: THREE.Sprite;
  private onFoot = false;
  private visible = false;
  private hasPose = false;
  private readonly pos = new THREE.Vector3();
  private readonly rot = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly lastBodyPos = new THREE.Vector3();
  private current: PlayerState | null = null;

  constructor(
    readonly id: number,
    name: string,
    private readonly scene: THREE.Scene,
    private readonly physics: RAPIER.World,
    private readonly cfg: Config,
    private readonly assets: RemoteAssets,
  ) {
    this.name = name;
    this.pedestrian = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 1.1, 4, 10),
      new THREE.MeshStandardMaterial({ color: REMOTE_COLOR, roughness: 0.6 }),
    );
    this.pedestrian.castShadow = true;
    this.pedestrian.visible = false;
    scene.add(this.pedestrian);
    this.tag = makeNameTag(name);
    this.tag.visible = false;
    scene.add(this.tag);
  }

  setName(name: string): void {
    if (name === this.name) return;
    this.name = name;
    const old = this.tag.material.map;
    this.tag.material.map = makeNameTexture(name);
    this.tag.material.needsUpdate = true;
    old?.dispose();
  }

  /** Estado recebido agora (`now` em segundos). */
  push(state: PlayerState, now: number): void {
    this.buffer.push(state, now);
    if (state.vehicle !== this.vehicleIndex) this.setVehicle(state.vehicle);
  }

  /** Para o minimapa (null antes do primeiro estado). */
  get actor(): { x: number; z: number; yaw: number; color: string } | null {
    if (!this.hasPose) return null;
    const f = this.tmpV.set(0, 0, 1).applyQuaternion(this.rot);
    return { x: this.pos.x, z: this.pos.z, yaw: Math.atan2(f.x, f.z), color: REMOTE_COLOR };
  }

  /** Por frame: calcula a pose no instante `now − interpDelay` e posiciona tudo. */
  update(now: number, dt: number, camera: THREE.Camera): void {
    const s = this.buffer.sample(now - this.cfg.multiplayer.interpDelay, this.pos, this.rot, this.cfg.multiplayer.maxExtrapolation, (st) => (st.flags & FLAG.ON_FOOT) === 0);
    if (!s) return;
    this.current = s;
    this.hasPose = true;
    this.setOnFoot((s.flags & FLAG.ON_FOOT) !== 0);
    this.setVisible(true);

    if (this.onFoot) {
      this.pedestrian.position.set(this.pos.x, this.pos.y + 0.85, this.pos.z);
    } else if (this.model) {
      const root = this.model.root;
      root.position.copy(this.pos);
      root.quaternion.copy(this.rot);
      this.wheelSpin += (s.speed / this.wheelRadius) * dt;
      const geo = this.model.wheels;
      for (let i = 0; i < geo.length; i++) {
        this.model.wheels[i].rotation.y = i < 2 ? s.steer : 0;
        this.model.wheelSpins[i].rotation.x = this.wheelSpin;
      }
      this.model.setLights((s.flags & FLAG.BRAKE) !== 0, (s.flags & FLAG.REVERSE) !== 0);
    }

    const tagY = this.onFoot ? 2.3 : 1.9;
    this.tag.position.set(this.pos.x, this.pos.y + tagY, this.pos.z);
    this.tag.visible = camera.position.distanceTo(this.pos) < NAME_DISTANCE;
  }

  /**
   * Antes da física: leva o corpo cinemático até a pose atual (o nosso carro bate nele como num
   * carro em movimento). Saltos grandes teleportam, para não arremessar quem estiver perto.
   */
  beforePhysics(): void {
    const body = this.body;
    if (!body || !this.hasPose) return;
    const active = !this.onFoot && this.visible;
    if (body.isEnabled() !== active) body.setEnabled(active);
    if (!active) return;
    if (this.lastBodyPos.distanceTo(this.pos) > TELEPORT_DISTANCE) {
      body.setTranslation(this.pos, true);
      body.setRotation(this.rot, true);
    } else {
      body.setNextKinematicTranslation(this.pos);
      body.setNextKinematicRotation(this.rot);
    }
    this.lastBodyPos.copy(this.pos);
  }

  /**
   * Para a IA dos perseguidores no anfitrião: posição mais nova (sem o atraso de desenho, projetada até
   * agora), velocidade e o colisor do carro (null a pé).
   */
  targetInfo(now: number, pos: THREE.Vector3, vel: { x: number; y: number; z: number }): RAPIER.Collider | null {
    const s = this.buffer.latest;
    if (!s) return null;
    this.buffer.velocity(vel);
    const ahead = Math.min(Math.max(0, now - this.buffer.latestTime), this.cfg.multiplayer.maxExtrapolation);
    pos.set(s.x + vel.x * ahead, s.y + vel.y * ahead, s.z + vel.z * ahead);
    return (s.flags & FLAG.ON_FOOT) === 0 && this.body?.isEnabled() ? this.body.collider(0) : null;
  }

  get hasState(): boolean {
    return !this.buffer.empty;
  }

  /** Corpo físico do carro remoto (para saber em quem batemos). */
  get rigidBody(): RAPIER.RigidBody | null {
    return this.body;
  }

  get state(): PlayerState | null {
    return this.current;
  }

  dispose(): void {
    this.removeCar();
    this.pedestrian.removeFromParent();
    this.pedestrian.geometry.dispose();
    (this.pedestrian.material as THREE.Material).dispose();
    this.tag.removeFromParent();
    this.tag.material.map?.dispose();
    this.tag.material.dispose();
  }

  private setVehicle(index: number): void {
    this.vehicleIndex = index;
    const def = FLEET[index] ?? FLEET[0];
    if (def === this.def && this.model) return;
    this.removeCar();
    this.def = def;
    const asset = this.assets.carAsset(def);
    if (!asset) return;
    const model = createCarModelFromAsset(asset, def.paint, false);
    if (this.assets.environment) model.setEnvironment(this.assets.environment);
    const p = vehicleParams(this.cfg.car, def, asset.geometry.wheelRadius);
    this.wheelRadius = p.wheelRadius;
    this.wheelY = WHEEL_Y - p.suspensionRest;
    asset.geometry.wheels.forEach(([x, z], i) => model.wheels[i]?.position.set(x, this.wheelY, z));
    model.root.visible = this.visible && !this.onFoot;
    this.scene.add(model.root);
    this.assets.addLights(model.root);
    this.model = model;

    const g = asset.geometry;
    const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y, this.pos.z));
    this.physics.createCollider(RAPIER.ColliderDesc.cuboid(g.half.x, g.half.y, g.half.z).setFriction(0.4).setCollisionGroups(COLLISION.car), body);
    this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(g.cabin.x, g.cabin.y, g.cabin.z).setTranslation(0, g.cabin.cy, g.cabin.cz).setFriction(0.4).setCollisionGroups(COLLISION.car),
      body,
    );
    body.setEnabled(false);
    this.body = body;
    this.lastBodyPos.set(1e9, 0, 0); // primeira pose: teleporta
  }

  private removeCar(): void {
    if (this.model) {
      this.assets.removeLights(this.model.root);
      this.model.root.removeFromParent();
      this.model = null;
    }
    if (this.body) {
      this.physics.removeRigidBody(this.body);
      this.body = null;
    }
  }

  private setOnFoot(onFoot: boolean): void {
    if (onFoot === this.onFoot) return;
    this.onFoot = onFoot;
    this.applyVisibility();
  }

  private setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    if (this.model) this.model.root.visible = this.visible && !this.onFoot;
    this.pedestrian.visible = this.visible && this.onFoot;
  }
}

function makeNameTexture(name: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 64px system-ui, sans-serif';
  const w = Math.min(500, ctx.measureText(name).width + 56);
  ctx.fillStyle = 'rgba(10, 18, 30, 0.72)';
  ctx.beginPath();
  ctx.roundRect((512 - w) / 2, 16, w, 96, 30);
  ctx.fill();
  ctx.fillStyle = REMOTE_COLOR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 256, 66, 480);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeNameTag(name: string): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeNameTexture(name), depthWrite: false, transparent: true }));
  sprite.scale.set(2.8, 0.7, 1);
  sprite.renderOrder = 10;
  return sprite;
}
