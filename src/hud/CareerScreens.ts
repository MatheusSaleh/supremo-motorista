// Telas da carreira (Fase 11): selo do expediente, contracheque do fim do dia e a Oficina do Tribunal.
// Só DOM: recebe dados prontos e devolve as escolhas por callbacks.
import { t } from '../core/i18n';
import type { Career, ShiftSummary } from '../career/Career';
import { CAR_PRICES, SHIFT, UPGRADES, type UpgradeId } from '../data/career';
import type { StringKey } from '../core/i18n';

const money = (v: number) => (v < 0 ? '−' : '') + 'R$ ' + Math.abs(Math.round(v)).toLocaleString('pt-BR');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export interface WorkshopCar {
  id: string;
  nameKey: StringKey;
}

export interface CareerScreenCallbacks {
  onContinue(): void;
  onBuyUpgrade(id: UpgradeId): void;
  onBuyCar(id: string): void;
  onCloseWorkshop(): void;
}

export class CareerScreens {
  private readonly badge: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly workshop: HTMLElement;
  private lastBadge = '';

  constructor(
    root: HTMLElement,
    cb: CareerScreenCallbacks,
    private readonly cars: readonly WorkshopCar[],
  ) {
    this.badge = el('div', 'career-badge');
    this.summary = el('div', 'career-overlay');
    this.summary.hidden = true;
    this.workshop = el('div', 'career-overlay');
    this.workshop.hidden = true;
    root.append(this.badge, this.summary, this.workshop);
    this.summary.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="continue"]')) cb.onContinue();
    });
    this.workshop.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!b || b.disabled) return;
      if (b.dataset.act === 'upgrade') cb.onBuyUpgrade(b.dataset.id as UpgradeId);
      else if (b.dataset.act === 'car') cb.onBuyCar(b.dataset.id!);
      else if (b.dataset.act === 'close') cb.onCloseWorkshop();
    });
  }

  /** Selo do expediente (canto inferior esquerdo). */
  updateBadge(c: Career, money: number): void {
    const head = !c.started
      ? t('shift.waiting', { day: c.day })
      : c.overtime
        ? t('shift.overtime', { day: c.day })
        : t('shift.hud', { day: c.day, time: clock(c.timeLeft) });
    const done = c.started ? Math.max(0, money - c.dayStartMoney) : 0;
    const goal = t('shift.goal', { done: Math.round(done).toLocaleString('pt-BR'), goal: c.goal.toLocaleString('pt-BR') });
    const key = `${head}|${goal}|${c.timeLeft <= SHIFT.warnAt}`;
    if (key === this.lastBadge) return;
    this.lastBadge = key;
    this.badge.innerHTML = `<div>${head}</div><div class="career-goal ${done >= c.goal ? 'ok' : ''}">${goal}</div>`;
    this.badge.classList.toggle('urgent', c.started && !c.overtime && c.timeLeft <= SHIFT.warnAt);
  }

  get summaryOpen(): boolean {
    return !this.summary.hidden;
  }

  get workshopOpen(): boolean {
    return !this.workshop.hidden;
  }

  showSummary(s: ShiftSummary): void {
    const row = (label: string, v: number) => `<div class="row"><span>${label}</span><span class="${v < 0 ? 'neg' : 'pos'}">${money(v)}</span></div>`;
    this.summary.innerHTML = `
      <div class="career-panel">
        <h2>${t('summary.title', { day: s.day })}</h2>
        <p>${t('summary.rides', { n: s.stats.rides, late: s.stats.late })}<br>
          ${t('summary.favors', { n: s.stats.favors })} · ${t('summary.scandals', { n: s.stats.scandals })}</p>
        ${row(t('summary.earned'), s.earned)}
        ${row(t('summary.salary'), s.salary)}
        ${s.allowance ? row(t('summary.allowance'), s.allowance) : ''}
        ${s.overachieve ? row(t('summary.overachieve'), s.overachieve) : ''}
        <div class="row total"><span>${t('summary.total')}</span><span>${money(s.balance)}</span></div>
        <p class="career-verdict ${s.goalMet ? 'ok' : 'bad'}">${
          s.goalMet ? t('summary.goalOk', { goal: s.goal.toLocaleString('pt-BR') }) : t('summary.goalMiss', { goal: s.goal.toLocaleString('pt-BR'), n: s.warnings, max: SHIFT.maxWarnings })
        }</p>
        ${s.fired ? `<p class="career-verdict bad">${t('summary.fired')}</p>` : ''}
        <p class="hud-note">${t('summary.saved')}</p>
        <button type="button" class="hud-primary" data-act="continue">${t('summary.next', { day: s.day + 1 })}</button>
      </div>`;
    this.summary.hidden = false;
  }

  hideSummary(): void {
    this.summary.hidden = true;
  }

  /** Abre (ou redesenha) a Oficina com o saldo e os níveis atuais. */
  showWorkshop(c: Career, balance: number): void {
    const upgrades = UPGRADES.map((u) => {
      const lvl = c.level(u.id);
      const price = c.nextPrice(u.id);
      const btn =
        price === null
          ? `<button type="button" disabled>${t('workshop.max')}</button>`
          : `<button type="button" class="hud-primary" data-act="upgrade" data-id="${u.id}" ${balance < price ? 'disabled' : ''}>${t('workshop.buy', { price: price.toLocaleString('pt-BR') })}</button>`;
      return `<div class="career-item"><div><b>${t(u.nameKey)}</b> <small>${t('workshop.level', { n: lvl, max: u.prices.length })}</small><br><small>${t(u.descKey)}</small></div>${btn}</div>`;
    }).join('');
    const cars = this.cars
      .filter((car) => car.id in CAR_PRICES)
      .map((car) => {
        const price = CAR_PRICES[car.id];
        const owned = c.owns(car.id);
        const btn = owned
          ? `<button type="button" disabled>${t('workshop.owned')}</button>`
          : `<button type="button" class="hud-primary" data-act="car" data-id="${car.id}" ${balance < price ? 'disabled' : ''}>${t('workshop.buy', { price: price.toLocaleString('pt-BR') })}</button>`;
        const note = car.id === 'lexo' ? `<br><small>${t('workshop.lexo')}</small>` : '';
        return `<div class="career-item"><div><b>${t(car.nameKey)}</b>${note}</div>${btn}</div>`;
      })
      .join('');
    this.workshop.innerHTML = `
      <div class="career-panel wide">
        <div class="career-head"><h2>${t('workshop.title')}</h2><span class="career-balance">${t('workshop.balance', { value: Math.round(balance).toLocaleString('pt-BR') })}</span></div>
        <p class="hud-note">${t('workshop.subtitle')}</p>
        <h3>${t('workshop.upgrades')}</h3>${upgrades}
        <h3>${t('workshop.cars')}</h3>${cars}
        <button type="button" class="hud-secondary" data-act="close">${t('workshop.close')}</button>
      </div>`;
    this.workshop.hidden = false;
  }

  hideWorkshop(): void {
    this.workshop.hidden = true;
  }
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
