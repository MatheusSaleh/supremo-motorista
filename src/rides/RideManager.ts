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
import { FACTIONS, PURSUIT, type FactionId } from '../data/factions';
import { CAIXETA, CAIXETA_LINES, FAVORS, MALETA_LINES, type FavorKind } from '../data/banker';
import { SeatedDriver } from '../player/SeatedDriver';
import type { Config } from '../config';
import type { Car, CarEvent } from '../vehicle/Car';
import type { AddressPoint, Level } from '../world/Level';
import { Beacon, DirectionArrow, Maleta, PassengerNpc } from './RideVisuals';
import { Quirk } from './Quirk';
import { ARCHETYPE_RULES } from '../data/archetypes';

export type RidePhase = 'idle' | 'offered' | 'toPickup' | 'toDropoff' | 'result';

interface ActiveRide {
  template: RideTemplate;
  passenger: Passenger;
  from: AddressPoint;
  to: AddressPoint;
  timeLimit: number;
  timeLeft: number;
  stats: { jumps: number; driftTime: number; crashes: number; props: number; lake: boolean; escapes: number };
  /** Fase 10: o jeito do passageiro (arquétipo). */
  quirk: Quirk;
  /** Palestrante: parada obrigatória no caminho (timer = segundos parado lá). */
  stop: { address: AddressPoint; done: boolean; timer: number } | null;
}

export interface ResultLine {
  label: string;
  value: number;
}

/** O que o HUD precisa mostrar (strings já traduzidas). */
export interface RideView {
  phase: RidePhase;
  money: number;
  offer: {
    title: string;
    text: string;
    route: string;
    time: string;
    expiresIn: number;
    leaning: { text: string; color: string | null };
    /** Favor do Dr. Caixeta (celular particular) em vez de chamado do rádio. */
    favor: boolean;
    /** Fase 10: perfil do passageiro (regras especiais desta corrida), ou null. */
    profile: string | null;
  } | null;
  ride: {
    title: string;
    address: string;
    distance: number;
    timeLeft: number | null;
    hint: string | null;
    urgent: boolean;
    /** Fase 10: situação do arquétipo (discurso, exposição, parada…). */
    status: string | null;
  } | null;
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
  /** Buzinando (interrompe o Orador). */
  horn: boolean;
  /** Onde a seta 3D deve ficar e em que escala (carro, cockpit ou a pé). */
  arrowAnchor: THREE.Vector3;
  arrowScale: number;
}

export interface RideHooks {
  sound(id: SoundId): void;
  toast(text: string): void;
  /** Passageiro entregue (no tempo ou não): a polarização reage à facção dele. */
  delivered?(faction: FactionId | null): void;
  /** Fase 9: favor aceito/recusado; corrida terminada (favor ou não, e se o destino era o banco). */
  favorAccepted?(): void;
  favorDeclined?(): void;
  finished?(info: { favor: FavorKind | null; late: boolean; toBank: boolean }): void;
}

const COLORS = { pickup: 0xffd34d, dropoff: 0x3ddc84, stop: 0xb388ff };

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
  /** Um passageiro (na calçada e sentado) por modelo de personagem; `who` = o da corrida atual. */
  private readonly npcs: PassengerNpc[];
  private readonly seated: SeatedDriver[];
  private who = 0;
  private vehicle: Car | null = null;
  private conditions: RideConditions = { holiday: false, holidayEve: false, rain: false, dry: false, night: false };
  /** A próxima oferta pode ser um favor (decidido pelo Game, que conhece a suspeição). */
  favorsAllowed = true;
  /** Fase 11: o rádio só chama durante o expediente; multas reduzidas pelo seguro da Oficina. */
  callsAllowed = true;
  penaltyMul = 1;
  private forceFavor = false;
  /** Debug: id do passageiro da próxima corrida comum (null = sorteio). */
  forcedPassenger: string | null = null;
  private readonly maleta = new Maleta();

  constructor(
    private readonly level: Level,
    scene: THREE.Scene,
    rearSeat: THREE.Object3D,
    /** Modelos de passageiro; o primeiro é o executivo (o único que veste o Dr. Caixeta). */
    characters: CharacterAsset[],
    cfg: Config,
    private readonly hooks: RideHooks,
  ) {
    this.beacon = new Beacon(COLORS.pickup, T.pickupRadius);
    scene.add(this.beacon.root, this.arrow.root);
    this.npcs = characters.map((c) => new PassengerNpc(c, 'Wave'));
    for (const n of this.npcs) scene.add(n.root);
    this.seated = characters.map((c) => new SeatedDriver(c, cfg));
    for (const p of this.seated) rearSeat.add(p.root);
    rearSeat.add(this.maleta.seated);
    scene.add(this.maleta.ground);
  }

  private get npc(): PassengerNpc | null {
    return this.npcs[this.who] ?? null;
  }

  private get rearPassenger(): SeatedDriver | null {
    return this.seated[this.who] ?? null;
  }

  /** Carro atual (frota): o passageiro a bordo muda junto; gorjeta e falas dependem do modelo. */
  setVehicle(car: Car): void {
    this.vehicle = car;
    for (const p of this.seated) car.model.rearSeat.add(p.root);
    car.model.rearSeat.add(this.maleta.seated);
  }

  /** Favor em andamento (aceito, ainda não entregue). */
  get activeFavor(): FavorKind | null {
    return (this.phase === 'toPickup' || this.phase === 'toDropoff') && this.ride?.template.favor ? this.ride.template.favor : null;
  }

  /** Favor a bordo agora (o Dr. Caixeta ou a maleta no carro). */
  get favorAboard(): FavorKind | null {
    return this.phase === 'toDropoff' ? (this.ride?.template.favor ?? null) : null;
  }

  /** Debug: a próxima oferta (ou a atual, se ociosa) é uma ligação do Dr. Caixeta. */
  callNow(carPos: THREE.Vector3Like): void {
    if (this.phase !== 'idle' && this.phase !== 'offered' && this.phase !== 'result') return;
    this.forceFavor = true;
    this.offer(carPos);
  }

  /** Novo dia (Fase 11): sem corrida, sem passageiro, rádio chama logo no começo do expediente. */
  resetForNewDay(): void {
    this.npc?.hide();
    this.maleta.hide();
    if (this.rearPassenger) this.rearPassenger.visible = false;
    this.beacon.hide();
    this.ride = null;
    this.result = null;
    this.bubble = null;
    this.phase = 'idle';
    this.timer = T.firstCallDelay;
  }

  /** Corrida em andamento (atendida e não terminada). */
  get rideInProgress(): boolean {
    return this.phase === 'toPickup' || this.phase === 'toDropoff';
  }

  /** Debug: novo chamado agora (comum, com o passageiro forçado, se houver). */
  offerNow(carPos: THREE.Vector3Like): void {
    if (this.phase !== 'idle' && this.phase !== 'offered' && this.phase !== 'result') return;
    this.ride = null;
    this.phase = 'idle';
    this.offer(carPos);
  }

  /** A imprensa fotografou: quem está a bordo reage. */
  photographed(): void {
    if (!this.passengerAboard) return;
    this.ride!.quirk.photographed();
    this.say('photo', true);
  }

  /**
   * Escândalo: a Corregedoria cobra a multa e, se houver favor em andamento, ele é cancelado (a maleta é
   * apreendida; o Dr. Caixeta "desce na próxima esquina"). Retorna se havia uma maleta.
   */
  scandal(fine: number, quiet: number): boolean {
    this.money -= fine;
    const favor = this.activeFavor;
    // Um chamado em aberto é retirado e o rádio fica quieto enquanto a manchete está na tela.
    if (this.phase === 'offered' || this.phase === 'idle' || this.phase === 'result') {
      if (this.phase === 'offered') this.ride = null;
      this.result = null;
      this.phase = 'idle';
      this.timer = Math.max(this.timer, quiet);
    }
    if (!favor) return false;
    this.npc?.hide();
    this.maleta.hide();
    if (this.rearPassenger) this.rearPassenger.visible = false;
    this.beacon.hide();
    this.ride = null;
    this.phase = 'idle';
    this.timer = quiet;
    return favor === 'maleta';
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
    const banker = this.ride.passenger.id === CAIXETA.passengerId;
    // Rosto do passageiro: o Dr. Caixeta é sempre o executivo (terno creme); os outros, sorteados.
    for (const n of this.npcs) n.hide();
    for (const p of this.seated) p.visible = false;
    this.who = banker ? 0 : Math.floor(Math.random() * this.npcs.length);
    const look = banker ? CAIXETA.look : PASSENGER_LOOKS[Math.floor(Math.random() * PASSENGER_LOOKS.length)];
    this.npc?.setLook(look);
    this.rearPassenger?.setLook(look);
    this.npc?.place(from.x, this.groundAt(from), from.z, from.x * 0.98, from.z * 0.98);
    // Maleta: o Dr. Caixeta espera com ela ao lado, na calçada.
    if (this.ride.template.favor === 'maleta') this.maleta.placeBeside(this.npc?.root ?? null, from.x, this.groundAt(from), from.z);
    if (this.ride.template.favor) {
      this.hooks.favorAccepted?.();
      this.hooks.toast(t('favor.accepted'));
    }
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
        if (this.everDrove && this.callsAllowed && (this.timer -= f.dt) <= 0) this.offer(f.carPos);
        break;
      case 'offered':
        if ((this.timer -= f.dt) <= 0) {
          const favor = !!this.ride?.template.favor;
          this.ride = null;
          this.phase = 'idle';
          this.timer = T.nextCallDelay;
          if (favor) this.hooks.favorDeclined?.();
          this.hooks.toast(t(favor ? 'favor.declined' : 'radio.expired'));
        }
        break;
      case 'toPickup':
        if (this.stoppedNear(f, this.ride!.from, T.pickupRadius)) this.board();
        break;
      case 'toDropoff':
        this.trackRide(f);
        if (this.phase !== 'toDropoff') break;
        if (this.pendingStop) this.updateStop(f);
        else if (this.stoppedNear(f, this.ride!.to, T.dropoffRadius)) this.finish(false);
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
              title: t(r.template.favor ? 'phone.title' : 'radio.title'),
              text: r.template.favor
                ? t(`favor.call.${r.template.favor}`, { reason: t(r.template.reasonKey) })
                : t('radio.call', { passenger: t(r.passenger.nameKey), reason: t(r.template.reasonKey) }),
              route: t('radio.route', { from: r.from.label, to: r.to.label }),
              time: t('radio.time', { time: formatTime(r.timeLimit) }),
              expiresIn: this.timer,
              leaning: r.template.favor
                ? { text: t('favor.pay', { value: (PAYMENT.base * FAVORS.payMul[r.template.favor]).toLocaleString('pt-BR') }), color: '#ff9f43' }
                : r.passenger.faction
                  ? { text: t('radio.leaning', { faction: t(FACTIONS[r.passenger.faction].nameKey) }), color: FACTIONS[r.passenger.faction].css }
                  : { text: t('radio.neutral'), color: null },
              favor: !!r.template.favor,
              profile: r.quirk.profile,
            }
          : null,
      ride:
        r && (this.phase === 'toPickup' || this.phase === 'toDropoff') && target
          ? {
              title:
                r.template.favor === 'maleta'
                  ? t(this.phase === 'toPickup' ? 'favor.toPickupMaleta' : 'favor.toDropoffMaleta')
                  : t(this.pendingStop ? 'ride.toStop' : this.phase === 'toPickup' ? 'ride.toPickup' : 'ride.toDropoff', { passenger: t(r.passenger.nameKey) }),
              address: (this.phase === 'toPickup' ? r.from : (this.pendingStop ?? r.to)).label,
              distance,
              timeLeft: this.phase === 'toDropoff' ? r.timeLeft : null,
              hint: distance < radius * 2.5 ? t(this.phase === 'toPickup' ? 'ride.stopToBoard' : this.pendingStop ? 'ride.stopToLecture' : 'ride.stopToDrop') : null,
              urgent: this.phase === 'toDropoff' && r.timeLeft < 20,
              status: this.rideStatus(r),
            }
          : null,
      result: this.phase === 'result' ? this.result : null,
      bubble: this.bubble?.text ?? null,
      target: target ? { ...target, kind: this.phase === 'toPickup' ? 'pickup' : 'dropoff' } : null,
    };
  }

  /** Facção do passageiro a bordo: undefined = ninguém a bordo; null = passageiro neutro. */
  get aboardFaction(): FactionId | null | undefined {
    return this.phase === 'toDropoff' && this.ride ? this.ride.passenger.faction : undefined;
  }

  /** Perseguidores apareceram. */
  pursuitStarted(): void {
    if (this.passengerAboard) this.say('chase');
  }

  /** Um perseguidor foi despistado (conta bônus se há passageiro). */
  pursuerEscaped(): void {
    if (!this.passengerAboard) return;
    this.ride!.stats.escapes++;
    this.say('escape', true);
  }

  tomatoHit(): void {
    if (this.passengerAboard) this.say('tomato', true);
  }

  /** Entrou num território: o passageiro comenta se for da facção dona ou da rival. */
  enteredTerritory(owner: FactionId): void {
    const f = this.aboardFaction;
    if (!f) return;
    this.say(f === owner ? 'friendly' : 'hostile', true);
  }

  /** Passageiro a bordo (para o HUD posicionar o balão). */
  get passengerAboard(): boolean {
    return this.phase === 'toDropoff';
  }

  dispose(): void {
    this.beacon.dispose();
    this.arrow.dispose();
    for (const n of this.npcs) n.dispose();
    for (const p of this.seated) p.dispose();
  }

  // -------------------------------------------------------------------------

  private currentTarget(): { x: number; z: number } | null {
    if (!this.ride) return null;
    if (this.phase === 'toPickup') return this.ride.from;
    if (this.phase === 'toDropoff') return this.pendingStop ?? this.ride.to;
    return null;
  }

  /** Parada do Palestrante ainda por fazer (a bordo). */
  private get pendingStop(): AddressPoint | null {
    const st = this.ride?.stop;
    return this.phase === 'toDropoff' && st && !st.done ? st.address : null;
  }

  /** Situação do arquétipo para o painel (a parada do Palestrante tem prioridade). */
  private rideStatus(r: ActiveRide): string | null {
    if (this.phase !== 'toDropoff') return null;
    const st = r.stop;
    if (st && !st.done) {
      return st.timer > 0
        ? t('status.lecturing', { s: Math.ceil(ARCHETYPE_RULES.palestrante.stopSeconds - st.timer) })
        : t('status.stop', { address: st.address.label });
    }
    if (st?.done && r.quirk.kind === 'palestrante') return t('status.stopDone');
    return r.quirk.status();
  }

  /** Palestrante parado na parada: conta o tempo; ao completar, segue para o destino. */
  private updateStop(f: RideFrame): void {
    const r = this.ride!;
    const st = r.stop!;
    if (!this.stoppedNear(f, st.address, T.dropoffRadius)) {
      st.timer = 0;
      return;
    }
    st.timer += f.dt;
    if (st.timer < ARCHETYPE_RULES.palestrante.stopSeconds) return;
    st.done = true;
    this.stopTime = 0;
    this.say('lecture', true);
    this.hooks.sound('doorClose');
    this.beacon.place(r.to.x, this.groundAt(r.to), r.to.z, COLORS.dropoff);
  }

  /** Sorteia uma corrida: embarque entre os endereços mais próximos do carro, destino a distância razoável. */
  private offer(carPos: THREE.Vector3Like): void {
    // Feriado ou véspera: todo mundo quer ir para o aeroporto "emendar".
    const c = this.conditions;
    const recess = c.holiday || c.holidayEve;
    // Favor do Dr. Caixeta (de vez em quando, se o Game permitir) ou corrida comum.
    const favor = this.forceFavor || (this.favorsAllowed && Math.random() < FAVORS.callChance);
    this.forceFavor = false;
    const pool = RIDES.filter((r) => !!r.favor === favor);
    const templates = recess
      ? pool.map((r) => (r.to.includes('aeroporto') ? { ...r, weight: (r.weight ?? 1) * PAYMENT.holidayAirportMul, reasonKey: 'ride.reason.emendar' as const } : r))
      : pool;
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
        return a.id !== from.id && d >= T.minDistance && d <= (template.maxDistance ?? T.maxDistance);
      });
      if (tos.length === 0) continue;
      const to = tos[Math.floor(Math.random() * tos.length)];
      const people = template.passengers?.length
        ? PASSENGERS.filter((p) => template.passengers!.includes(p.id))
        : PASSENGERS.filter((p) => p.id !== CAIXETA.passengerId);
      const forced = people.find((p) => p.id === this.forcedPassenger);
      const passenger = forced ?? people[Math.floor(Math.random() * people.length)];
      const quirk = new Quirk(passenger.archetype);
      // Palestrante: escolhe a parada com o menor desvio (entre as três melhores, para variar).
      const stopAt = passenger.archetype === 'palestrante' ? this.pickStop(from, to) : null;
      const stop = stopAt ? { address: stopAt, done: false, timer: 0 } : null;
      const dist = stopAt
        ? Math.hypot(stopAt.x - from.x, stopAt.z - from.z) + Math.hypot(to.x - stopAt.x, to.z - stopAt.z)
        : Math.hypot(to.x - from.x, to.z - from.z);
      const slack = T.slack * (c.rain ? PAYMENT.rainTimeMul : 1);
      const extra = T.extraSeconds + (stop ? ARCHETYPE_RULES.palestrante.stopSeconds + 10 : 0);
      const timeLimit = Math.round((((dist / T.avgSpeed) * slack + extra) * quirk.timeMul) / 5) * 5;
      const stats = { jumps: 0, driftTime: 0, crashes: 0, props: 0, lake: false, escapes: 0 };
      this.ride = { template, passenger, from, to, timeLimit, timeLeft: timeLimit, stats, quirk, stop };
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

  /** Endereço de parada do Palestrante: longe da origem e do destino, com o menor desvio possível. */
  private pickStop(from: AddressPoint, to: AddressPoint): AddressPoint | null {
    const R = ARCHETYPE_RULES.palestrante;
    const d = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
    const options = this.addressesIn(R.stopPools)
      .filter((a) => a.id !== from.id && a.id !== to.id && d(a, from) >= R.stopMinDistance && d(a, to) >= R.stopMinDistance)
      .map((a) => ({ a, detour: d(from, a) + d(a, to) - d(from, to) }))
      .sort((p, q) => p.detour - q.detour)
      .slice(0, 3);
    return options.length ? options[Math.floor(Math.random() * options.length)].a : null;
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
    // Maleta: vai sozinha no banco de trás (o Dr. Caixeta fica na calçada).
    const maleta = this.ride!.template.favor === 'maleta';
    if (this.rearPassenger) this.rearPassenger.visible = !maleta;
    this.maleta.board(maleta);
    this.beacon.setRadius(T.dropoffRadius);
    const stop = this.ride!.stop;
    if (stop) this.beacon.place(stop.address.x, this.groundAt(stop.address), stop.address.z, COLORS.stop);
    else this.beacon.place(this.ride!.to.x, this.groundAt(this.ride!.to), this.ride!.to.z, COLORS.dropoff);
    this.hooks.sound('doorOpen');
    this.hooks.sound('doorClose');
    this.hurried = false;
    this.idleTimer = 14 + Math.random() * 10;
    // Metade das vezes o passageiro comenta o carro (o de luxo: a licitação).
    const def = this.vehicle?.def;
    const env = this.environmentLine();
    if (this.ride!.template.favor) this.say('board', true);
    else if (stop) this.say('stopAsk', true);
    else if (env && Math.random() < 0.45) this.say(env, true);
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
        if (!r.quirk.jumped(this.sayFn)) this.say('jump');
      } else if (e.type === 'impact' && e.strength > 5) {
        r.stats.crashes++;
        if (!r.quirk.crashed(this.sayFn)) this.say('crash');
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
      if (this.driftRun > 0.9 && this.driftRun - f.dt <= 0.9 && !r.quirk.drifted(this.sayFn)) this.say('drift');
    } else this.driftRun = 0;
    r.quirk.update({ dt: f.dt, kmh: f.kmh, slip: f.slip, x: f.carPos.x, z: f.carPos.z, horn: f.horn }, this.sayFn);
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
    if ((this.idleTimer -= f.dt) <= 0 && !r.quirk.busyTalking) {
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
    const favor = r.template.favor ?? null;
    if (favor) add('result.favor', P.base * FAVORS.payMul[favor] * (late ? 0.5 : 1));
    else add('result.base', late ? P.base * P.timeoutBase : P.base);
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
    const extra = r.quirk.bonusMul - 1;
    if (extra > 0) add('result.thrilled', (s.jumps * P.jumpBonus + s.driftTime * P.driftBonusPerSecond) * extra);
    r.quirk.result(add, late, late ? 0 : r.timeLeft * P.tipPerSecond);
    if (r.stop?.done) add('result.lecture', ARCHETYPE_RULES.palestrante.stopBonus);
    add('result.crashes', -s.crashes * P.crashPenalty * this.penaltyMul, { n: s.crashes });
    add('result.props', -s.props * P.propPenalty * this.penaltyMul, { n: s.props });
    if (s.lake) add('result.lake', -P.lakePenalty * this.penaltyMul);
    add('result.escape', s.escapes * PURSUIT.escapeBonus, { n: s.escapes });
    const total = lines.reduce((sum, l) => sum + l.value, 0);
    this.money += total;
    this.result = { title: t(late ? 'result.title.late' : favor ? 'result.title.favor' : 'result.title.ok'), lines, total, late };

    this.hooks.delivered?.(r.passenger.faction);
    this.hooks.finished?.({ favor, late, toBank: r.to.id === 'banco' });
    this.say(late ? 'timeout' : 'arrive', true);
    this.hooks.sound(late ? 'uiError' : 'uiConfirm');
    this.hooks.sound('doorOpen');
    if (this.rearPassenger) this.rearPassenger.visible = false;
    this.maleta.hide();
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

  /** `say` para o Quirk (arquétipo), com duração opcional do balão. */
  private readonly sayFn = (trigger: LineTrigger, force = false, ttl?: number) => this.say(trigger, force, ttl);

  private say(trigger: LineTrigger, force = false, ttl?: number): void {
    if (!force && this.lineCooldown > 0) return;
    // Favores: o Dr. Caixeta tem falas próprias; com a maleta, só mensagens dele no celular.
    const favor = this.ride?.template.favor;
    const own = favor === 'maleta' ? MALETA_LINES : favor === 'carona' ? CAIXETA_LINES : null;
    if (own) {
      const n = own[trigger];
      if (n) this.sayKey(`line.${favor === 'maleta' ? 'maleta' : 'caixeta'}.${trigger}.${1 + Math.floor(Math.random() * n)}` as StringKey);
      if (n || favor === 'maleta') return;
    }
    const n = 1 + Math.floor(Math.random() * LINE_COUNTS[trigger]);
    this.sayKey(`line.${trigger}.${n}` as StringKey, ttl);
  }

  private sayKey(key: StringKey, ttl?: number): void {
    const text = t(key);
    this.bubble = { text, ttl: ttl ?? Math.min(5, 2.2 + text.length * 0.04) };
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
