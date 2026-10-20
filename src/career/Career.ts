// Fase 11: carreira do Josué. Dias de expediente com meta, contracheque, compras na Oficina (melhorias e
// carros) e o salvamento no localStorage. Sem DOM nem Three.js: o Game aplica os efeitos.
import { CAR_PRICES, SAVE_KEY, SHIFT, UPGRADES, UPGRADE_EFFECTS as E, dailyGoal, type UpgradeId } from '../data/career';
import type { EndingId } from '../data/campaign';

export interface DayStats {
  rides: number;
  late: number;
  favors: number;
  scandals: number;
}

/** O que mais entra no salvamento (vem de outros sistemas). */
export interface SaveExtras {
  money: number;
  suspicion: { value: number; favorsAccepted: number; favorsDeclined: number; scandals: number };
}

interface SaveData extends SaveExtras {
  version: 1;
  day: number;
  warnings: number;
  upgrades: Partial<Record<UpgradeId, number>>;
  cars: string[];
  totals: { rides: number; late: number };
  /** Fase 12 (opcionais: salvamentos antigos não têm). */
  campaignDone?: boolean;
  ending?: EndingId | null;
  shift: { started: boolean; timeLeft: number; dayStartMoney: number; overtime: boolean; stats: DayStats };
}

export interface ShiftSummary {
  day: number;
  goal: number;
  earned: number;
  salary: number;
  allowance: number;
  overachieve: number;
  balance: number;
  stats: DayStats;
  goalMet: boolean;
  warnings: number;
  fired: boolean;
}

export type ShiftEvent = 'start' | 'warn' | 'overtime' | 'end';

const emptyStats = (): DayStats => ({ rides: 0, late: 0, favors: 0, scandals: 0 });

export class Career {
  day = 1;
  warnings = 0;
  readonly upgrades: Partial<Record<UpgradeId, number>> = {};
  readonly cars = new Set<string>();
  totals = { rides: 0, late: 0 };
  /** Fase 12: a campanha terminou (modo livre) e com qual final. */
  campaignDone = false;
  ending: EndingId | null = null;
  // Expediente atual.
  started = false;
  timeLeft = SHIFT.seconds;
  overtime = false;
  dayStartMoney = 0;
  stats = emptyStats();
  private warned = false;

  /** Dados salvos (null = jogo novo). O Game aplica dinheiro e suspeição. */
  static load(): { career: Career; extras: SaveExtras | null } {
    const c = new Career();
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return { career: c, extras: null };
      const d = JSON.parse(raw) as SaveData;
      if (d.version !== 1) return { career: c, extras: null };
      c.day = d.day;
      c.warnings = d.warnings;
      Object.assign(c.upgrades, d.upgrades);
      for (const id of d.cars) c.cars.add(id);
      c.totals = { ...d.totals };
      c.campaignDone = d.campaignDone ?? false;
      c.ending = d.ending ?? null;
      Object.assign(c, { started: d.shift.started, timeLeft: d.shift.timeLeft, overtime: d.shift.overtime, dayStartMoney: d.shift.dayStartMoney });
      c.stats = { ...emptyStats(), ...d.shift.stats };
      c.warned = c.timeLeft <= SHIFT.warnAt;
      return { career: c, extras: { money: d.money, suspicion: d.suspicion } };
    } catch {
      return { career: c, extras: null };
    }
  }

  /** Há um jogo salvo? */
  static exists(): boolean {
    try {
      return localStorage.getItem(SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  static wipe(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* sem storage */
    }
  }

  save(extras: SaveExtras): void {
    const data: SaveData = {
      version: 1,
      day: this.day,
      warnings: this.warnings,
      upgrades: this.upgrades,
      cars: [...this.cars],
      totals: this.totals,
      campaignDone: this.campaignDone,
      ending: this.ending,
      shift: { started: this.started, timeLeft: this.timeLeft, dayStartMoney: this.dayStartMoney, overtime: this.overtime, stats: this.stats },
      ...extras,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* sem storage: só não salva */
    }
  }

  get goal(): number {
    return dailyGoal(this.day);
  }

  /** Carro liberado (os sem preço vêm de fábrica). */
  owns(carId: string): boolean {
    return !(carId in CAR_PRICES) || this.cars.has(carId);
  }

  level(id: UpgradeId): number {
    return this.upgrades[id] ?? 0;
  }

  /** Preço do próximo nível (null = no máximo). */
  nextPrice(id: UpgradeId): number | null {
    const def = UPGRADES.find((u) => u.id === id)!;
    return def.prices[this.level(id)] ?? null;
  }

  /** Compra o próximo nível; retorna o preço pago ou null se não deu. */
  buyUpgrade(id: UpgradeId, money: number): number | null {
    const price = this.nextPrice(id);
    if (price === null || money < price) return null;
    this.upgrades[id] = this.level(id) + 1;
    this.adjustBaseline(-price);
    return price;
  }

  buyCar(id: string, money: number): number | null {
    const price = CAR_PRICES[id];
    if (price === undefined || this.cars.has(id) || money < price) return null;
    this.cars.add(id);
    this.adjustBaseline(-price);
    return price;
  }

  /**
   * Dinheiro que entrou ou saiu sem ser trabalho do dia (compras na Oficina, debug): move a referência do
   * faturamento, para não contar contra (ou a favor) da meta.
   */
  adjustBaseline(delta: number): void {
    if (this.started) this.dayStartMoney += delta;
  }

  /** Multiplicadores para a física dos carros (todas as melhorias de uma vez). */
  carMods(): { engine: number; speed: number; grip: number; turboRecharge: number; turboForce: number; stiffness: number } {
    return {
      engine: 1 + E.motorForce * this.level('motor'),
      speed: 1 + E.motorSpeed * this.level('motor'),
      grip: 1 + E.grip * this.level('pneus'),
      turboRecharge: 1 + E.turboRecharge * this.level('turbo'),
      turboForce: 1 + E.turboForce * this.level('turbo'),
      stiffness: 1 + E.stiffness * this.level('suspensao'),
    };
  }

  /** Fração das multas que sobra com o seguro (1 = sem seguro). */
  get penaltyMul(): number {
    return Math.max(0, 1 - E.insurance * this.level('seguro'));
  }

  /** Fração da suspeição das fotos que sobra com a película. */
  get photoMul(): number {
    return Math.max(0, 1 - E.tint * this.level('pelicula'));
  }

  /**
   * Por frame (fora de pausa/menus). O expediente começa quando Josué dirige pela primeira vez no dia; no
   * fim, se há corrida em andamento, vira hora extra até ela terminar.
   */
  update(dt: number, driving: boolean, rideInProgress: boolean, money: number): ShiftEvent | null {
    if (!this.started) {
      if (!driving) return null;
      this.started = true;
      this.dayStartMoney = money;
      return 'start';
    }
    if (this.overtime) return rideInProgress ? null : 'end';
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (!this.warned && this.timeLeft <= SHIFT.warnAt) {
      this.warned = true;
      return 'warn';
    }
    if (this.timeLeft > 0) return null;
    if (rideInProgress) {
      this.overtime = true;
      return 'overtime';
    }
    return 'end';
  }

  rideFinished(late: boolean, favor: boolean): void {
    this.stats.rides++;
    this.totals.rides++;
    if (late) {
      this.stats.late++;
      this.totals.late++;
    }
    if (favor) this.stats.favors++;
  }

  scandal(): void {
    this.stats.scandals++;
  }

  /** Fecha o dia: contracheque, advertência e próximo dia. Retorna o resumo e o novo saldo. */
  closeDay(money: number): ShiftSummary {
    const goal = this.goal;
    const earned = money - this.dayStartMoney;
    const goalMet = earned >= goal;
    const allowance = goalMet ? SHIFT.suitAllowance : 0;
    const overachieve = earned >= goal * SHIFT.overachieveMul ? SHIFT.overachieveBonus : 0;
    if (!goalMet) this.warnings++;
    const balance = money + SHIFT.salary + allowance + overachieve;
    const summary: ShiftSummary = {
      day: this.day,
      goal,
      earned,
      salary: SHIFT.salary,
      allowance,
      overachieve,
      balance,
      stats: { ...this.stats },
      goalMet,
      warnings: this.warnings,
      fired: this.warnings >= SHIFT.maxWarnings,
    };
    this.day++;
    this.started = false;
    this.timeLeft = SHIFT.seconds;
    this.overtime = false;
    this.warned = false;
    this.stats = emptyStats();
    return summary;
  }
}
