// HUD em DOM sobreposto ao canvas: minimapa, dica de controles (muda a pé/dirigindo), velocímetro,
// turbo, dica contextual, aviso de captura do mouse, FPS e menu de pausa.
// Não conhece física nem Three.js além do que recebe em update().
import { t } from '../core/i18n';
import type { Settings } from '../core/Settings';
import type { Level } from '../world/Level';
import type { RideView } from '../rides/RideManager';
import { Minimap, type MinimapActor } from './Minimap';
import { FACTIONS, FACTION_IDS, type FactionId } from '../data/factions';
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
  /** Polarização (calor por facção), território atual e perseguidores em cena. */
  polar?: {
    heat: Readonly<Record<FactionId, number>>;
    territory: { text: string; color: string } | null;
    pursuers: number;
    /** Fase 9: Medidor de Suspeição (0–100) e carros da imprensa em cena. */
    suspicion: number;
    press: number;
  };
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
  private readonly polarBars: [FactionId, HTMLElement][];
  private readonly polarBox: HTMLElement;
  private readonly pursuersLabel: HTMLElement;
  private readonly territoryLabel: HTMLElement;
  private lastPolar = '';
  private readonly suspicionBar: HTMLElement;
  private readonly pressLabel: HTMLElement;
  private readonly headline: HTMLElement;
  private headlineTimer = 0;
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
      <div class="hud-env" data-ref="env"><span data-ref="envText"></span><span class="hud-env-badge" data-ref="envBadge" hidden></span>
        <div class="hud-polar" data-ref="polar">
          <div class="hud-polar-title">${t('hud.polarization')}</div>
          ${FACTION_IDS.map((f) => `<div class="hud-polar-row"><span>${t(FACTIONS[f].nameKey)}</span><div class="hud-polar-track"><div class="hud-polar-bar" data-polar="${f}" style="background:${FACTIONS[f].css}"></div></div></div>`).join('')}
          <div class="hud-polar-pursuers" data-ref="pursuers" hidden></div>
          <div class="hud-polar-title hud-suspicion-title">${t('hud.suspicion')}</div>
          <div class="hud-polar-track hud-suspicion-track"><div class="hud-polar-bar hud-suspicion-bar" data-ref="suspicion"></div></div>
          <div class="hud-polar-pursuers" data-ref="press" hidden>${t('hud.press')}</div>
        </div>
        <span class="hud-territory" data-ref="territory" hidden></span>
      </div>
      <div class="hud-controls" data-ref="controls"></div>
      <div class="hud-headline" data-ref="headline" hidden>
        <div class="hud-headline-paper" data-ref="hlPaper"></div>
        <div class="hud-headline-title" data-ref="hlTitle"></div>
        <div class="hud-headline-sub" data-ref="hlSub"></div>
      </div>
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
    this.polarBox = q('polar');
    this.suspicionBar = q('suspicion');
    this.pressLabel = q('press');
    this.headline = q('headline');
    this.pursuersLabel = q('pursuers');
    this.territoryLabel = q('territory');
    this.polarBars = FACTION_IDS.map((f) => [f, root.querySelector<HTMLElement>(`[data-polar="${f}"]`)!]);
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

  /** Manchete de jornal (fictício) no meio da tela por alguns segundos (escândalo da Fase 9). */
  showHeadline(paper: string, title: string, sub: string, seconds = 8): void {
    this.root.querySelector<HTMLElement>('[data-ref="hlPaper"]')!.textContent = paper;
    this.root.querySelector<HTMLElement>('[data-ref="hlTitle"]')!.textContent = title;
    this.root.querySelector<HTMLElement>('[data-ref="hlSub"]')!.textContent = sub;
    this.headline.hidden = false;
    this.headlineTimer = seconds;
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

    if (f.polar) {
      const p = f.polar;
      const key = `${FACTION_IDS.map((id) => Math.round(p.heat[id])).join()}|${p.territory?.text}|${p.pursuers}|${Math.round(p.suspicion)}|${p.press}`;
      if (key !== this.lastPolar) {
        this.lastPolar = key;
        for (const [id, bar] of this.polarBars) bar.style.width = `${Math.round(p.heat[id])}%`;
        this.polarBox.classList.toggle('hot', p.pursuers + p.press > 0);
        this.suspicionBar.style.width = `${Math.round(p.suspicion)}%`;
        this.suspicionBar.classList.toggle('danger', p.suspicion >= 70);
        this.pressLabel.hidden = p.press === 0;
        this.pursuersLabel.hidden = p.pursuers === 0;
        this.pursuersLabel.textContent = t('hud.pursuers', { n: p.pursuers });
        this.territoryLabel.hidden = !p.territory;
        if (p.territory) {
          this.territoryLabel.textContent = p.territory.text;
          this.territoryLabel.style.background = p.territory.color;
        }
      }
    }

    if (this.headlineTimer > 0 && (this.headlineTimer -= f.dt) <= 0) this.headline.hidden = true;

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
