// Menu de pausa com ajustes de qualidade. Só manipula Settings; quem aplica é o Game (via onChange).
import { desktop } from '../core/desktop';
import { t } from '../core/i18n';
import { QUALITY_PRESETS, type QualityPreset, type Settings } from '../core/Settings';
import { CONTROL_HINTS, keyLabel, type HudMode } from './controls';

export interface PauseMenuCallbacks {
  onResume: () => void;
  onChange: (settings: Settings) => void;
  /** Fase 11: apagar o progresso e começar do dia 1. */
  onNewGame?: () => void;
  /** Fase 12: salvar e voltar ao menu principal. */
  onToMenu?: () => void;
}

const DRAW_DISTANCES: [number, 'pause.draw.short' | 'pause.draw.medium' | 'pause.draw.long' | 'pause.draw.max'][] = [
  [0.6, 'pause.draw.short'],
  [1, 'pause.draw.medium'],
  [1.6, 'pause.draw.long'],
  [4, 'pause.draw.max'],
];

const RESOLUTIONS: [number, string][] = [
  [0.5, '50%'],
  [0.75, '75%'],
  [1, '100%'],
  [2, ''], // rótulo traduzido abaixo
];

function controlsList(mode: HudMode): string {
  return CONTROL_HINTS[mode]
    .filter((h) => h.label !== 'controls.pause')
    .map((h) => `<li>${h.keys.map((k) => `<kbd>${keyLabel(k)}</kbd>`).join('')} ${t(h.label)}</li>`)
    .join('');
}

export class PauseMenu {
  readonly element: HTMLElement;
  private readonly quality: HTMLSelectElement;
  private readonly shadows: HTMLInputElement;
  private readonly resolution: HTMLSelectElement;
  private readonly showFps: HTMLInputElement;
  private readonly minimapRotate: HTMLInputElement;
  private readonly realWorld: HTMLInputElement;
  private readonly draw: HTMLSelectElement;
  private readonly muted: HTMLInputElement;
  private readonly careerInfo: HTMLElement;
  private readonly volumeInputs: HTMLInputElement[];

  constructor(
    private settings: Settings,
    private readonly cb: PauseMenuCallbacks,
  ) {
    const el = document.createElement('div');
    el.className = 'hud-pause';
    el.hidden = true;
    el.innerHTML = `
      <div class="hud-panel" role="dialog" aria-label="${t('pause.title')}">
        <div class="hud-panel-head">
          <h1>${t('pause.title')}</h1>
          <button type="button" class="hud-primary" data-ref="resume">${t('pause.resume')}</button>
        </div>
        <div class="hud-tabs" role="tablist">
          <button type="button" role="tab" data-tab="graphics" aria-selected="true">${t('pause.graphics')}</button>
          <button type="button" role="tab" data-tab="audio" aria-selected="false">${t('pause.audio')}</button>
          <button type="button" role="tab" data-tab="controls" aria-selected="false">${t('pause.controls')}</button>
          <button type="button" role="tab" data-tab="career" aria-selected="false">${t('pause.career')}</button>
        </div>
        <section data-panel="graphics">
          <label>${t('pause.quality')}
            <select data-ref="quality">
              <option value="baixa">${t('pause.quality.baixa')}</option>
              <option value="media">${t('pause.quality.media')}</option>
              <option value="alta">${t('pause.quality.alta')}</option>
              <option value="ultra">${t('pause.quality.ultra')}</option>
              <option value="personalizada" disabled>${t('pause.quality.personalizada')}</option>
            </select>
          </label>
          <p class="hud-note">${t('pause.quality.carNote')}</p>
          <label>${t('pause.resolution')}
            <select data-ref="resolution">
              ${RESOLUTIONS.map(([v, label]) => `<option value="${v}">${label || t('pause.resolution.native')}</option>`).join('')}
            </select>
          </label>
          <label>${t('pause.draw')}
            <select data-ref="draw">
              ${DRAW_DISTANCES.map(([v, key]) => `<option value="${v}">${t(key)}</option>`).join('')}
            </select>
          </label>
          <label class="hud-check"><input type="checkbox" data-ref="shadows" /> ${t('pause.shadows')}</label>
          <label class="hud-check"><input type="checkbox" data-ref="fps" /> ${t('pause.showFps')}</label>
          <label class="hud-check"><input type="checkbox" data-ref="rotate" /> ${t('pause.minimapRotate')}</label>
          <label class="hud-check"><input type="checkbox" data-ref="realWorld" /> ${t('pause.realWorld')}</label>
          <div data-ref="desktop" hidden>
            <h2>${t('pause.desktop')}</h2>
            <label class="hud-check"><input type="checkbox" data-ref="fullscreen" /> ${t('pause.desktop.fullscreen')}</label>
            <label class="hud-check"><input type="checkbox" data-ref="uncapped" /> ${t('pause.desktop.uncapped')}</label>
            <p class="hud-note" data-ref="restart" hidden>${t('pause.desktop.restartNote')}
              <button type="button" class="hud-secondary" data-ref="relaunch">${t('pause.desktop.restart')}</button></p>
            <p class="hud-note" data-ref="gpu"></p>
            <button type="button" class="hud-secondary" data-ref="quit">${t('pause.desktop.quit')}</button>
          </div>
        </section>
        <section data-panel="audio" hidden>
          ${(['master', 'music', 'vehicle', 'sfx', 'ambient', 'ui'] as const)
            .map((k) => `<label>${t(`pause.audio.${k}`)}<input type="range" min="0" max="100" step="5" data-vol="${k}" /></label>`)
            .join('')}
          <label class="hud-check"><input type="checkbox" data-ref="muted" /> ${t('pause.audio.muted')}</label>
        </section>
        <section data-panel="career" hidden>
          <div data-ref="careerInfo"></div>
          <button type="button" class="hud-secondary" data-ref="toMenu">${t('menu.toMenu')}</button>
          <button type="button" class="hud-secondary" data-ref="newGame">${t('career.reset')}</button>
        </section>
        <section data-panel="controls" class="hud-controls-grid" hidden>
          <div><h3>${t('pause.controls.onFoot')}</h3><ul class="hud-keys">${controlsList('onFoot')}</ul></div>
          <div><h3>${t('pause.controls.driving')}</h3><ul class="hud-keys">${controlsList('driving')}</ul></div>
          <p class="hud-keys"><kbd>Esc</kbd> ${t('pause.controls.pauseToggle')}</p>
        </section>
      </div>`;
    this.element = el;

    const q = <T extends HTMLElement>(ref: string) => el.querySelector<T>(`[data-ref="${ref}"]`)!;
    this.quality = q('quality');
    this.shadows = q('shadows');
    this.resolution = q('resolution');
    this.showFps = q('fps');
    this.minimapRotate = q('rotate');
    this.realWorld = q('realWorld');
    this.draw = q('draw');
    this.draw.addEventListener('change', () => this.update({ quality: 'personalizada', drawDistance: Number(this.draw.value) }));
    if (desktop) this.setupDesktop(q);
    this.muted = q('muted');
    this.careerInfo = q('careerInfo');
    q('toMenu').addEventListener('click', () => this.cb.onToMenu?.());
    q('newGame').addEventListener('click', () => {
      if (window.confirm(t('career.resetConfirm'))) this.cb.onNewGame?.();
    });
    this.volumeInputs = [...el.querySelectorAll<HTMLInputElement>('[data-vol]')];
    for (const input of this.volumeInputs) {
      input.addEventListener('input', () => {
        const key = input.dataset.vol as 'master' | 'vehicle' | 'sfx' | 'ambient' | 'ui';
        this.update({ audio: { ...this.settings.audio, [key]: Number(input.value) / 100 } });
      });
    }
    this.muted.addEventListener('change', () => this.update({ audio: { ...this.settings.audio, muted: this.muted.checked } }));

    q<HTMLButtonElement>('resume').addEventListener('click', () => cb.onResume());
    // Abas: mostra só o painel escolhido (menu cabe na tela sem rolar).
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('[data-tab]')];
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        for (const other of tabs) other.setAttribute('aria-selected', String(other === tab));
        for (const panel of el.querySelectorAll<HTMLElement>('[data-panel]')) panel.hidden = panel.dataset.panel !== tab.dataset.tab;
      });
    }
    this.quality.addEventListener('change', () => {
      const preset = this.quality.value as QualityPreset;
      if (preset !== 'personalizada') this.update({ quality: preset, ...QUALITY_PRESETS[preset] });
    });
    this.shadows.addEventListener('change', () => this.update({ quality: 'personalizada', shadows: this.shadows.checked }));
    this.resolution.addEventListener('change', () =>
      this.update({ quality: 'personalizada', resolution: Number(this.resolution.value) }),
    );
    this.showFps.addEventListener('change', () => this.update({ showFps: this.showFps.checked }));
    this.minimapRotate.addEventListener('change', () => this.update({ minimapRotate: this.minimapRotate.checked }));
    this.realWorld.addEventListener('change', () => this.update({ realWorld: this.realWorld.checked }));
    this.sync();
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  set visible(v: boolean) {
    this.element.hidden = !v;
  }

  /** Opções que só existem no app desktop (Electron). */
  private setupDesktop(q: <T extends HTMLElement>(ref: string) => T): void {
    const d = desktop!;
    q('desktop').hidden = false;
    const fullscreen = q<HTMLInputElement>('fullscreen');
    const uncapped = q<HTMLInputElement>('uncapped');
    const restart = q('restart');
    void d.getConfig().then((cfg) => {
      fullscreen.checked = cfg.fullscreen;
      uncapped.checked = cfg.uncappedFps;
      // A flag de FPS só vale a partir da próxima abertura: lembra o valor com que o app subiu.
      uncapped.dataset.atLaunch = String(cfg.uncappedFps);
    });
    fullscreen.addEventListener('change', () => void d.setConfig({ fullscreen: fullscreen.checked }));
    uncapped.addEventListener('change', () => {
      void d.setConfig({ uncappedFps: uncapped.checked });
      restart.hidden = String(uncapped.checked) === uncapped.dataset.atLaunch;
    });
    q('relaunch').addEventListener('click', () => d.relaunch());
    q('quit').addEventListener('click', () => d.quit());
    void d.gpuInfo().then((info) => {
      q('gpu').textContent = t('pause.desktop.gpu', { gpu: webglRendererName(), webgpu: info.webgpu.startsWith('enabled') ? '✓' : '✗' });
    });
  }

  /** Linhas da aba Carreira (texto pronto). */
  setCareer(lines: string[]): void {
    this.careerInfo.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  }

  private update(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    this.sync();
    this.cb.onChange(this.settings);
  }

  /** Reflete as configurações atuais nos controles. */
  private sync(): void {
    const s = this.settings;
    this.quality.value = s.quality;
    this.shadows.checked = s.shadows;
    this.resolution.value = String(s.resolution);
    this.showFps.checked = s.showFps;
    this.minimapRotate.checked = s.minimapRotate;
    this.realWorld.checked = s.realWorld;
    this.draw.value = String(s.drawDistance);
    this.muted.checked = s.audio.muted;
    for (const input of this.volumeInputs) {
      input.value = String(Math.round(s.audio[input.dataset.vol as 'master'] * 100));
    }
  }
}

/** Nome da GPU que o WebGL está usando (ex.: "NVIDIA GeForce RTX 3060"), sem o prefixo ANGLE. */
function webglRendererName(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  const raw = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '?';
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  // "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x...) Direct3D11 ...)" → "NVIDIA GeForce RTX 3060"
  const m = /^ANGLE \([^,]+, ([^(,]+)/.exec(raw);
  return (m ? m[1] : raw).trim();
}
