// Sistema de corridas: o Rádio do Tribunal chama, o jogador atende, busca o passageiro, leva até o
// destino dentro do tempo e recebe diária + gorjeta + bônus/penalidades. Sem DOM: o HUD lê `view`.
import * as THREE from 'three';
import type { SoundId } from '../audio/sounds';
import { t, type StringKey } from '../core/i18n';
import {
  LINE_COUNTS,
  PASSENGERS,
  PAYMENT,
  POOLS,
  RIDES,
  RIDE_TIMING as T,
  type LineTrigger,
  type Passenger,
  type RideConditions,
  type PoolId,
  type RideTemplate,
} from '../data/rides';
import type { CharacterAsset } from '../player/CharacterAsset';
import { PASSENGER_LOOKS } from '../player/outfit';
import { SeatedDriver } from '../player/SeatedDriver';
import type { Config } from '../config';
import type { Car, CarEvent } from '../vehicle/Car';
import type { AddressPoint, Level } from '../world/Level';
import { Beacon, DirectionArrow, PassengerNpc } from './RideVisuals';

export type RidePhase = 'idle' | 'offered' | 'toPickup' | 'toDropoff' | 'result';

interface ActiveRide {
  template: RideTemplate;
  passenger: Passenger;
  from: AddressPoint;
  to: AddressPoint;
  timeLimit: number;
  timeLeft: number;
  stats: { jumps: number; driftTime: number; crashes: number; props: number; lake: boolean };
}

export interface ResultLine {
  label: string;
  value: number;
}

/** O que o HUD precisa mostrar (strings já traduzidas). */
export interface RideView {
  phase: RidePhase;
  money: number;
  offer: { title: string; text: string; route: string; time: string; expiresIn: number } | null;
  ride: { title: string; address: string; distance: number; timeLeft: number | null; hint: string | null; urgent: boolean } | null;
  result: { title: string; lines: ResultLine[]; total: number; late: boolean } | null;
  bubble: string | null;
  /** Alvo atual (minimapa). */
  target: { x: number; z: number; kind: 'pickup' | 'dropoff' } | null;
}

/** Entrada por frame (vinda do Game). */
export interface RideFrame {
  dt: number;
  driving: boolean;
  carPos: THREE.Vector3Like;
  kmh: number;
  slip: number;
  carEvents: readonly CarEvent[];
  propsBroken: number;
  splashed: boolean;
  /** Onde a seta 3D deve ficar e em que escala (carro, cockpit ou a pé). */
  arrowAnchor: THREE.Vector3;
  arrowScale: number;
}

export interface RideHooks {
  sound(id: SoundId): void;
  toast(text: string): void;
}

const COLORS = { pickup: 0xffd34d, dropoff: 0x3ddc84 };

export class RideManager {
  money = 0;
  phase: RidePhase = 'idle';
  private ride: ActiveRide | null = null;
  private timer = T.firstCallDelay; // tempo até o próximo chamado / validade do chamado / exibição do resultado
  private everDrove = false;
  private stopTime = 0;
  private result: RideView['result'] = null;

  // Falas.
  private bubble: { text: string; ttl: number } | null = null;
  private lineCooldown = 0;
  private idleTimer = 20;
  private driftRun = 0;
  private fastRun = 0;
  private slowRun = 0;
  private hurried = false;

  private readonly beacon: Beacon;
  private readonly arrow = new DirectionArrow();
  private readonly npc: PassengerNpc | null;
  private readonly rearPassenger: SeatedDriver | null;
  private vehicle: Car | null = null;
  private conditions: RideConditions = { holiday: false, holidayEve: false, rain: false, dry: false, night: false };

  constructor(
    private readonly level: Level,
    scene: THREE.Scene,
    rearSeat: THREE.Object3D,
    character: CharacterAsset | null,
    cfg: Config,
    private readonly hooks: RideHooks,
  ) {
    this.beacon = new Beacon(COLORS.pickup, T.pickupRadius);
    scene.add(this.beacon.root, this.arrow.root);
    this.npc = character ? new PassengerNpc(character, 'Wave') : null;
    if (this.npc) scene.add(this.npc.root);
    this.rearPassenger = character ? new SeatedDriver(character, cfg) : null;
    if (this.rearPassenger) rearSeat.add(this.rearPassenger.root);
  }

  /** Carro atual (frota): o passageiro a bordo muda junto; gorjeta e falas dependem do modelo. */
  setVehicle(car: Car): void {
    this.vehicle = car;
    if (this.rearPassenger) car.model.rearSeat.add(this.rearPassenger.root);
  }

  /** Clima/horário/feriado reais (Game atualiza a cada frame; vale para as próximas corridas e falas). */
  setConditions(c: RideConditions): void {
    this.conditions = c;
  }

  /** Atende o chamado do rádio (Enter / toque no painel). */
  accept(): void {
    if (this.phase !== 'offered' || !this.ride) return;
    this.phase = 'toPickup';
    const { from } = this.ride;
    this.beacon.setRadius(T.pickupRadius);
    this.beacon.place(from.x, this.groundAt(from), from.z, COLORS.pickup);
    // Passageiro de frente para o centro do mapa (≈ lado da rua na maioria dos endereços).
    const look = PASSENGER_LOOKS[Math.floor(Math.random() * PASSENGER_LOOKS.length)];
    this.npc?.setLook(look);
    this.rearPassenger?.setLook(look);
    this.npc?.place(from.x, this.groundAt(from), from.z, from.x * 0.98, from.z * 0.98);
    this.hooks.sound('uiConfirm');
  }

  update(f: RideFrame): void {
    if (f.driving) this.everDrove = true;
    this.lineCooldown -= f.dt;
    if (this.bubble && (this.bubble.ttl -= f.dt) <= 0) this.bubble = null;
    this.npc?.update(f.dt);
    this.beacon.update(f.dt, f.carPos, T.beaconRevealDistance);

    switch (this.phase) {
      case 'idle':
        if (this.everDrove && (this.timer -= f.dt) <= 0) this.offer(f.carPos);
        break;
      case 'offered':
        if ((this.timer -= f.dt) <= 0) {
          this.ride = null;
          this.phase = 'idle';
          this.timer = T.nextCallDelay;
          this.hooks.toast(t('radio.expired'));
        }
        break;
      case 'toPickup':
        if (this.stoppedNear(f, this.ride!.from, T.pickupRadius)) this.board();
        break;
      case 'toDropoff':
        this.trackRide(f);
        if (this.phase === 'toDropoff' && this.stoppedNear(f, this.ride!.to, T.dropoffRadius)) this.finish(false);
        break;
      case 'result':
        if ((this.timer -= f.dt) <= 0) {
          this.result = null;
          this.phase = 'idle';
          this.timer = T.nextCallDelay;
        }
        break;
    }

    const target = this.currentTarget();
    if (target) this.arrow.update(f.dt, f.arrowAnchor, target, f.arrowScale, this.phase === 'toDropoff' && this.ride!.timeLeft < 20);
    else this.arrow.hide();
  }

  view(carPos: THREE.Vector3Like): RideView {
    const r = this.ride;
    const target = this.currentTarget();
    const distance = target ? Math.hypot(target.x - carPos.x, target.z - carPos.z) : 0;
    const radius = this.phase === 'toPickup' ? T.pickupRadius : T.dropoffRadius;
    return {
      phase: this.phase,
      money: this.money,
      offer:
        this.phase === 'offered' && r
          ? {
              title: t('radio.title'),
              text: t('radio.call', { passenger: t(r.passenger.nameKey), reason: t(r.template.reasonKey) }),
              route: t('radio.route', { from: r.from.label, to: r.to.label }),
              time: t('radio.time', { time: formatTime(r.timeLimit) }),
              expiresIn: this.timer,
            }
          : null,
      ride:
        r && (this.phase === 'toPickup' || this.phase === 'toDropoff') && target
          ? {
              title: t(this.phase === 'toPickup' ? 'ride.toPickup' : 'ride.toDropoff', { passenger: t(r.passenger.nameKey) }),
              address: (this.phase === 'toPickup' ? r.from : r.to).label,
              distance,
              timeLeft: this.phase === 'toDropoff' ? r.timeLeft : null,
              hint: distance < radius * 2.5 ? t(this.phase === 'toPickup' ? 'ride.stopToBoard' : 'ride.stopToDrop') : null,
              urgent: this.phase === 'toDropoff' && r.timeLeft < 20,
            }
          : null,
      result: this.phase === 'result' ? this.result : null,
      bubble: this.bubble?.text ?? null,
      target: target ? { ...target, kind: this.phase === 'toPickup' ? 'pickup' : 'dropoff' } : null,
    };
  }

  /** Passageiro a bordo (para o HUD posicionar o balão). */
  get passengerAboard(): boolean {
    return this.phase === 'toDropoff';
  }

  dispose(): void {
    this.beacon.dispose();
    this.arrow.dispose();
    this.npc?.dispose();
    this.rearPassenger?.dispose();
  }

  // -------------------------------------------------------------------------

  private currentTarget(): { x: number; z: number } | null {
    if (!this.ride) return null;
    if (this.phase === 'toPickup') return this.ride.from;
    if (this.phase === 'toDropoff') return this.ride.to;
    return null;
  }

  /** Sorteia uma corrida: embarque entre os endereços mais próximos do carro, destino a distância razoável. */
  private offer(carPos: THREE.Vector3Like): void {
    // Feriado ou véspera: todo mundo quer ir para o aeroporto "emendar".
    const c = this.conditions;
    const recess = c.holiday || c.holidayEve;
    const templates = recess
      ? RIDES.map((r) => (r.to.includes('aeroporto') ? { ...r, weight: (r.weight ?? 1) * PAYMENT.holidayAirportMul, reasonKey: 'ride.reason.emendar' as const } : r))
      : RIDES;
    for (let attempt = 0; attempt < 12; attempt++) {
      const template = weightedPick(templates);
      const froms = this.addressesIn(template.from)
        .map((a) => ({ a, d: Math.hypot(a.x - carPos.x, a.z - carPos.z) }))
        .sort((p, q) => p.d - q.d)
        .slice(0, 6);
      if (froms.length === 0) continue;
      const from = froms[Math.floor(Math.random() * froms.length)].a;
      const tos = this.addressesIn(template.to).filter((a) => {
        const d = Math.hypot(a.x - from.x, a.z - from.z);
        return a.id !== from.id && d >= T.minDistance && d <= T.maxDistance;
      });
      if (tos.length === 0) continue;
      const to = tos[Math.floor(Math.random() * tos.length)];
      const pool = template.passengers?.length ? PASSENGERS.filter((p) => template.passengers!.includes(p.id)) : PASSENGERS;
      const passenger = pool[Math.floor(Math.random() * pool.length)];
      const dist = Math.hypot(to.x - from.x, to.z - from.z);
      const slack = T.slack * (c.rain ? PAYMENT.rainTimeMul : 1);
      const timeLimit = Math.round(((dist / T.avgSpeed) * slack + T.extraSeconds) / 5) * 5;
      this.ride = { template, passenger, from, to, timeLimit, timeLeft: timeLimit, stats: { jumps: 0, driftTime: 0, crashes: 0, props: 0, lake: false } };
      this.phase = 'offered';
      this.timer = T.callExpires;
      this.hooks.sound('uiNotify');
      return;
    }
    // Nível sem endereços compatíveis (ex.: arena de teste): tenta de novo mais tarde.
    this.timer = 30;
  }

  private groundAt(p: { x: number; z: number }): number {
    return this.level.heightAt?.(p.x, p.z) ?? 0;
  }

  private addressesIn(pools: PoolId[]): AddressPoint[] {
    const prefixes = pools.flatMap((p) => POOLS[p]);
    return this.level.addresses.filter((a) => prefixes.some((pre) => a.id === pre || a.id.startsWith(pre)));
  }

  /** Dirigindo, devagar, dentro do raio por `stopSeconds`. */
  private stoppedNear(f: RideFrame, p: AddressPoint, radius: number): boolean {
    const near = f.driving && f.kmh < T.stopKmh && Math.hypot(f.carPos.x - p.x, f.carPos.z - p.z) < radius;
    this.stopTime = near ? this.stopTime + f.dt : 0;
    return this.stopTime >= T.stopSeconds;
  }

  private board(): void {
    this.stopTime = 0;
    this.phase = 'toDropoff';
    this.npc?.hide();
    if (this.rearPassenger) this.rearPassenger.visible = true;
    this.beacon.setRadius(T.dropoffRadius);
    this.beacon.place(this.ride!.to.x, this.groundAt(this.ride!.to), this.ride!.to.z, COLORS.dropoff);
    this.hooks.sound('doorOpen');
    this.hooks.sound('doorClose');
    this.hurried = false;
    this.idleTimer = 14 + Math.random() * 10;
    // Metade das vezes o passageiro comenta o carro (Lexo: a licitação).
    const def = this.vehicle?.def;
    const env = this.environmentLine();
    if (env && Math.random() < 0.45) this.say(env, true);
    else if (def?.boardLines && Math.random() < 0.6) this.sayKey(`line.board.${def.id}.${1 + Math.floor(Math.random() * def.boardLines)}` as StringKey);
    else this.say('board', true);
  }

  /** Estatísticas e falas durante a corrida. */
  private trackRide(f: RideFrame): void {
    const r = this.ride!;
    r.timeLeft -= f.dt;
    if (r.timeLeft <= 0) {
      r.timeLeft = 0;
      this.finish(true);
      return;
    }
    for (const e of f.carEvents) {
      if (e.type === 'land' && e.airTime > PAYMENT.jumpMinAir) {
        r.stats.jumps++;
        this.say('jump');
      } else if (e.type === 'impact' && e.strength > 5) {
        r.stats.crashes++;
        this.say('crash');
      }
    }
    if (f.propsBroken > 0) {
      r.stats.props += f.propsBroken;
      this.say('prop');
    }
    if (f.splashed && !r.stats.lake) {
      r.stats.lake = true;
      this.say('lake', true);
    }
    // Derrapagem: conta o tempo; comenta uma vez por derrapagem longa.
    if (f.slip > 0.5 && f.kmh > 25) {
      r.stats.driftTime += f.dt;
      this.driftRun += f.dt;
      if (this.driftRun > 0.9 && this.driftRun - f.dt <= 0.9) this.say('drift');
    } else this.driftRun = 0;
    this.fastRun = f.kmh > 115 ? this.fastRun + f.dt : 0;
    if (this.fastRun > 2.5) {
      this.fastRun = -12; // não repete logo
      this.say('fast');
    }
    this.slowRun = f.kmh < 15 ? this.slowRun + f.dt : 0;
    if (this.slowRun > 7) {
      this.slowRun = -10;
      this.say('slow');
    }
    if (!this.hurried && r.timeLeft < 20) {
      this.hurried = true;
      this.say('hurry', true);
    }
    if ((this.idleTimer -= f.dt) <= 0) {
      this.idleTimer = 18 + Math.random() * 12;
      const env = this.environmentLine();
      if (!this.bubble) this.say(env && Math.random() < 0.3 ? env : 'idle');
    }
  }

  private finish(late: boolean): void {
    const r = this.ride!;
    const s = r.stats;
    const P = PAYMENT;
    const lines: ResultLine[] = [];
    const add = (key: StringKey, value: number, params?: Record<string, number>, text?: Record<string, string>) => {
      if (Math.round(value) !== 0) lines.push({ label: t(key, { ...params, ...text }), value: Math.round(value) });
    };
    add('result.base', late ? P.base * P.timeoutBase : P.base);
    if (!late) {
      const tip = r.timeLeft * P.tipPerSecond;
      add('result.tip', tip);
      const def = this.vehicle?.def;
      if (def?.tipMul && def.tipMul !== 1) add('result.comfort', tip * (def.tipMul - 1), undefined, { car: t(def.nameKey) });
      if (this.conditions.holiday) add('result.holiday', tip * (P.holidayTipMul - 1));
    }
    if (this.conditions.night) add('result.night', P.base * P.nightBonus);
    add('result.jumps', s.jumps * P.jumpBonus, { n: s.jumps });
    add('result.drift', s.driftTime * P.driftBonusPerSecond);
    add('result.crashes', -s.crashes * P.crashPenalty, { n: s.crashes });
    add('result.props', -s.props * P.propPenalty, { n: s.props });
    if (s.lake) add('result.lake', -P.lakePenalty);
    const total = lines.reduce((sum, l) => sum + l.value, 0);
    this.money += total;
    this.result = { title: t(late ? 'result.title.late' : 'result.title.ok'), lines, total, late };

    this.say(late ? 'timeout' : 'arrive', true);
    this.hooks.sound(late ? 'uiError' : 'uiConfirm');
    this.hooks.sound('doorOpen');
    if (this.rearPassenger) this.rearPassenger.visible = false;
    this.beacon.hide();
    this.ride = null;
    this.stopTime = 0;
    this.phase = 'result';
    this.timer = 6;
  }

  /** Fala sobre o momento (chuva, seca, feriado, noite), se houver algo a comentar. */
  private environmentLine(): LineTrigger | null {
    const c = this.conditions;
    const options: LineTrigger[] = [];
    if (c.rain) options.push('rain');
    if (c.dry) options.push('dry');
    if (c.holiday || c.holidayEve) options.push('holiday');
    if (c.night) options.push('night');
    return options.length ? options[Math.floor(Math.random() * options.length)] : null;
  }

  private say(trigger: LineTrigger, force = false): void {
    if (!force && this.lineCooldown > 0) return;
    const n = 1 + Math.floor(Math.random() * LINE_COUNTS[trigger]);
    this.sayKey(`line.${trigger}.${n}` as StringKey);
  }

  private sayKey(key: StringKey): void {
    const text = t(key);
    this.bubble = { text, ttl: Math.min(5, 2.2 + text.length * 0.04) };
    this.lineCooldown = 3;
  }
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function weightedPick<T extends { weight?: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + (i.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const i of items) if ((r -= i.weight ?? 1) <= 0) return i;
  return items[items.length - 1];
}
