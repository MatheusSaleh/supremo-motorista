// Fase 11: expediente (dias de trabalho), contracheque, Oficina do Tribunal (melhorias e carros) e o que
// entra no salvamento. Textos no i18n (pt-BR.career.ts).
import type { StringKey } from '../core/i18n';

export const SHIFT = {
  /** Duração de um expediente (segundos de jogo, sem contar pausas e menus). */
  seconds: 8 * 60,
  /** Meta de faturamento do dia: base + aumento por dia, até o teto. */
  goalBase: 900,
  goalPerDay: 300,
  goalMax: 3000,
  /** Contracheque no fim do dia: diária fixa sempre; "auxílio-paletó" se bateu a meta. */
  salary: 200,
  suitAllowance: 150,
  /** Bônus extra se passou a meta em 50%. */
  overachieveMul: 1.5,
  overachieveBonus: 250,
  /** Advertências por não bater a meta; nesta quantidade, a demissão fica iminente (Fase 12). */
  maxWarnings: 3,
  /** Aviso de fim de expediente (s antes). */
  warnAt: 60,
};

export function dailyGoal(day: number): number {
  return Math.min(SHIFT.goalMax, SHIFT.goalBase + SHIFT.goalPerDay * (day - 1));
}

export type UpgradeId = 'motor' | 'pneus' | 'turbo' | 'suspensao' | 'seguro' | 'pelicula';

export interface UpgradeDef {
  id: UpgradeId;
  nameKey: StringKey;
  descKey: StringKey;
  /** Preço de cada nível (o tamanho da lista é o nível máximo). */
  prices: number[];
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'motor', nameKey: 'upgrade.motor', descKey: 'upgrade.motor.desc', prices: [600, 1200, 2200] },
  { id: 'pneus', nameKey: 'upgrade.pneus', descKey: 'upgrade.pneus.desc', prices: [400, 900, 1600] },
  { id: 'turbo', nameKey: 'upgrade.turbo', descKey: 'upgrade.turbo.desc', prices: [500, 1100, 2000] },
  { id: 'suspensao', nameKey: 'upgrade.suspensao', descKey: 'upgrade.suspensao.desc', prices: [350, 800] },
  { id: 'seguro', nameKey: 'upgrade.seguro', descKey: 'upgrade.seguro.desc', prices: [300, 700, 1300] },
  { id: 'pelicula', nameKey: 'upgrade.pelicula', descKey: 'upgrade.pelicula.desc', prices: [800, 1800] },
];

/** Efeito por nível de cada melhoria (aplicado em todos os carros da frota). */
export const UPGRADE_EFFECTS = {
  /** Força do motor e velocidade máxima. */
  motorForce: 0.1,
  motorSpeed: 0.04,
  /** Aderência (atrito longitudinal e lateral). */
  grip: 0.08,
  /** Recarga e força do turbo. */
  turboRecharge: 0.25,
  turboForce: 0.08,
  /** Rigidez da suspensão (menos balanço, desvira mais rápido). */
  stiffness: 0.12,
  /** Seguro: reduz multas de batida, patrimônio e lago. */
  insurance: 0.25,
  /** Película escura: reduz a suspeição das fotos da imprensa. */
  tint: 0.3,
};

/** Carros que precisam ser comprados na Oficina (os outros já vêm liberados). */
export const CAR_PRICES: Record<string, number> = {
  equinocio: 1500,
  sw4: 2500,
  lexo: 6000,
};

export const SAVE_KEY = 'supremo.save.v1';
