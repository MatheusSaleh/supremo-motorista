// Preferências do jogador (qualidade gráfica etc.), salvas no localStorage.

import type { Volumes } from '../audio/AudioSystem';

export type QualityPreset = 'baixa' | 'media' | 'alta' | 'ultra' | 'personalizada';

export interface Settings {
  quality: QualityPreset;
  shadows: boolean;
  shadowMapSize: number;
  /** Teto do pixel ratio (multiplicado pela resolução da tela, limitado ao devicePixelRatio). */
  resolution: number;
  /** Meia-largura (m) da área com sombras ao redor do jogador. */
  shadowRange: number;
  /** Multiplicador da distância em que árvores, postes e placas ainda são desenhados. */
  drawDistance: number;
  showFps: boolean;
  /** Minimapa gira junto com a câmera (true) ou fica com o norte para cima (false). */
  minimapRotate: boolean;
  /** Clima, horário e feriados reais de Brasília (APIs públicas); desligado = 14h, céu limpo. */
  realWorld: boolean;
  audio: Volumes;
}

type PresetFields = Pick<Settings, 'shadows' | 'shadowMapSize' | 'resolution' | 'shadowRange' | 'drawDistance'>;

export const QUALITY_PRESETS: Record<Exclude<QualityPreset, 'personalizada'>, PresetFields> = {
  baixa: { shadows: false, shadowMapSize: 1024, resolution: 0.75, shadowRange: 50, drawDistance: 0.6 },
  media: { shadows: true, shadowMapSize: 1024, resolution: 1, shadowRange: 70, drawDistance: 1 },
  alta: { shadows: true, shadowMapSize: 2048, resolution: 2, shadowRange: 90, drawDistance: 1.6 },
  // Para PCs fortes (e a versão desktop): sombra 4096 cobrindo 300 m, e desenha tudo até a neblina.
  ultra: { shadows: true, shadowMapSize: 4096, resolution: 2, shadowRange: 150, drawDistance: 4 },
};

const STORAGE_KEY = 'esplanada3d.settings.v1';

export function defaultSettings(): Settings {
  // Telas de alta densidade custam caro; começa no médio e o jogador sobe se quiser.
  return {
    quality: 'media',
    ...QUALITY_PRESETS.media,
    showFps: false,
    minimapRotate: true,
    realWorld: true,
    audio: { master: 0.8, vehicle: 1, sfx: 1, ambient: 0.8, ui: 0.8, music: 0.6, muted: false },
  };
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      const merged = { ...base, ...saved, audio: { ...base.audio, ...saved.audio } };
      // Configurações salvas antes dos campos novos: completa com o preset escolhido.
      const preset = merged.quality !== 'personalizada' ? QUALITY_PRESETS[merged.quality] : QUALITY_PRESETS.media;
      merged.shadowRange = saved.shadowRange ?? preset.shadowRange;
      merged.drawDistance = saved.drawDistance ?? preset.drawDistance;
      return merged;
    }
  } catch {
    /* storage bloqueado ou JSON inválido: usa o padrão */
  }
  return base;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignora: preferências só não persistem */
  }
}
