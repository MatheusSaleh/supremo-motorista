// Frota oficial do Tribunal: carros FICTÍCIOS (montadoras e modelos inventados), gerados em código por
// src/vehicle/carDesign.ts. Cada um lembra uma categoria comum nas frotas oficiais (SUV grande, sedã compacto,
// sedã executivo, SUV média, sedã de luxo), sem copiar o desenho de nenhum carro real. Textos no i18n.
//
// `physics` sobrescreve só o que muda em relação a config.car (o resto continua vindo de lá, inclusive
// os ajustes feitos ao vivo no lil-gui).
import type { Config } from '../config';
import type { StringKey } from '../core/i18n';
import type { CarDesign } from '../vehicle/carDesign';

type CarParams = Config['car'];

export interface VehicleDef {
  id: string;
  nameKey: StringKey;
  /** Frase ao entrar no carro (e na placa da vaga). */
  taglineKey: StringKey;
  /** Desenho do carro (carroceria, rodas, faróis…). */
  design: CarDesign;
  /** Cor da pintura; null mantém a do desenho. */
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
    design: {
      // SUV grande de chassi, alta e quadrada, com três janelas laterais e barras no teto.
      length: 4.8, width: 1.86, height: 1.8, axles: [1.41, -1.32], track: 0.77, wheelRadius: 0.37, tireWidth: 0.26,
      sill: 0.42, belt: 1.22, hood: 1.12, deck: 1.2, noseRound: 0.3, tailRound: 0.2,
      glass: { base: 1.1, roofFront: 0.44, roofRear: -2.0, rear: -2.2, roofHalf: 0.72 },
      bPillar: -0.22, midPillar: -1.2, cPillar: -1.98, clad: 0.12,
      style: { grille: 'bars', tail: 'corners', headlight: { height: 0.13, inner: 0.42, wrap: 0.16 }, rails: true, rim: { spokes: 6, color: 0x55595f } },
    },
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
    design: {
      // Sedã compacto de três volumes, linhas suaves.
      length: 4.63, width: 1.78, height: 1.44, axles: [1.38, -1.3], track: 0.76, wheelRadius: 0.318, tireWidth: 0.215,
      sill: 0.22, belt: 0.93, hood: 0.74, deck: 0.9, noseRound: 0.5, tailRound: 0.32,
      glass: { base: 1.0, roofFront: 0.36, roofRear: -0.9, rear: -1.55, roofHalf: 0.63 },
      bPillar: -0.16, cPillar: -1.02, clad: 0.04,
      style: { grille: 'wide', tail: 'corners', headlight: { height: 0.09, inner: 0.36, wrap: 0.2 }, rim: { spokes: 10, color: 0xb9bdc3 } },
    },
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
    design: {
      // Sedã executivo médio, o "carro de ministro" clássico: capô longo, teto em arco.
      length: 4.87, width: 1.85, height: 1.46, axles: [1.47, -1.35], track: 0.78, wheelRadius: 0.338, tireWidth: 0.235,
      sill: 0.24, belt: 0.96, hood: 0.78, deck: 0.92, noseRound: 0.45, tailRound: 0.34,
      glass: { base: 1.06, roofFront: 0.4, roofRear: -0.95, rear: -1.62, roofHalf: 0.66 },
      bPillar: -0.18, cPillar: -1.08, clad: 0.05,
      style: { grille: 'slot', tail: 'corners', headlight: { height: 0.08, inner: 0.4, wrap: 0.22 }, chrome: true, rim: { spokes: 5, color: 0xc4c8ce, twin: true } },
    },
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
    design: {
      // SUV média urbana: teto preto, vidro traseiro inclinado, plásticos nas caixas de roda.
      length: 4.64, width: 1.84, height: 1.68, axles: [1.36, -1.34], track: 0.74, wheelRadius: 0.375, tireWidth: 0.24,
      sill: 0.36, belt: 1.1, hood: 1.0, deck: 1.07, noseRound: 0.36, tailRound: 0.24,
      glass: { base: 1.06, roofFront: 0.38, roofRear: -1.78, rear: -2.08, roofHalf: 0.68 },
      bPillar: -0.2, cPillar: -1.68, clad: 0.12,
      style: { grille: 'wide', tail: 'corners', headlight: { height: 0.07, inner: 0.38, wrap: 0.24 }, blackRoof: true, rim: { spokes: 5, color: 0x3a3d42, twin: true } },
    },
    paint: 0xe6e6e1, // branco com teto preto ("Branco, para combinar com as minhas decisões")
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
    design: {
      // Sedã de luxo híbrido, longo e baixo: grade alta cromada, lanterna de ponta a ponta, frisos cromados.
      length: 4.97, width: 1.86, height: 1.45, axles: [1.47, -1.38], track: 0.81, wheelRadius: 0.358, tireWidth: 0.24,
      sill: 0.23, belt: 0.96, hood: 0.8, deck: 0.94, noseRound: 0.42, tailRound: 0.3,
      glass: { base: 1.12, roofFront: 0.42, roofRear: -1.0, rear: -1.72, roofHalf: 0.66 },
      bPillar: -0.2, cPillar: -1.12, clad: 0.04,
      style: { grille: 'tall', tail: 'bar', headlight: { height: 0.07, inner: 0.44, wrap: 0.26 }, chrome: true, rim: { spokes: 12, color: 0xd2d5da } },
    },
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
