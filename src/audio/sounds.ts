// Manifesto dos sons: id → arquivo(s) em public/audio/, canal e volume base.
// Vários arquivos = variações sorteadas a cada reprodução. Origem/licença de cada um: CREDITS.md.

export type Bus = 'vehicle' | 'sfx' | 'ambient' | 'ui' | 'music';

export interface SoundDef {
  files: string[];
  bus: Bus;
  volume: number;
}

const variants = (base: string, n: number, ext = 'ogg') => Array.from({ length: n }, (_, i) => `${base}_${i}.${ext}`);

export const SOUNDS = {
  // Carro
  engineLoop: { files: ['car/engine_loop.ogg'], bus: 'vehicle', volume: 0.55 },
  engineStart: { files: ['car/engine_start.ogg'], bus: 'vehicle', volume: 0.7 },
  engineStop: { files: ['car/engine_stop.ogg'], bus: 'vehicle', volume: 0.6 },
  horn: { files: ['car/horn.ogg'], bus: 'sfx', volume: 0.75 },
  handbrake: { files: ['car/handbrake.ogg'], bus: 'sfx', volume: 0.5 },
  doorOpen: { files: ['car/door_open.ogg'], bus: 'sfx', volume: 0.7 },
  doorClose: { files: ['car/door_close.ogg'], bus: 'sfx', volume: 0.7 },
  turbo: { files: ['car/turbo.wav'], bus: 'vehicle', volume: 0.6 },
  crashHeavy: { files: ['car/crash_heavy.ogg'], bus: 'sfx', volume: 0.9 },
  impactMedium: { files: variants('car/impact_medium', 3), bus: 'sfx', volume: 0.8 },
  impactLight: { files: variants('car/impact_light', 3), bus: 'sfx', volume: 0.6 },
  impactWood: { files: variants('car/impact_wood', 3), bus: 'sfx', volume: 0.9 },
  carLand: { files: ['car/land.ogg'], bus: 'sfx', volume: 0.9 },

  // Personagem
  stepConcrete: { files: variants('player/step_concrete', 5), bus: 'sfx', volume: 0.45 },
  stepGrass: { files: variants('player/step_grass', 5), bus: 'sfx', volume: 0.5 },
  stepWood: { files: variants('player/step_wood', 5), bus: 'sfx', volume: 0.5 },
  jump: { files: ['player/jump.ogg'], bus: 'sfx', volume: 0.5 },
  playerLand: { files: ['player/land.ogg'], bus: 'sfx', volume: 0.6 },

  // Ambiente
  birdsLoop: { files: ['ambient/birds_loop.wav'], bus: 'ambient', volume: 0.35 },
  cricketsLoop: { files: ['ambient/crickets_loop.mp3'], bus: 'ambient', volume: 0.5 },
  windLoop: { files: ['ambient/wind_loop.ogg'], bus: 'ambient', volume: 0.6 },
  waterLoop: { files: ['ambient/water_loop.ogg'], bus: 'ambient', volume: 0.5 },
  crowdLoop: { files: ['ambient/crowd_loop.ogg'], bus: 'ambient', volume: 0.45 },
  splash: { files: variants('ambient/splash', 2), bus: 'sfx', volume: 0.9 },

  // Interface
  uiClick: { files: ['ui/click.ogg'], bus: 'ui', volume: 0.6 },
  uiToggle: { files: ['ui/toggle.ogg'], bus: 'ui', volume: 0.6 },
  uiOpen: { files: ['ui/open.ogg'], bus: 'ui', volume: 0.6 },
  uiClose: { files: ['ui/close.ogg'], bus: 'ui', volume: 0.6 },
  uiNotify: { files: ['ui/notify.ogg'], bus: 'ui', volume: 0.5 },
  uiError: { files: ['ui/error.ogg'], bus: 'ui', volume: 0.5 },
  uiConfirm: { files: ['ui/confirm.ogg'], bus: 'ui', volume: 0.6 },
} satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;
