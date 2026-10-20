// Fase 10: arquétipos de passageiros (os ministros FICTÍCIOS do Tribunal). Cada um muda as regras da
// corrida, as falas e a conta no fim. Textos no i18n (pt-BR.archetypes.ts).
import type { PoolId } from './rides';

/** Áreas movimentadas (o Discreto não quer ser visto nelas). Eixos: ver world/city/layout.ts. */
export const BUSY_AREAS = [
  { minX: -165, maxX: 165, minZ: -760, maxZ: 930 }, // Esplanada (pistas e gramado central)
  { minX: -130, maxX: 130, minZ: -1310, maxZ: -1000 }, // Praça dos Três Poderes
  { minX: -345, maxX: 265, minZ: 870, maxZ: 1055 }, // Rodoviária e feira
];

export const ARCHETYPE_RULES = {
  orador: {
    /** Intervalo entre discursos (s) e duração de cada um. */
    speechEvery: [9, 15] as [number, number],
    speechSeconds: 7,
    /** Por discurso ouvido inteiro / por interrupção (batida, salto, buzina durante o discurso). */
    speechBonus: 25,
    interruptPenalty: 15,
  },
  palestrante: {
    /** Parada obrigatória no caminho: segundos parado lá e pools onde ela pode ficar. */
    stopSeconds: 2.5,
    stopPools: ['esplanada', 'quadras', 'feira', 'orla', 'tribunal'] as PoolId[],
    /** A parada não pode ficar a menos disto da origem ou do destino (m). */
    stopMinDistance: 250,
    stopBonus: 60,
  },
  novato: {
    /** Chance de ser medroso (senão, empolgado). */
    scaredChance: 0.5,
    /** Medroso: por salto, por segundo de derrapagem, por segundo acima de 100 km/h. */
    scaredJump: 20,
    scaredDrift: 8,
    scaredSpeedKmh: 100,
    scaredSpeed: 3,
    /** Empolgado: multiplica os bônus de salto e derrapagem. */
    thrilledMul: 2,
  },
  presidente: {
    timeMul: 0.8,
    tipMul: 2,
    latePenalty: 80,
    /** Reclama se ficar abaixo disto (km/h) por alguns segundos. */
    slowKmh: 40,
  },
  discreto: {
    /** Bônus inteiro se ninguém o vir; cai com a exposição (segundos em área movimentada; foto vale `photoSeconds`). */
    bonus: 120,
    exposureLimit: 25,
    photoSeconds: 6,
  },
};
