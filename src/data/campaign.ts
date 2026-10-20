// Fase 12: campanha (10 dias), manchetes do dia e os três finais. Tudo fictício: Tribunal, ministros,
// Dona Neide (chefe da frota), Gazeta da Tesourinha, Dr. Caixeta. Textos no i18n (pt-BR.campaign.ts).

export const CAMPAIGN = {
  /** Dias de campanha; o final sai no fechamento do último. */
  days: 10,
  /** Demissão: advertências (ver SHIFT.maxWarnings) ou escândalos acumulados. */
  scandalsToFire: 3,
  /** "Sócio do Caixeta": favores aceitos, e mais aceitos que recusados. */
  partnerFavors: 5,
};

export type EndingId = 'exemplar' | 'socio' | 'demitido';

/** Categorias de manchete do dia (a primeira que se aplicar, nesta ordem). */
export type HeadlineKind = 'scandal' | 'favors' | 'chase' | 'late' | 'busy' | 'idle' | 'calm';
export const HEADLINE_VARIANTS = 3;

/** Números do dia que escolhem a manchete. */
export interface DayFacts {
  rides: number;
  late: number;
  favors: number;
  scandals: number;
  chases: number;
}

export function headlineKind(f: DayFacts): HeadlineKind {
  if (f.scandals > 0) return 'scandal';
  if (f.favors >= 2) return 'favors';
  if (f.chases >= 3) return 'chase';
  if (f.late >= 2) return 'late';
  if (f.rides >= 6) return 'busy';
  if (f.rides === 0) return 'idle';
  return 'calm';
}

export interface CareerFacts {
  warnings: number;
  scandals: number;
  favorsAccepted: number;
  favorsDeclined: number;
}

/** Final da campanha: imediato se demitido; no último dia, sócio ou exemplar. */
export function evaluateEnding(f: CareerFacts, maxWarnings: number, lastDay: boolean): EndingId | null {
  if (f.warnings >= maxWarnings || f.scandals >= CAMPAIGN.scandalsToFire) return 'demitido';
  if (!lastDay) return null;
  return f.favorsAccepted >= CAMPAIGN.partnerFavors && f.favorsAccepted > f.favorsDeclined ? 'socio' : 'exemplar';
}
