// Teclas de cada modo, usadas na barra inferior do HUD e no menu de pausa.
import { t, type StringKey } from '../core/i18n';

export type HudMode = 'onFoot' | 'driving';

/** Lista de controles exibida na barra inferior e no menu de pausa. */
export const CONTROL_HINTS: Record<HudMode, { keys: string[]; label: StringKey }[]> = {
  onFoot: [
    { keys: ['W', 'A', 'S', 'D'], label: 'controls.move' },
    { keys: ['Shift'], label: 'controls.run' },
    { keys: ['key.space'], label: 'controls.jump' },
    { keys: ['E'], label: 'controls.enterCar' },
    { keys: ['Enter'], label: 'controls.accept' },
    { keys: ['key.mouse'], label: 'controls.camera' },
    { keys: ['Esc'], label: 'controls.pause' },
  ],
  driving: [
    { keys: ['W', 'S'], label: 'controls.drive' },
    { keys: ['A', 'D'], label: 'controls.steer' },
    { keys: ['key.space'], label: 'controls.handbrake' },
    { keys: ['Shift'], label: 'controls.turbo' },
    { keys: ['H'], label: 'controls.horn' },
    { keys: ['C'], label: 'controls.camera.toggle' },
    { keys: ['Enter'], label: 'controls.accept' },
    { keys: ['E'], label: 'controls.exitCar' },
    { keys: ['R'], label: 'controls.resetCar' },
    { keys: ['Esc'], label: 'controls.pause' },
  ],
};

/** Nome de tecla: chaves 'key.*' são traduzidas; o resto é literal (W, Shift…). */
export function keyLabel(k: string): string {
  return k.startsWith('key.') ? t(k as StringKey) : k;
}

export function renderControls(mode: HudMode): string {
  return CONTROL_HINTS[mode]
    .map((h) => `<span>${h.keys.map((k) => `<kbd>${keyLabel(k)}</kbd>`).join('')} ${t(h.label)}</span>`)
    .join('');
}
