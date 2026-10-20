// HUD das corridas (DOM): chamado do rádio, corrida em andamento (endereço, distância, cronômetro),
// dinheiro, resultado com a conta detalhada e o balão de fala do passageiro.
import { t } from '../core/i18n';
import { formatTime, type RideView } from '../rides/RideManager';

const money = (v: number) => (v < 0 ? '−' : '') + 'R$ ' + Math.abs(Math.round(v)).toLocaleString('pt-BR');

export class RideHud {
  private readonly radio: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly wallet: HTMLElement;
  private readonly result: HTMLElement;
  private readonly bubble: HTMLElement;
  private readonly q: (ref: string) => HTMLElement;
  private lastKey = '';
  private lastResult: RideView['result'] = null;
  private lastMoney = Number.NaN;

  constructor(root: HTMLElement, onAccept: () => void, touch: boolean) {
    const el = document.createElement('div');
    el.className = 'ride-hud';
    el.innerHTML = `
      <div class="ride-radio" data-ref="radio" hidden>
        <div class="ride-radio-title" data-ref="radioTitle"></div>
        <div data-ref="radioText"></div>
        <div class="ride-radio-leaning" data-ref="radioLeaning"></div>
        <div class="ride-radio-route" data-ref="radioRoute"></div>
        <div class="ride-radio-foot"><span data-ref="radioTime"></span>
          <button type="button" class="hud-primary" data-ref="accept">${t(touch ? 'radio.acceptTouch' : 'radio.accept')}</button></div>
        <div class="ride-radio-expire"><div data-ref="radioBar"></div></div>
      </div>
      <div class="ride-panel" data-ref="panel" hidden>
        <div class="ride-panel-title" data-ref="title"></div>
        <div class="ride-panel-address" data-ref="address"></div>
        <div class="ride-panel-row"><span data-ref="distance"></span><span class="ride-timer" data-ref="timer"></span></div>
        <div class="ride-panel-hint" data-ref="hint" hidden></div>
      </div>
      <div class="ride-wallet" data-ref="wallet"></div>
      <div class="ride-result" data-ref="result" hidden></div>
      <div class="ride-bubble" data-ref="bubble" hidden></div>`;
    root.appendChild(el);
    this.q = (ref) => el.querySelector<HTMLElement>(`[data-ref="${ref}"]`)!;
    this.radio = this.q('radio');
    this.panel = this.q('panel');
    this.wallet = this.q('wallet');
    this.result = this.q('result');
    this.bubble = this.q('bubble');
    this.q('accept').addEventListener('click', onAccept);
  }

  /** @param bubbleAt posição na tela (px) acima do carro, ou null se fora da tela. */
  update(v: RideView, bubbleAt: { x: number; y: number } | null): void {
    // Rádio.
    this.radio.hidden = !v.offer;
    if (v.offer) {
      const key = v.offer.text + v.offer.route;
      if (key !== this.lastKey) {
        this.lastKey = key;
        this.q('radioTitle').textContent = v.offer.title;
        this.q('radioText').textContent = v.offer.text;
        const leaning = this.q('radioLeaning');
        leaning.textContent = v.offer.leaning.text;
        leaning.style.color = v.offer.leaning.color ?? '';
        this.q('radioRoute').textContent = v.offer.route;
        this.q('radioTime').textContent = v.offer.time;
      }
      this.q('radioBar').style.width = `${Math.max(0, (v.offer.expiresIn / 25) * 100)}%`;
    }

    // Corrida em andamento.
    this.panel.hidden = !v.ride;
    if (v.ride) {
      this.q('title').textContent = v.ride.title;
      this.q('address').textContent = v.ride.address;
      this.q('distance').textContent = t('ride.distance', { m: Math.round(v.ride.distance) });
      const timer = this.q('timer');
      timer.textContent = v.ride.timeLeft !== null ? formatTime(v.ride.timeLeft) : '';
      timer.classList.toggle('urgent', v.ride.urgent);
      const hint = this.q('hint');
      hint.hidden = !v.ride.hint;
      if (v.ride.hint) hint.textContent = v.ride.hint;
    }

    // Dinheiro.
    if (v.money !== this.lastMoney) {
      this.lastMoney = v.money;
      this.wallet.textContent = money(v.money);
      this.wallet.classList.toggle('negative', v.money < 0);
    }

    // Resultado.
    this.result.hidden = !v.result;
    if (v.result && v.result !== this.lastResult) {
      const r = v.result;
      this.result.classList.toggle('late', r.late);
      this.result.innerHTML = `<h3>${r.title}</h3>
        ${r.lines.map((l) => `<div class="row"><span>${l.label}</span><span class="${l.value < 0 ? 'neg' : 'pos'}">${money(l.value)}</span></div>`).join('')}
        <div class="row total"><span>${t('result.total')}</span><span>${money(r.total)}</span></div>`;
    }
    this.lastResult = v.result;

    // Balão de fala.
    const show = !!v.bubble && !!bubbleAt;
    this.bubble.hidden = !show;
    if (show) {
      if (this.bubble.textContent !== v.bubble) this.bubble.textContent = v.bubble;
      this.bubble.style.transform = `translate(${bubbleAt!.x}px, ${bubbleAt!.y}px) translate(-50%, -100%)`;
    }
  }
}
