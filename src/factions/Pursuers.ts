// Perseguidores das facções: carros da frota (versões leves), pintados de vermelho ou amarelo, com uma
// bandeira no teto. Ficam num pool criado no carregamento (sem criar corpos/materiais no meio do jogo) e
// entram em cena fora da vista do jogador, quando a polarização pede.
//
// IA: longe, segue as ruas (RoadGraph, A*), reduzindo nas curvas; perto, larga a rota e vai direto no
// carro oficial (com drift e turbo) e joga tomates. Preso, dá ré. Desiste se for despistado, se cair no
// lago ou se ficar preso demais.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { AudioSystem } from '../audio/AudioSystem';
import type { Config } from '../config';
import { clamp, wrapAngle } from '../core/math';
import { FACTION_IDS, FACTIONS, PURSUER_MODELS, PURSUIT as P, type FactionId } from '../data/factions';
import { FLEET, type VehicleDef } from '../data/vehicles';
import { Car, type CarControls } from '../vehicle/Car';
import type { CarEffects } from '../vehicle/CarEffects';
import type { CarAsset } from '../vehicle/CarVisual';
import { factionFlagMaterial, flagMaterial } from '../world/city/materials';
import { t } from '../core/i18n';
import { PRESS } from '../data/banker';
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

/** Onde os carros fora de cena ficam (corpo desligado). */
const PARK = { x: 0, y: -400, z: 0 };

class Pursuer {
  side: PursuerSide | null = null;
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
  private readonly events: PursuitEvent[] = [];

  constructor(
    private readonly physics: RAPIER.World,
    cfg: Config,
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

  get count(): number {
    return this.pool.filter((p) => p.side).length;
  }

  /** Facções com algum perseguidor em cena (a polarização delas não esfria durante a perseguição). */
  chasing(f: FactionId): boolean {
    return this.pool.some((p) => p.side === f && !p.leaving);
  }

  /** Imprensa em cena. */
  get pressCount(): number {
    return this.pool.filter((p) => p.side === 'imprensa').length;
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

  /** Para o minimapa. */
  actors(): { x: number; z: number; yaw: number; color: string }[] {
    return this.pool.filter((p) => p.side).map((p) => ({ x: p.car.position.x, z: p.car.position.z, yaw: p.car.heading, color: p.side === 'imprensa' ? PRESS.css : FACTIONS[p.side!].css }));
  }

  /**
   * Por frame, antes da física: decide quem entra/sai e define os controles de cada carro.
   * Retorna o que aconteceu (para avisos, falas e polarização).
   */
  think(dt: number, player: Car, polar: Polarization, camera: THREE.Camera, maxActive: number, pressWanted = 0): PursuitEvent[] {
    this.events.length = 0;
    this.tmpM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.tmpM);

    // Quantos de cada facção (os mais "quentes" primeiro, até o limite total).
    const wanted = Object.fromEntries(FACTION_IDS.map((f) => [f, polar.wanted(f)])) as Record<FactionId, number>;
    const order = [...FACTION_IDS].sort((a, b) => polar.heat[b] - polar.heat[a]);
    // A imprensa tem prioridade nas vagas (a matéria é mais perigosa que o tomate).
    const press = Math.min(pressWanted, maxActive);
    let room = maxActive - press;
    for (const f of order) {
      wanted[f] = Math.min(wanted[f], room);
      room -= wanted[f];
    }
    const have = (f: PursuerSide) => this.pool.filter((p) => p.side === f && !p.leaving).length;
    const target: Record<PursuerSide, number> = { ...wanted, imprensa: press };
    // A facção esfriou (ou a suspeição baixou): os que sobram param de perseguir e saem de cena.
    for (const f of [...FACTION_IDS, 'imprensa'] as PursuerSide[]) {
      let extra = have(f) - target[f];
      for (const p of this.pool) {
        if (extra <= 0) break;
        if (p.side !== f || p.leaving) continue;
        p.leaving = 0.001;
        extra--;
      }
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const f = have('imprensa') < press ? 'imprensa' : order.find((id) => have(id) < wanted[id]);
      const free = this.pool.find((p) => !p.side);
      if (f && free && this.spawn(free, f, player)) this.spawnTimer = P.spawnInterval;
    }

    for (const p of this.pool) if (p.side) this.drive(p, dt, player);
    this.updateTomatoes(dt, player);
    return this.events;
  }

  fixedUpdate(step: number): void {
    for (const p of this.pool) if (p.side) p.car.fixedUpdate(step, p.controls);
  }

  postStep(): void {
    for (const p of this.pool) if (p.side) p.car.postStep();
  }

  update(alpha: number): void {
    for (const p of this.pool) if (p.side) p.car.update(alpha);
  }

  /** Tira todos de cena (ex.: imunidade da garagem). */
  clear(): void {
    for (const p of this.pool) if (p.side) this.despawn(p);
  }

  dispose(): void {
    for (const p of this.pool) p.car.dispose();
    for (const m of this.tomatoPool) m.removeFromParent();
  }

  // -------------------------------------------------------------------------

  private spawn(p: Pursuer, f: PursuerSide, player: Car): boolean {
    const target = player.position;
    const spot = this.spawnSpot(target);
    if (!spot) return false;
    const c = p.car;
    c.model.setPaint(f === 'imprensa' ? PRESS.color : FACTIONS[f].color);
    c.model.setDirt(0);
    c.model.repair();
    p.flag.material = this.flagMats[f];
    const y = this.world.level?.heightAt?.(spot.x, spot.z) ?? 0;
    c.reset({ x: spot.x, y, z: spot.z }, Math.atan2(target.x - spot.x, target.z - spot.z));
    c.body.setEnabled(true);
    c.model.root.visible = true;
    Object.assign(p, { side: f, path: [], idx: 0, replan: 0, stuck: 0, reverse: 0, stuckCount: 0, lose: 0, leaving: 0, touching: false });
    p.tomato = P.tomatoInterval;
    p.photo = PRESS.photoInterval;
    p.horn = 1;
    this.events.push({ type: 'spawn', faction: f });
    return true;
  }

  /** Nó de rua a uma distância razoável, de preferência fora da vista e longe dos outros perseguidores. */
  private spawnSpot(target: THREE.Vector3): { x: number; z: number } | null {
    const others = this.pool.filter((p) => p.side).map((p) => p.car.position);
    const candidates = (this.graph?.nodes ?? []).filter((n) => {
      const d = Math.hypot(n.x - target.x, n.z - target.z);
      if (d < P.spawnMin || d > P.spawnMax || n.edges.length === 0) return false;
      if (others.some((o) => Math.hypot(o.x - n.x, o.z - n.z) < 30)) return false;
      return !this.inWater(n.x, n.z);
    });
    const unseen = candidates.filter((n) => !this.visible(n.x, (this.world.level?.heightAt?.(n.x, n.z) ?? 0) + 1, n.z));
    const pick = unseen.length ? unseen : candidates;
    if (pick.length) return pick[Math.floor(Math.random() * pick.length)];
    if (this.graph) return null;
    // Sem ruas (arena de teste): num círculo em volta do jogador.
    const a = Math.random() * Math.PI * 2;
    return { x: target.x + Math.cos(a) * P.spawnMin, z: target.z + Math.sin(a) * P.spawnMin };
  }

  private despawn(p: Pursuer): void {
    p.side = null;
    p.flash.visible = false;
    p.car.body.setEnabled(false);
    p.car.reset(PARK, 0);
    p.car.model.root.visible = false;
    p.path = [];
  }

  private drive(p: Pursuer, dt: number, player: Car): void {
    const c = p.car;
    const ctl = p.controls;
    const pos = c.position;
    const f = p.side!;
    const tp = player.position;
    const pv = player.body.linvel();
    const d = Math.hypot(tp.x - pos.x, tp.z - pos.z);

    // Saídas de cena.
    p.lose = d > P.loseDistance ? p.lose + dt : 0;
    if (p.lose > P.loseTime) {
      this.events.push({ type: 'escape', faction: f });
      this.despawn(p);
      this.spawnTimer = Math.max(this.spawnTimer, P.escapeBreather);
      return;
    }
    if (this.inWater(pos.x, pos.z) && pos.y < (this.world.level?.water[0]?.level ?? -1) + 0.3) return this.despawn(p);
    if (p.leaving > 0) {
      p.leaving += dt;
      Object.assign(ctl, { throttle: 0, steer: 0, handbrake: true, turbo: false });
      if (p.leaving > 4 || !this.visible(pos.x, pos.y, pos.z) || d > 120) this.despawn(p);
      return;
    }

    // Piso (grama x asfalto), poucas vezes por segundo.
    if ((p.surface -= dt) <= 0) {
      p.surface = 0.3;
      c.offroad = this.world.surfaceAt(pos) === 'grass';
    }

    // Batida no carro oficial.
    let touching = false;
    this.physics.contactPair(player.body.collider(0), c.body.collider(0), (m) => {
      if (m.numContacts() > 0) touching = true;
    });
    if (touching && !p.touching && f !== 'imprensa') {
      const v = c.body.linvel();
      if (Math.hypot(v.x - pv.x, v.z - pv.z) > 5) this.events.push({ type: 'ram', faction: f });
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
      // Imprensa: segue de perto sem bater (acompanha a velocidade do carro oficial).
      const gap = d - PRESS.followDistance;
      want = Math.max(0, Math.hypot(pv.x, pv.z) + gap * 0.6);
    } else if (attack) {
      const lead = clamp(d / 25, 0, 1) * 0.6; // mira um pouco à frente do carro oficial
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
          if (!this.visible(pos.x, pos.y, pos.z)) return this.despawn(p);
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
        this.audio.play('horn', { position: pos, rate: 0.85 + Math.random() * 0.35 });
      }
      if ((p.tomato -= dt) <= 0 && d < P.tomatoRange) {
        p.tomato = P.tomatoInterval * (0.8 + Math.random() * 0.4);
        this.throwTomato(p, player);
      }
    }
  }

  /** Imprensa: fotos em intervalos quando está perto, com o flash piscando. */
  private pressCamera(p: Pursuer, dt: number, d: number): void {
    p.flashTime -= dt;
    p.flash.visible = p.flashTime > 0;
    if ((p.photo -= dt) > 0 || d > PRESS.photoRange) return;
    p.photo = PRESS.photoInterval * (0.8 + Math.random() * 0.4);
    p.flashTime = 0.09;
    p.flash.visible = true;
    this.audio.play('uiClick', { position: p.car.position, rate: 0.6, volume: 1.4 });
    this.events.push({ type: 'photo', faction: 'imprensa' });
  }

  /** Rota até onde o carro oficial deve estar daqui a pouco. */
  private plan(p: Pursuer, tp: THREE.Vector3, pv: RAPIER.Vector): void {
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

  private throwTomato(p: Pursuer, player: Car): void {
    const mesh = this.tomatoPool.find((m) => !m.visible);
    if (!mesh) return;
    const from = p.car.position.clone().setY(p.car.position.y + 1.8);
    const d = from.distanceTo(player.position);
    const duration = clamp(d / 18, 0.45, 1.2);
    const v = player.body.linvel();
    const to = player.position.clone().add(this.tmpV.set(v.x, 0, v.z).multiplyScalar(duration * 0.8)).setY(player.position.y + 1.1);
    mesh.visible = true;
    mesh.position.copy(from);
    this.tomatoes.push({ mesh, from, to, t: 0, duration, faction: p.side as FactionId });
  }

  private updateTomatoes(dt: number, player: Car): void {
    for (let i = this.tomatoes.length - 1; i >= 0; i--) {
      const tm = this.tomatoes[i];
      tm.t += dt / tm.duration;
      const k = Math.min(1, tm.t);
      tm.mesh.position.lerpVectors(tm.from, tm.to, k);
      tm.mesh.position.y += 4 * k * (1 - k) * 2.2; // arco
      if (k < 1) continue;
      // Chegou: acertou se o carro oficial ainda está perto do ponto mirado.
      const hit = tm.to.distanceTo(player.position) < 3;
      const at = hit ? player.position.clone().setY(player.position.y + 1.2) : tm.mesh.position;
      this.effects.burst(at, 0xc81414, hit ? 18 : 10);
      this.audio.play('impactLight', { position: at, rate: 1.7, volume: 0.7 });
      if (hit) {
        player.dirt = Math.min(1, player.dirt + 0.04);
        this.events.push({ type: 'tomato', faction: tm.faction });
      }
      tm.mesh.visible = false;
      this.tomatoes.splice(i, 1);
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
