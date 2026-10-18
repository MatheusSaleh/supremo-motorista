// HUD em DOM sobreposto ao canvas: minimapa, dica de controles (muda a pé/dirigindo), velocímetro,
// turbo, dica contextual, aviso de captura do mouse, FPS e menu de pausa.
// Não conhece física nem Three.js além do que recebe em update().
import { t } from '../core/i18n';
import type { Settings } from '../core/Settings';
import type { Level } from '../world/Level';
import type { RideView } from '../rides/RideManager';
import { Minimap, type MinimapActor } from './Minimap';
import { RideHud } from './RideHud';
import { renderControls, type HudMode } from './controls';
import { PauseMenu, type PauseMenuCallbacks } from './PauseMenu';
import type { TouchControls } from './TouchControls';

export type { HudMode };

export interface HudFrame {
  dt: number;
  player: MinimapActor;
  cameraYaw: number;
  pointerLocked: boolean;
  paused: boolean;
  mode: HudMode;
  car: { speedKmh: number; turbo: number; turboActive: boolean } | null;
  /** Dica contextual (ex.: tecla E + "Entrar no carro") ou mensagem temporária. */
  prompt: { key?: string; text: string } | null;
  others?: readonly MinimapActor[];
  ride?: RideView;
  /** Posição na tela para o balão do passageiro. */
  bubbleAt?: { x: number; y: number } | null;
  /** Clima e hora de Brasília ("☀ 27°C · 55% · 14:00") e selo de feriado. */
  env?: { text: string; badge: string | null };
}

export class Hud {
  readonly pauseMenu: PauseMenu;
  private readonly rideHud: RideHud;
  private readonly minimap: Minimap;
  private readonly lockHint: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly envText: HTMLElement;
  private readonly envBadge: HTMLElement;
  private lastEnv = '';
  private readonly carPanel: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly turboBar: HTMLElement;
  private mode: HudMode | null = null;
  private lastPrompt = '';
  private lastSpeed = -1;
  private fpsFrames = 0;
  private fpsTime = 0;
  private readonly onResize = () => this.minimap.resize();

  constructor(
    private readonly root: HTMLElement,
    level: Level,
    private settings: Settings,
    callbacks: PauseMenuCallbacks,
    private readonly touch: TouchControls | null = null,
    onAcceptRide: () => void = () => {},
  ) {
    root.innerHTML = `
      <div class="hud-hint" data-ref="lock">${t('hud.clickToLook')}</div>
      <div class="hud-fps" data-ref="fps" hidden></div>
      <div class="hud-prompt" data-ref="prompt" hidden></div>
      <div class="hud-env" data-ref="env"><span data-ref="envText"></span><span class="hud-env-badge" data-ref="envBadge" hidden></span></div>
      <div class="hud-controls" data-ref="controls"></div>
      <div class="hud-car" data-ref="car" hidden>
        <div class="hud-speed"><span data-ref="speed">0</span><small>${t('hud.speedUnit')}</small></div>
        <div class="hud-turbo">
          <span>${t('hud.turbo')}</span>
          <div class="hud-turbo-track"><div class="hud-turbo-bar" data-ref="turbo"></div></div>
        </div>
      </div>`;
    const q = (ref: string) => root.querySelector<HTMLElement>(`[data-ref="${ref}"]`)!;
    this.lockHint = q('lock');
    this.fps = q('fps');
    this.prompt = q('prompt');
    this.envText = q('envText');
    this.envBadge = q('envBadge');
    this.controls = q('controls');
    this.carPanel = q('car');
    this.speed = q('speed');
    this.turboBar = q('turbo');

    this.minimap = new Minimap(level, window.innerWidth < 600 ? 130 : 190);
    if (touch) {
      root.classList.add('touch');
      root.appendChild(touch.element);
    }
    root.appendChild(this.minimap.element);

    this.rideHud = new RideHud(root, onAcceptRide, touch !== null);
    this.pauseMenu = new PauseMenu(settings, callbacks);
    root.appendChild(this.pauseMenu.element);
    window.addEventListener('resize', this.onResize);
  }

  setMinimapImage(image: HTMLCanvasElement): void {
    this.minimap.image = image;
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.fps.hidden = !s.showFps;
  }

  update(f: HudFrame): void {
    this.pauseMenu.visible = f.paused;
    this.lockHint.hidden = f.pointerLocked || f.paused || this.touch !== null;
    this.touch?.setMode(f.mode);
    // Dirigindo, o minimapa mostra uma área maior (transição suave).
    const radius = f.mode === 'driving' ? 340 : 160;
    this.minimap.viewRadius += (radius - this.minimap.viewRadius) * Math.min(1, f.dt * 3);
    const markers = f.ride?.target ? [{ x: f.ride.target.x, z: f.ride.target.z, color: f.ride.target.kind === 'pickup' ? '#ffd34d' : '#3ddc84' }] : [];
    this.minimap.draw(f.player, f.cameraYaw, this.settings.minimapRotate, f.others, markers);
    if (f.ride) this.rideHud.update(f.ride, f.bubbleAt ?? null);

    if (f.mode !== this.mode) {
      this.mode = f.mode;
      this.controls.innerHTML = renderControls(f.mode);
    }

    // Só mexe no DOM quando algo muda.
    const promptHtml = f.prompt && !f.paused ? `${f.prompt.key ? `<kbd>${f.prompt.key}</kbd> ` : ''}${f.prompt.text}` : '';
    if (promptHtml !== this.lastPrompt) {
      this.lastPrompt = promptHtml;
      this.prompt.innerHTML = promptHtml;
      this.prompt.hidden = promptHtml === '';
    }

    // Clima/horário (texto já pronto; só toca no DOM quando muda).
    const envKey = `${f.env?.text}|${f.env?.badge}`;
    if (f.env && envKey !== this.lastEnv) {
      this.lastEnv = envKey;
      this.envText.textContent = f.env.text;
      this.envBadge.textContent = f.env.badge ?? '';
      this.envBadge.hidden = !f.env.badge;
    }

    this.carPanel.hidden = !f.car;
    if (f.car) {
      const kmh = Math.round(f.car.speedKmh);
      if (kmh !== this.lastSpeed) {
        this.lastSpeed = kmh;
        this.speed.textContent = String(kmh);
      }
      this.turboBar.style.width = `${(f.car.turbo * 100).toFixed(1)}%`;
      this.turboBar.classList.toggle('active', f.car.turboActive);
    }

    if (this.settings.showFps) {
      this.fpsFrames++;
      this.fpsTime += f.dt;
      if (this.fpsTime >= 0.5) {
        this.fps.textContent = `${Math.round(this.fpsFrames / this.fpsTime)} FPS`;
        this.fpsFrames = 0;
        this.fpsTime = 0;
      }
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.root.innerHTML = '';
  }
}
