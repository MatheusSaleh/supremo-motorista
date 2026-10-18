// Frota oficial do Tribunal: os modelos usados por autoridades em Brasília. Os modelos 3D são fiéis
// (Sketchfab, CC-BY — ver CREDITS.md); os NOMES no jogo são paródias, sem marcas reais. Textos no i18n.
//
// `physics` sobrescreve só o que muda em relação a config.car (o resto continua vindo de lá, inclusive
// os ajustes feitos ao vivo no lil-gui).
import type { Config } from '../config';
import type { StringKey } from '../core/i18n';

type CarParams = Config['car'];

export interface VehicleDef {
  id: string;
  nameKey: StringKey;
  /** Frase ao entrar no carro (e na placa da vaga). */
  taglineKey: StringKey;
  /** Modelo detalhado (Alta/Ultra) e leve (Baixa/Média). */
  model: { hq: string; lq: string };
  /** Cor da pintura; null mantém a do modelo (pintura em textura). */
  paint: number | null;
  /** O modelo já tem interior próprio (o procedural fica escondido; motorista e volante continuam). */
  modelInterior: boolean;
  physics: Partial<Omit<CarParams, 'turbo' | 'offroad'>> & { turbo?: Partial<CarParams['turbo']>; offroad?: Partial<CarParams['offroad']> };
  /** Som do motor: tom e volume relativos (diesel grave, híbrido quase mudo). */
  engine: { pitch: number; volume: number };
  /** Multiplicador da gorjeta (passageiros adoram conforto). */
  tipMul?: number;
  /** Falas extras de embarque (chaves line.board.<id>.N). */
  boardLines?: number;
}

export const FLEET: VehicleDef[] = [
  {
    id: 'sw4',
    nameKey: 'vehicle.sw4.name',
    taglineKey: 'vehicle.sw4.tagline',
    model: { hq: 'models/fleet/sw4.glb', lq: 'models/fleet/sw4.glb' },
    paint: 0x0d0f12,
    modelInterior: false,
    // 4x4 diesel: pesada, menos ágil e mais alta (tomba mais fácil), mas não liga para gramado.
    physics: {
      mass: 2150,
      engineForce: 3300,
      maxSpeed: 33,
      centerOfMassY: -0.18,
      maxSteer: 0.52,
      suspensionStiffness: 26,
      suspensionRest: 0.36,
      frictionSlip: 3.4,
      offroad: { grip: 0.95, maxSpeedMul: 0.95, drag: 0.3 },
    },
    engine: { pitch: 0.78, volume: 1.15 },
    boardLines: 3,
  },
  {
    id: 'corolinha',
    nameKey: 'vehicle.corolinha.name',
    taglineKey: 'vehicle.corolinha.tagline',
    model: { hq: 'models/fleet/corolla.glb', lq: 'models/fleet/corolla-lod.glb' },
    paint: 0xaeb3b9,
    modelInterior: false,
    // Leve e esperto, motor fraco; turbo recarrega rápido ("econômico").
    physics: {
      mass: 1250,
      engineForce: 2250,
      maxSpeed: 33,
      maxSteer: 0.64,
      turbo: { rechargePerSec: 0.2 },
    },
    engine: { pitch: 1.12, volume: 0.9 },
    boardLines: 3,
  },
  {
    id: 'fusao',
    nameKey: 'vehicle.fusao.name',
    taglineKey: 'vehicle.fusao.tagline',
    model: { hq: 'models/fleet/fusion.glb', lq: 'models/fleet/fusion-lod.glb' },
    paint: 0x0e1013,
    modelInterior: false,
    physics: {}, // referência: os valores de config.car
    engine: { pitch: 1, volume: 1 },
    boardLines: 3,
  },
  {
    id: 'equinocio',
    nameKey: 'vehicle.equinocio.name',
    taglineKey: 'vehicle.equinocio.tagline',
    model: { hq: 'models/fleet/equinox.glb', lq: 'models/fleet/equinox-lod.glb' },
    paint: 0x111316,
    modelInterior: false,
    // SUV média: meio-termo em tudo.
    physics: {
      mass: 1650,
      engineForce: 2700,
      maxSpeed: 35,
      centerOfMassY: -0.24,
      maxSteer: 0.56,
      suspensionRest: 0.34,
      offroad: { grip: 0.85, maxSpeedMul: 0.8, drag: 0.7 },
    },
    engine: { pitch: 0.95, volume: 1 },
    boardLines: 3,
  },
  {
    id: 'lexo',
    nameKey: 'vehicle.lexo.name',
    taglineKey: 'vehicle.lexo.tagline',
    model: { hq: 'models/fleet/lexus.glb', lq: 'models/fleet/lexus-lod.glb' },
    paint: 0x2b2f36,
    modelInterior: false,
    // Sedã de luxo híbrido: macio, rápido na reta, "turbo elétrico" que recarrega sozinho, derrapa mal
    // (o controle de estabilidade não deixa); passageiros pagam mais gorjeta.
    physics: {
      mass: 1720,
      engineForce: 2900,
      maxSpeed: 38,
      suspensionStiffness: 30,
      suspensionCompression: 2.2,
      driftRearSideFriction: 0.16,
      driftYawAssist: 4,
      turbo: { rechargePerSec: 0.22, forceMul: 1.6 },
    },
    engine: { pitch: 1.25, volume: 0.45 },
    tipMul: 1.25,
    boardLines: 4,
  },
];

export const DEFAULT_VEHICLE = 'fusao';

/** Parâmetros efetivos de um carro: herda de config.car (ao vivo) e sobrescreve os do modelo. */
export function vehicleParams(base: CarParams, def: VehicleDef | null, wheelRadius?: number): CarParams {
  const p = Object.create(base) as CarParams;
  if (def) {
    const { turbo, offroad, ...rest } = def.physics;
    Object.assign(p, rest);
    if (turbo) p.turbo = Object.assign(Object.create(base.turbo) as CarParams['turbo'], turbo);
    if (offroad) p.offroad = Object.assign(Object.create(base.offroad) as CarParams['offroad'], offroad);
  }
  if (wheelRadius) p.wheelRadius = wheelRadius;
  return p;
}
