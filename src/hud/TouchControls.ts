// Controles de toque (celular/tablet): joystick virtual à esquerda, arrastar à direita para a câmera
// e botões de ação. Tudo vira teclas virtuais no Input, então o resto do jogo não muda.
import { t } from '../core/i18n';
import type { Input } from '../core/Input';
import type { HudMode } from './controls';

/** Há tela de toque como entrada principal? */
export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

const DEAD_ZONE = 0.3;

export class TouchControls {
  readonly element: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly labels: Record<string, HTMLElement> = {};
  private stickPointer: number | null = null;
  private lookPointer: number | null = null;
  private lastLook = { x: 0, y: 0 };
  private mode: HudMode | null = null;

  constructor(
    private readonly input: Input,
    onPause: () => void,
  ) {
    const el = document.createElement('div');
    el.className = 'touch-controls';
    el.innerHTML = `
      <div class="touch-look" data-ref="look"></div>
      <div class="touch-stick" data-ref="stick"><div class="touch-knob" data-ref="knob"></div></div>
      <div class="touch-buttons">
        <button type="button" data-key="Space" class="big"></button>
        <button type="button" data-key="ShiftLeft"></button>
        <button type="button" data-key="KeyE"></button>
        <button type="button" data-key="KeyH">${t('touch.horn')}</button>
        <button type="button" data-key="KeyR">R</button>
      </div>
      <button type="button" class="touch-pause" data-ref="pause" aria-label="${t('pause.title')}">II</button>`;
    this.element = el;
    this.stick = el.querySelector<HTMLElement>('[data-ref="stick"]')!;
    this.knob = el.querySelector<HTMLElement>('[data-ref="knob"]')!;

    // Joystick: vetor → W/A/S/D.
    this.stick.addEventListener('pointerdown', (e) => {
      this.stickPointer = e.pointerId;
      this.stick.setPointerCapture(e.pointerId);
      this.moveStick(e);
    });
    this.stick.addEventListener('pointermove', (e) => e.pointerId === this.stickPointer && this.moveStick(e));
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.knob.style.transform = '';
      for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) input.setVirtualKey(k, false);
    };
    this.stick.addEventListener('pointerup', release);
    this.stick.addEventListener('pointercancel', release);

    // Arrastar na área da direita gira a câmera.
    const look = el.querySelector<HTMLElement>('[data-ref="look"]')!;
    look.addEventListener('pointerdown', (e) => {
      this.lookPointer = e.pointerId;
      look.setPointerCapture(e.pointerId);
      this.lastLook = { x: e.clientX, y: e.clientY };
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return;
      input.addLook((e.clientX - this.lastLook.x) * 1.6, (e.clientY - this.lastLook.y) * 1.6);
      this.lastLook = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e: PointerEvent) => e.pointerId === this.lookPointer && (this.lookPointer = null);
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    // Botões seguram a tecla enquanto pressionados.
    for (const b of el.querySelectorAll<HTMLButtonElement>('[data-key]')) {
      const key = b.dataset.key!;
      this.labels[key] = b;
      const up = () => {
        input.setVirtualKey(key, false);
        b.classList.remove('on');
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        input.setVirtualKey(key, true);
        b.classList.add('on');
      });
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    }
    el.querySelector<HTMLElement>('[data-ref="pause"]')!.addEventListener('click', onPause);
  }

  /** Atualiza os rótulos dos botões conforme a pé / dirigindo. */
  setMode(mode: HudMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    const driving = mode === 'driving';
    this.labels.Space.textContent = t(driving ? 'touch.handbrake' : 'touch.jump');
    this.labels.ShiftLeft.textContent = t(driving ? 'touch.turbo' : 'touch.run');
    this.labels.KeyE.textContent = t(driving ? 'touch.exit' : 'touch.enter');
    this.labels.KeyH.hidden = !driving;
    this.labels.KeyR.hidden = !driving;
  }

  private moveStick(e: PointerEvent): void {
    const r = this.stick.getBoundingClientRect();
    const radius = r.width / 2;
    let x = (e.clientX - (r.left + radius)) / radius;
    let y = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.knob.style.transform = `translate(${x * radius * 0.6}px, ${y * radius * 0.6}px)`;
    this.input.setVirtualKey('KeyW', y < -DEAD_ZONE);
    this.input.setVirtualKey('KeyS', y > DEAD_ZONE);
    this.input.setVirtualKey('KeyA', x < -DEAD_ZONE);
    this.input.setVirtualKey('KeyD', x > DEAD_ZONE);
  }
}
