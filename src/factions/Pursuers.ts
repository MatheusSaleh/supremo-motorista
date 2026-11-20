// Perseguidores das facções: carros da frota (versões leves), pintados de vermelho ou amarelo, com uma
// bandeira no teto. Ficam num pool criado no carregamento (sem criar corpos/materiais no meio do jogo) e
// entram em cena fora da vista do jogador, quando a polarização pede.
//
// IA: longe, segue as ruas (RoadGraph, A*), reduzindo nas curvas; perto, larga a rota e vai direto no
// carro do alvo (com drift e turbo) e joga tomates. Preso, dá ré. Desiste se for despistado, se cair no
// lago ou se ficar preso demais.
//
// Multiplayer: um só computador da sala (o anfitrião) roda a IA e a física de todos os perseguidores,
// cada um atrás de um alvo (o jogador que provocou). Os outros ficam no modo réplica: desenham as poses
// recebidas, com corpo cinemático (dá para bater neles). Offline, o jogo é o anfitrião de um alvo só.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { AudioSystem } from '../audio/AudioSystem';
import type { Config } from '../config';
import { clamp, wrapAngle } from '../core/math';
import { FACTION_IDS, FACTIONS, PURSUER_MODELS, PURSUIT as P, type FactionId } from '../data/factions';
import { FLEET, type VehicleDef } from '../data/vehicles';
import { Car, WHEEL_Y, type CarControls } from '../vehicle/Car';
import type { CarEffects } from '../vehicle/CarEffects';
import type { CarAsset } from '../vehicle/CarVisual';
import { factionFlagMaterial, flagMaterial } from '../world/city/materials';
import { t } from '../core/i18n';
import { PRESS } from '../data/banker';
import { PURSUER_FLAG, PURSUER_SIDES, type PursuerNetState, type PursuitEventKind, type PursuitWants } from '../net/protocol';
import { SnapshotBuffer, TELEPORT_DISTANCE } from '../net/SnapshotBuffer';
import type { RoadGraph, RoadNode } from '../world/RoadGraph';
import type { World } from '../world/World';
import type { Polarization } from './Polarization';

/** Quem dirige o carro do pool: uma facção ou a imprensa (Fase 9). */
export type PursuerSide = FactionId | 'imprensa';

export type PursuitEvent =
  | { type: 'spawn'; faction: PursuerSide }
  /** Desistiu por ter ficado longe (o jogador despistou). */
  | { type: 'escape'; faction: PursuerSide }
  /** A imprensa tirou uma foto do carro oficial. */
  | { type: 'photo'; faction: 'imprensa' }
  | { type: 'tomato'; faction: FactionId }
  /** Encostou forte no carro oficial. */
  | { type: 'ram'; faction: FactionId };

/** Id do alvo que é o jogador deste computador. Os outros alvos usam o id do jogador na sala. */
export const LOCAL_TARGET = 0;

/** Alguém que os perseguidores podem caçar. */
export interface PursuitTarget {
  id: number;
  position: THREE.Vector3;
  velocity: { x: number; y: number; z: number };
  /** Colisor do carro (batidas); null a pé ou sem corpo. */
  collider: RAPIER.Collider | null;
}

/** Evento para um alvo remoto (o anfitrião manda pela rede). */
export interface RemotePursuitEvent {
  to: number;
  kind: PursuitEventKind;
  side: PursuerSide;
}

/** Tomate em voo, para os outros clientes desenharem. */
export interface ThrownTomato {
  from: [number, number, number];
  to: [number, number, number];
  dur: number;
}

/** Onde os carros fora de cena ficam (corpo desligado). */
const PARK = { x: 0, y: -400, z: 0 };
/** Réplica: sem notícia do anfitrião por este tempo (s), some com todos (ele caiu ou saiu). */
const REPLICA_TIMEOUT = 2;

/**
 * Quantos perseguidores um jogador quer agora: a imprensa tem prioridade (a matéria é mais perigosa que o
 * tomate); depois as facções, das mais "quentes" para as mais frias, até o limite de carros.
 */
export function allocateWants(polar: Polarization, pressWanted: number, maxActive: number): PursuitWants {
  const press = Math.min(pressWanted, maxActive);
  let room = maxActive - press;
  const out: PursuitWants = { vermelhos: 0, amarelos: 0, imprensa: press };
  for (const f of [...FACTION_IDS].sort((a, b) => polar.heat[b] - polar.heat[a])) {
    out[f] = Math.min(polar.wanted(f), room);
    room -= out[f];
  }
  return out;
}

class Pursuer {
  side: PursuerSide | null = null;
  /** Id do alvo (LOCAL_TARGET = o jogador deste computador). */
  target = LOCAL_TARGET;
  readonly controls: CarControls = { throttle: 0, steer: 0, handbrake: false, turbo: false };
  path: RoadNode[] = [];
  idx = 0;
  replan = 0;
  stuck = 0;
  reverse = 0;
  stuckCount = 0;
  movingTime = 0;
  lose = 0;
  tomato = 0;
  horn = 0;
  surface = 0;
  touching = false;
  /** Sobrando (a facção esfriou): para de perseguir e sai de cena. */
  leaving = 0;
  /** Imprensa: intervalo das fotos e o brilho do flash. */
  photo = 0;
  flashTime = 0;
  /** Trocam a cada buzinada/foto: os outros clientes percebem a troca e repetem o som/flash. */
  hornToggle = false;
  photoToggle = false;
  // Réplica.
  readonly buffer = new SnapshotBuffer<PursuerNetState>();
  wheelSpin = 0;
  readonly lastBodyPos = new THREE.Vector3(1e9, 0, 0);
  hasPose = false;

  constructor(
    readonly car: Car,
    readonly flag: THREE.Mesh,
    readonly flash: THREE.Mesh,
  ) {}
}

interface Tomato {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  duration: number;
  faction: FactionId;
  /** Alvo (para conferir o acerto); null = só visual (réplica: quem decide é o anfitrião). */
  target: number | null;
}

export class Pursuers {
  private readonly pool: Pursuer[] = [];
  private readonly flagMats: Record<PursuerSide, THREE.MeshStandardMaterial>;
  private readonly tomatoes: Tomato[] = [];
  private readonly tomatoPool: THREE.Mesh[] = [];
  private spawnTimer = 2;
  private readonly frustum = new THREE.Frustum();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpRot = new THREE.Quaternion();
  private readonly events: PursuitEvent[] = [];
  /** Alvos desta rodada da IA, por id. */
  private targets = new Map<number, PursuitTarget>();
  /** Modo réplica (multiplayer, sem ser o anfitrião). */
  private replica = false;
  private lastPacket = -Infinity;
  /** Para o anfitrião mandar pela rede (esvaziados por quem lê). */
  readonly remoteEvents: RemotePursuitEvent[] = [];
  readonly thrown: ThrownTomato[] = [];

  constructor(
    private readonly physics: RAPIER.World,
    private readonly cfg: Config,
    scene: THREE.Scene,
    assets: (CarAsset | null)[],
    private readonly graph: RoadGraph | null,
    private readonly world: World,
    private readonly audio: AudioSystem,
    private readonly effects: CarEffects,
  ) {
    this.flagMats = {
      ...(Object.fromEntries(FACTION_IDS.map((f) => [f, factionFlagMaterial(f)])) as Record<FactionId, THREE.MeshStandardMaterial>),
      imprensa: flagMaterial(PRESS.color, PRESS.accent, t('press.flag')),
    };
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
    const flashGeo = new THREE.SphereGeometry(0.35, 10, 8);
    PURSUER_MODELS.forEach((id, i) => {
      const base = FLEET.find((d) => d.id === id) ?? FLEET[0];
      const def: VehicleDef = {
        ...base,
        id: `perseguidor-${i}`,
        modelInterior: false,
        boardLines: undefined,
        tipMul: undefined,
        physics: { ...base.physics, maxSpeed: (base.physics.maxSpeed ?? cfg.car.maxSpeed) * P.speedMul },
      };
      const car = new Car(physics, cfg, PARK, 0, assets[i] ?? null, def);
      car.body.setEnabled(false);
      const flag = rooftopFlag(car, this.flagMats.vermelhos);
      // Flash da câmera do fotógrafo (só a imprensa usa): esfera branca que pisca na janela do carona.
      const flash = new THREE.Mesh(flashGeo, flashMat);
      flash.position.set(-car.geo.half.x * 0.9, car.geo.cabin.cy, car.geo.half.z * 0.1);
      flash.visible = false;
      car.model.root.add(flash);
      scene.add(car.model.root);
      car.model.root.visible = false;
      this.pool.push(new Pursuer(car, flag, flash));
    });
    const geo = new THREE.SphereGeometry(0.13, 10, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd11a1a, roughness: 0.45 });
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.name = 'tomate';
      scene.add(m);
      this.tomatoPool.push(m);
    }
  }

  /** Carros ativos (em cena). */
  get active(): Car[] {
    return this.pool.filter((p) => p.side).map((p) => p.car);
  }

  /** Todos os carros do pool (para materiais/luzes do ambiente). */
  get all(): Car[] {
    return this.pool.map((p) => p.car);
  }

  /** Perseguidores atrás do jogador deste computador. */
  get count(): number {
    return this.pool.filter((p) => p.side && p.target === LOCAL_TARGET).length;
  }

  /** Facção perseguindo o jogador deste computador (a polarização dela não esfria durante a perseguição). */
  chasing(f: FactionId): boolean {
    return this.pool.some((p) => p.side === f && p.target === LOCAL_TARGET && !p.leaving);
  }

  /** Imprensa atrás do jogador deste computador. */
  get pressCount(): number {
    return this.pool.filter((p) => p.side === 'imprensa' && p.target === LOCAL_TARGET).length;
  }

  get isReplica(): boolean {
    return this.replica;
  }

  /** Carro do pool dono deste corpo (para os props derrubados). */
  carOf(body: RAPIER.RigidBody): Car | undefined {
    return this.pool.find((p) => p.car.body === body)?.car;
  }

  /** Mostra tudo durante a compilação de shaders no carregamento (sem travadas no 1º surgimento). */
  setCompileVisible(on: boolean): void {
    for (const p of this.pool) {
      p.car.model.root.visible = on || p.side !== null;
      p.flash.visible = on;
    }
    for (const m of this.tomatoPool) m.visible = on;
  }

  /** Para o minimapa (todos os perseguidores em cena, de quem quer que seja). */
  actors(): { x: number; z: number; yaw: number; color: string }[] {
    return this.pool
      .filter((p) => p.side && (!this.replica || p.hasPose))
      .map((p) => ({ x: p.car.position.x, z: p.car.position.z, yaw: p.car.heading, color: p.side === 'imprensa' ? PRESS.css : FACTIONS[p.side!].css }));
  }

  /**
   * Liga/desliga o modo réplica (multiplayer, quando outro jogador é o anfitrião). Na troca, todos saem
   * de cena: quem assume a IA recomeça do zero.
   */
  setReplica(on: boolean): void {
    if (on === this.replica) return;
    this.clear();
    this.replica = on;
    this.lastPacket = -Infinity;
    for (const p of this.pool) {
      p.car.body.setBodyType(on ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, false);
      p.car.body.setEnabled(false);
    }
  }

  /**
   * Por frame, antes da física: decide quem entra/sai e define os controles de cada carro (anfitrião), ou
   * só desenha o que chegou (réplica). `targets[0]` é o jogador deste computador. Retorna o que aconteceu
   * com ele (para avisos, falas e polarização); o que acontece com os outros fica em remoteEvents.
   */
  think(dt: number, targets: readonly { target: PursuitTarget; wants: PursuitWants }[], camera: THREE.Camera): PursuitEvent[] {
    this.events.length = 0;
    this.tmpM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.tmpM);
    this.targets = new Map(targets.map((e) => [e.target.id, e.target]));

    if (this.replica) {
      this.updateReplicas(dt);
      this.updateTomatoes(dt);
      return this.events;
    }

    const wants = new Map(targets.map((e) => [e.target.id, e.wants]));
    const have = (id: number, s: PursuerSide) => this.pool.filter((p) => p.side === s && p.target === id && !p.leaving).length;
    // Quem esfriou (ou saiu da sala) dispensa os que sobram: param de perseguir e saem de cena.
    for (const p of this.pool) {
      if (!p.side || p.leaving) continue;
      const w = wants.get(p.target);
      if (!w || !this.targets.has(p.target)) p.leaving = 0.001;
    }
    for (const [id, w] of wants) {
      for (const s of PURSUER_SIDES) {
        let extra = have(id, s) - w[s];
        for (const p of this.pool) {
          if (extra <= 0) break;
          if (p.side !== s || p.target !== id || p.leaving) continue;
          p.leaving = 0.001;
          extra--;
        }
      }
    }
    // Um surgimento por vez: para o alvo com mais falta (o deste computador desempata), imprensa primeiro.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      let best: { target: PursuitTarget; side: PursuerSide; deficit: number } | null = null;
      for (const { target, wants: w } of targets) {
        const deficit = PURSUER_SIDES.reduce((sum, s) => sum + Math.max(0, w[s] - have(target.id, s)), 0);
        if (deficit <= 0 || (best && deficit <= best.deficit)) continue;
        const side = (['imprensa', 'vermelhos', 'amarelos'] as const).find((s) => have(target.id, s) < w[s])!;
        best = { target, side, deficit };
      }
      const free = this.pool.find((p) => !p.side);
      if (best && free && this.spawn(free, best.side, best.target)) this.spawnTimer = P.spawnInterval;
    }

    for (const p of this.pool) {
      if (!p.side) continue;
      const target = this.targets.get(p.target);
      if (target) this.drive(p, dt, target);
      else this.despawn(p);
    }
    this.updateTomatoes(dt);
    return this.events;
  }

  /** Antes de cada leva de passos de física (réplica): corpos cinemáticos na pose desenhada. */
  beforePhysics(): void {
    if (!this.replica) return;
    for (const p of this.pool) {
      if (!p.side || !p.hasPose) continue;
      const body = p.car.body;
      const pos = p.car.model.root.position;
      const rot = p.car.model.root.quaternion;
      if (p.lastBodyPos.distanceTo(pos) > TELEPORT_DISTANCE) {
        body.setTranslation(pos, true);
        body.setRotation(rot, true);
      } else {
        body.setNextKinematicTranslation(pos);
        body.setNextKinematicRotation(rot);
      }
      p.lastBodyPos.copy(pos);
    }
  }

  fixedUpdate(step: number): void {
    if (this.replica) return;
    for (const p of this.pool) if (p.side) p.car.fixedUpdate(step, p.controls);
  }

  postStep(): void {
    if (this.replica) return;
    for (const p of this.pool) if (p.side) p.car.postStep();
  }

  update(alpha: number): void {
    if (this.replica) return;
    for (const p of this.pool) if (p.side) p.car.update(alpha);
  }

  /** Tira todos de cena. */
  clear(): void {
    for (const p of this.pool) if (p.side) this.despawn(p);
  }

  dispose(): void {
    for (const p of this.pool) p.car.dispose();
    for (const m of this.tomatoPool) m.removeFromParent();
  }

  /** Tira de cena os que perseguem um alvo (imunidade da garagem, novo dia). Anfitrião/offline. */
  clearTarget(id: number): void {
    if (this.replica) return;
    for (const p of this.pool) if (p.side && p.target === id) this.despawn(p);
  }

  // -------------------------------------------------------------------------
  // Rede

  /** Anfitrião: pose de todos em cena, para mandar à sala. `selfId` substitui o alvo local. */
  netStates(selfId: number): PursuerNetState[] {
    const out: PursuerNetState[] = [];
    this.pool.forEach((p, slot) => {
      if (!p.side) return;
      const c = p.car;
      const r = c.model.root;
      out.push({
        slot,
        side: p.side,
        target: p.target === LOCAL_TARGET ? selfId : p.target,
        flags:
          (c.braking ? PURSUER_FLAG.BRAKE : 0) |
          (c.reversing ? PURSUER_FLAG.REVERSE : 0) |
          (p.leaving > 0 ? PURSUER_FLAG.LEAVING : 0) |
          (p.hornToggle ? PURSUER_FLAG.HORN_TOGGLE : 0) |
          (p.photoToggle ? PURSUER_FLAG.PHOTO_TOGGLE : 0),
        x: r.position.x,
        y: r.position.y,
        z: r.position.z,
        qx: r.quaternion.x,
        qy: r.quaternion.y,
        qz: r.quaternion.z,
        qw: r.quaternion.w,
        speed: c.forwardSpeed,
        steer: c.steerAngle,
      });
    });
    return out;
  }

  /** Réplica: poses que chegaram do anfitrião (`now` em s). Quem não veio saiu de cena. */
  applyNet(states: readonly PursuerNetState[], now: number, selfId: number): void {
    if (!this.replica) return;
    this.lastPacket = now;
    const seen = new Set<number>();
    for (const s of states) {
      const p = this.pool[s.slot];
      if (!p) continue;
      seen.add(s.slot);
      if (p.side !== s.side) this.activateReplica(p, s.side);
      p.target = s.target === selfId ? LOCAL_TARGET : s.target;
      p.leaving = (s.flags & PURSUER_FLAG.LEAVING) !== 0 ? 1 : 0;
      const prev = p.buffer.latest;
      p.buffer.push(s, now);
      if (!prev) continue;
      const pos = this.tmpV.set(s.x, s.y, s.z);
      if (((s.flags ^ prev.flags) & PURSUER_FLAG.HORN_TOGGLE) !== 0) this.audio.play('horn', { position: pos, rate: 0.85 + Math.random() * 0.35 });
      if (((s.flags ^ prev.flags) & PURSUER_FLAG.PHOTO_TOGGLE) !== 0) this.photoFx(p);
    }
    this.pool.forEach((p, slot) => {
      if (p.side && !seen.has(slot)) this.despawn(p);
    });
  }

  /** Réplica: tomate jogado pelo anfitrião (só o voo e a sujeira visual; o acerto vem por evento). */
  addNetTomato(from: [number, number, number], to: [number, number, number], dur: number): void {
    const mesh = this.tomatoPool.find((m) => !m.visible);
    if (!mesh) return;
    mesh.visible = true;
    mesh.position.set(...from);
    this.tomatoes.push({ mesh, from: new THREE.Vector3(...from), to: new THREE.Vector3(...to), t: 0, duration: dur, faction: 'vermelhos', target: null });
  }

  // -------------------------------------------------------------------------

  private emit(p: Pursuer, kind: PursuitEventKind, e: PursuitEvent): void {
    if (p.target === LOCAL_TARGET) this.events.push(e);
    else this.remoteEvents.push({ to: p.target, kind, side: e.faction });
  }

  private spawn(p: Pursuer, f: PursuerSide, target: PursuitTarget): boolean {
    const tp = target.position;
    const spot = this.spawnSpot(target);
    if (!spot) return false;
    const c = p.car;
    this.dress(p, f);
    const y = this.world.level?.heightAt?.(spot.x, spot.z) ?? 0;
    c.reset({ x: spot.x, y, z: spot.z }, Math.atan2(tp.x - spot.x, tp.z - spot.z));
    c.body.setEnabled(true);
    c.model.root.visible = true;
    Object.assign(p, { side: f, target: target.id, path: [], idx: 0, replan: 0, stuck: 0, reverse: 0, stuckCount: 0, lose: 0, leaving: 0, touching: false });
    p.tomato = P.tomatoInterval;
    p.photo = PRESS.photoInterval;
    p.horn = 1;
    this.emit(p, 'spawn', { type: 'spawn', faction: f });
    return true;
  }

  /** Pintura e bandeira do lado. */
  private dress(p: Pursuer, f: PursuerSide): void {
    const c = p.car;
    c.model.setPaint(f === 'imprensa' ? PRESS.color : FACTIONS[f].color);
    c.model.setDirt(0);
    c.model.repair();
    p.flag.material = this.flagMats[f];
  }

  /**
   * Nó de rua a uma distância razoável do alvo, de preferência fora da vista e longe dos outros
   * perseguidores. "Fora da vista": a câmera deste computador para o jogador local; atrás do carro para
   * um alvo remoto (não sabemos para onde a câmera dele olha).
   */
  private spawnSpot(target: PursuitTarget): { x: number; z: number } | null {
    const tp = target.position;
    const others = this.pool.filter((p) => p.side).map((p) => p.car.position);
    const candidates = (this.graph?.nodes ?? []).filter((n) => {
      const d = Math.hypot(n.x - tp.x, n.z - tp.z);
      if (d < P.spawnMin || d > P.spawnMax || n.edges.length === 0) return false;
      if (others.some((o) => Math.hypot(o.x - n.x, o.z - n.z) < 30)) return false;
      return !this.inWater(n.x, n.z);
    });
    const v = target.velocity;
    const unseen = candidates.filter((n) =>
      target.id === LOCAL_TARGET
        ? !this.visible(n.x, (this.world.level?.heightAt?.(n.x, n.z) ?? 0) + 1, n.z)
        : (n.x - tp.x) * v.x + (n.z - tp.z) * v.z < 0,
    );
    const pick = unseen.length ? unseen : candidates;
    if (pick.length) return pick[Math.floor(Math.random() * pick.length)];
    if (this.graph) return null;
    // Sem ruas (arena de teste): num círculo em volta do alvo.
    const a = Math.random() * Math.PI * 2;
    return { x: tp.x + Math.cos(a) * P.spawnMin, z: tp.z + Math.sin(a) * P.spawnMin };
  }

  private despawn(p: Pursuer): void {
    p.side = null;
    p.flash.visible = false;
    p.car.body.setEnabled(false);
    p.car.reset(PARK, 0);
    p.car.model.root.visible = false;
    p.path = [];
    p.buffer.clear();
    p.hasPose = false;
    p.lastBodyPos.set(1e9, 0, 0);
  }

  /** Pode sumir sem ninguém ver? Jogador local: fora da câmera. Remoto: longe do carro dele. */
  private unseen(p: Pursuer, d: number): boolean {
    const pos = p.car.position;
    return p.target === LOCAL_TARGET ? !this.visible(pos.x, pos.y, pos.z) : d > 80;
  }

  private drive(p: Pursuer, dt: number, target: PursuitTarget): void {
    const c = p.car;
    const ctl = p.controls;
    const pos = c.position;
    const f = p.side!;
    const tp = target.position;
    const pv = target.velocity;
    const d = Math.hypot(tp.x - pos.x, tp.z - pos.z);

    // Saídas de cena.
    p.lose = d > P.loseDistance ? p.lose + dt : 0;
    if (p.lose > P.loseTime) {
      this.emit(p, 'escape', { type: 'escape', faction: f });
      this.despawn(p);
      this.spawnTimer = Math.max(this.spawnTimer, P.escapeBreather);
      return;
    }
    if (this.inWater(pos.x, pos.z) && pos.y < (this.world.level?.water[0]?.level ?? -1) + 0.3) return this.despawn(p);
    if (p.leaving > 0) {
      p.leaving += dt;
      Object.assign(ctl, { throttle: 0, steer: 0, handbrake: true, turbo: false });
      if (p.leaving > 4 || this.unseen(p, d) || d > 120) this.despawn(p);
      return;
    }

    // Piso (grama x asfalto), poucas vezes por segundo.
    if ((p.surface -= dt) <= 0) {
      p.surface = 0.3;
      c.offroad = this.world.surfaceAt(pos) === 'grass';
    }

    // Batida no carro do alvo.
    let touching = false;
    if (target.collider)
      this.physics.contactPair(target.collider, c.body.collider(0), (m) => {
        if (m.numContacts() > 0) touching = true;
      });
    if (touching && !p.touching && f !== 'imprensa') {
      const v = c.body.linvel();
      if (Math.hypot(v.x - pv.x, v.z - pv.z) > 5) this.emit(p, 'ram', { type: 'ram', faction: f });
    }
    p.touching = touching;
    const press = f === 'imprensa';
    if (press) this.pressCamera(p, dt, d);

    // Para onde ir.
    const attack = d < P.attackDistance || !this.graph;
    let aimX = tp.x;
    let aimZ = tp.z;
    let want = c.p.maxSpeed;
    if (attack && press) {
      // Imprensa: segue de perto sem bater (acompanha a velocidade do alvo).
      const gap = d - PRESS.followDistance;
      want = Math.max(0, Math.hypot(pv.x, pv.z) + gap * 0.6);
    } else if (attack) {
      const lead = clamp(d / 25, 0, 1) * 0.6; // mira um pouco à frente do alvo
      aimX += pv.x * lead;
      aimZ += pv.z * lead;
    } else {
      p.replan -= dt;
      if (p.replan <= 0 || p.idx >= p.path.length) this.plan(p, tp, pv);
      while (p.idx < p.path.length) {
        const n = p.path[p.idx];
        if (Math.hypot(n.x - pos.x, n.z - pos.z) < 9 + n.width / 4) p.idx++;
        else break;
      }
      const n = p.path[p.idx];
      if (n) {
        aimX = n.x;
        aimZ = n.z;
        // Curva à frente: reduz conforme o ângulo.
        const next = p.path[p.idx + 1];
        const prev = p.path[p.idx - 1] ?? { x: pos.x, z: pos.z };
        if (next && Math.hypot(n.x - pos.x, n.z - pos.z) < 45) {
          const turn = Math.abs(wrapAngle(Math.atan2(next.x - n.x, next.z - n.z) - Math.atan2(n.x - prev.x, n.z - prev.z)));
          want = c.p.maxSpeed + (9 - c.p.maxSpeed) * clamp(turn / 1.6, 0, 1);
        }
      }
    }

    const speed = c.forwardSpeed;
    const rel = wrapAngle(Math.atan2(aimX - pos.x, aimZ - pos.z) - c.heading);
    ctl.steer = clamp(rel * 2.4, -1, 1);
    if (p.reverse > 0) {
      p.reverse -= dt;
      Object.assign(ctl, { throttle: -1, steer: -ctl.steer, handbrake: false, turbo: false });
      return;
    }
    ctl.throttle = speed < want ? 1 : speed > want + 4 ? -0.6 : 0.15;
    if (Math.abs(rel) > 1.3 && speed > 9) ctl.throttle = -0.7;
    ctl.handbrake = attack && !press && Math.abs(rel) > 0.8 && speed > 13;
    ctl.turbo = attack && !press && Math.abs(rel) < 0.25 && d > 12;
    if (press && attack && d < PRESS.followDistance * 0.7) Object.assign(ctl, { throttle: -0.8, turbo: false });

    // Preso (acelerando sem sair do lugar): ré com o volante invertido. Preso demais: some ou desvira.
    if (ctl.throttle > 0 && Math.abs(speed) < 1.2) {
      p.stuck += dt;
      p.movingTime = 0;
      if (p.stuck > 1.4) {
        p.stuck = 0;
        p.reverse = 1.2;
        if (++p.stuckCount >= 4) {
          p.stuckCount = 0;
          if (this.unseen(p, d)) return this.despawn(p);
          c.resetInPlace();
        }
      }
    } else {
      p.stuck = 0;
      if ((p.movingTime += dt) > 8) p.stuckCount = 0;
    }

    // Buzinaço e tomates quando está colado (só as facções).
    if (attack && !press) {
      if ((p.horn -= dt) <= 0) {
        p.horn = 2.5 + Math.random() * 3;
        p.hornToggle = !p.hornToggle;
        this.audio.play('horn', { position: pos, rate: 0.85 + Math.random() * 0.35 });
      }
      if ((p.tomato -= dt) <= 0 && d < P.tomatoRange) {
        p.tomato = P.tomatoInterval * (0.8 + Math.random() * 0.4);
        this.throwTomato(p, target);
      }
    }
  }

  /** Imprensa: fotos em intervalos quando está perto, com o flash piscando. */
  private pressCamera(p: Pursuer, dt: number, d: number): void {
    p.flashTime -= dt;
    p.flash.visible = p.flashTime > 0;
    if ((p.photo -= dt) > 0 || d > PRESS.photoRange) return;
    p.photo = PRESS.photoInterval * (0.8 + Math.random() * 0.4);
    p.photoToggle = !p.photoToggle;
    this.photoFx(p);
    this.emit(p, 'photo', { type: 'photo', faction: 'imprensa' });
  }

  /** Flash e clique da câmera do fotógrafo. */
  private photoFx(p: Pursuer): void {
    p.flashTime = 0.09;
    p.flash.visible = true;
    this.audio.play('uiClick', { position: p.car.position, rate: 0.6, volume: 1.4 });
  }

  /** Rota até onde o alvo deve estar daqui a pouco. */
  private plan(p: Pursuer, tp: THREE.Vector3, pv: { x: number; z: number }): void {
    p.replan = 1.2;
    const g = this.graph!;
    const pos = p.car.position;
    const start = g.nearest(pos.x, pos.z);
    const goal = g.nearest(tp.x + pv.x * 2, tp.z + pv.z * 2);
    p.path = start && goal ? g.path(start, goal) : [];
    p.idx = 0;
    // Mesmo nó (alvo perto, na mesma rua): vai direto, sem rota.
    if (p.path.length <= 1) p.path = [];
    // Primeiro nó ficou para trás e perto: começa pelo seguinte (não dá meia-volta).
    const first = p.path[0];
    if (first && p.path.length > 1) {
      const behind = Math.abs(wrapAngle(Math.atan2(first.x - pos.x, first.z - pos.z) - p.car.heading)) > 1.6;
      if (behind && Math.hypot(first.x - pos.x, first.z - pos.z) < 40) p.idx = 1;
    }
  }

  private throwTomato(p: Pursuer, target: PursuitTarget): void {
    const mesh = this.tomatoPool.find((m) => !m.visible);
    if (!mesh) return;
    const from = p.car.position.clone().setY(p.car.position.y + 1.8);
    const d = from.distanceTo(target.position);
    const duration = clamp(d / 18, 0.45, 1.2);
    const v = target.velocity;
    const to = target.position.clone().add(this.tmpV.set(v.x, 0, v.z).multiplyScalar(duration * 0.8)).setY(target.position.y + 1.1);
    mesh.visible = true;
    mesh.position.copy(from);
    this.tomatoes.push({ mesh, from, to, t: 0, duration, faction: p.side as FactionId, target: target.id });
    this.thrown.push({ from: [from.x, from.y, from.z], to: [to.x, to.y, to.z], dur: duration });
  }

  private updateTomatoes(dt: number): void {
    for (let i = this.tomatoes.length - 1; i >= 0; i--) {
      const tm = this.tomatoes[i];
      tm.t += dt / tm.duration;
      const k = Math.min(1, tm.t);
      tm.mesh.position.lerpVectors(tm.from, tm.to, k);
      tm.mesh.position.y += 4 * k * (1 - k) * 2.2; // arco
      if (k < 1) continue;
      // Chegou: acertou se o alvo ainda está perto do ponto mirado (só quem roda a IA decide).
      const target = tm.target === null ? undefined : this.targets.get(tm.target);
      const hit = !!target && tm.to.distanceTo(target.position) < 3;
      const at = hit ? target.position.clone().setY(target.position.y + 1.2) : tm.mesh.position;
      this.effects.burst(at, 0xc81414, hit ? 18 : 10);
      this.audio.play('impactLight', { position: at, rate: 1.7, volume: 0.7 });
      if (hit) {
        if (tm.target === LOCAL_TARGET) this.events.push({ type: 'tomato', faction: tm.faction });
        else this.remoteEvents.push({ to: tm.target!, kind: 'tomato', side: tm.faction });
      }
      tm.mesh.visible = false;
      this.tomatoes.splice(i, 1);
    }
  }

  // -------------------------------------------------------------------------
  // Réplica

  private activateReplica(p: Pursuer, side: PursuerSide): void {
    if (p.side) this.despawn(p);
    this.dress(p, side);
    p.side = side;
    p.hasPose = false;
    p.wheelSpin = 0;
    const c = p.car;
    c.geo.wheels.forEach(([x, z], i) => c.model.wheels[i]?.position.set(x, WHEEL_Y - c.p.suspensionRest, z));
    c.body.setEnabled(true);
    c.model.root.visible = true;
  }

  /** Desenha os perseguidores na pose interpolada (um pouco no passado, como os outros jogadores). */
  private updateReplicas(dt: number): void {
    const now = performance.now() / 1000;
    if (now - this.lastPacket > REPLICA_TIMEOUT) {
      this.clear();
      return;
    }
    const mp = this.cfg.multiplayer;
    for (const p of this.pool) {
      if (!p.side) continue;
      const s = p.buffer.sample(now - mp.interpDelay, this.tmpPos, this.tmpRot, mp.maxExtrapolation);
      if (!s) continue;
      p.hasPose = true;
      const c = p.car;
      c.model.root.position.copy(this.tmpPos);
      c.model.root.quaternion.copy(this.tmpRot);
      p.wheelSpin += (s.speed / c.p.wheelRadius) * dt;
      for (let i = 0; i < c.model.wheels.length; i++) {
        c.model.wheels[i].rotation.y = i < 2 ? s.steer : 0;
        c.model.wheelSpins[i].rotation.x = p.wheelSpin;
      }
      c.model.setLights((s.flags & PURSUER_FLAG.BRAKE) !== 0, (s.flags & PURSUER_FLAG.REVERSE) !== 0);
      p.flashTime -= dt;
      p.flash.visible = p.flashTime > 0;
    }
  }

  private visible(x: number, y: number, z: number): boolean {
    return this.frustum.containsPoint(this.tmpV.set(x, y, z));
  }

  private inWater(x: number, z: number): boolean {
    return (this.world.level?.water ?? []).some((w) => x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ);
  }
}

/** Mastro com bandeira no teto (filho da raiz do carro). */
function rooftopFlag(car: Car, mat: THREE.Material): THREE.Mesh {
  const box = new THREE.Box3().setFromObject(car.model.root);
  const top = box.max.y - car.model.root.position.y;
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  pole.position.y = 0.45;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), mat);
  flag.position.set(0, 0.62, -0.4);
  flag.rotation.y = Math.PI / 2;
  g.add(pole, flag);
  g.position.set(-car.geo.half.x * 0.5, top - 0.05, -car.geo.half.z * 0.35);
  car.model.root.add(g);
  return flag;
}
