// Dados das corridas: passageiros (ministros FICTÍCIOS do "Tribunal"), modelos de corrida, regras de
// pagamento e as falas por gatilho. Todos os textos ficam no i18n (pt-BR.rides.ts); aqui só chaves.
//
// Regra de conteúdo: corridas só usam endereços dos pools abaixo (setores fictícios). Marcos reais
// (TST, PGR, PF, QG, Planalto, Catedral…) são só cenário e NUNCA entram como origem ou destino.
import type { StringKey } from '../core/i18n';
import type { FavorKind } from './banker';
import type { FactionId } from './factions';

/** Arquétipos (comportamentos próprios chegam na Fase 10). */
export type Archetype = 'orador' | 'palestrante' | 'novato' | 'presidente' | 'discreto' | 'banqueiro';

export interface Passenger {
  id: string;
  nameKey: StringKey;
  archetype: Archetype;
  /** Simpatia por uma das facções fictícias (null = neutro). Mexe com a polarização. */
  faction: FactionId | null;
}

export const PASSENGERS: Passenger[] = [
  { id: 'tiburcio', nameKey: 'passenger.tiburcio', archetype: 'orador', faction: 'vermelhos' },
  { id: 'clotilde', nameKey: 'passenger.clotilde', archetype: 'palestrante', faction: 'amarelos' },
  { id: 'anselmo', nameKey: 'passenger.anselmo', archetype: 'novato', faction: null },
  { id: 'dulce', nameKey: 'passenger.dulce', archetype: 'presidente', faction: 'amarelos' },
  { id: 'euclides', nameKey: 'passenger.euclides', archetype: 'discreto', faction: 'vermelhos' },
  // Só nos favores (Fase 9): nunca aparece nas corridas comuns.
  { id: 'caixeta', nameKey: 'passenger.caixeta', archetype: 'banqueiro', faction: null },
];

/** Pools de endereços (prefixos de id de AddressPoint). */
export const POOLS = {
  tribunal: ['tribunal'],
  esplanada: ['emb-'],
  orla: ['restaurante-'],
  mansoes: ['mansao-'],
  quadras: ['sqb-'],
  feira: ['feira-', 'rodoviaria'],
  aeroporto: ['aeroporto-embarque'],
  banco: ['banco'],
  // Cidade densa (M7): setores fictícios novos. Ficam de fora os endereços em marcos reais (UnB, Setor
  // Militar Urbano, Parque da Cidade, Feira da Torre, PF…), que são só cenário.
  casas: ['shg-'],
  comercio: ['clq-', 'scc-', 'sdv-'],
  bancario: ['sbc-'],
  hoteis: ['sht-'],
  autarquias: ['saa-', 'sga-', 'anexo-'],
  embaixadas: ['sed-'],
  clubes: ['scl-'],
  tv: ['srt-'],
  pontao: ['pontao'],
} satisfies Record<string, string[]>;

export type PoolId = keyof typeof POOLS;

export interface RideTemplate {
  id: string;
  from: PoolId[];
  to: PoolId[];
  /** Motivo da corrida (anunciado pelo rádio). */
  reasonKey: StringKey;
  /** Passageiros possíveis (vazio = qualquer um). */
  passengers?: string[];
  weight?: number;
  /** Favor do Dr. Caixeta (Fase 9): oferecido pelo celular, paga "consultoria" e aumenta a suspeição. */
  favor?: FavorKind;
  /** Distância máxima própria (m), no lugar de RIDE_TIMING.maxDistance. */
  maxDistance?: number;
}

export const RIDES: RideTemplate[] = [
  { id: 'almoco-orla', from: ['tribunal', 'esplanada'], to: ['orla'], reasonKey: 'ride.reason.almoco', weight: 3 },
  { id: 'jantar-mansao', from: ['tribunal', 'orla'], to: ['mansoes'], reasonKey: 'ride.reason.jantar', weight: 2 },
  { id: 'sessao', from: ['mansoes', 'quadras', 'orla', 'casas', 'hoteis'], to: ['tribunal'], reasonKey: 'ride.reason.sessao', weight: 3 },
  { id: 'reuniao-ministerio', from: ['tribunal', 'quadras'], to: ['esplanada'], reasonKey: 'ride.reason.reuniao', weight: 2 },
  { id: 'voo', from: ['tribunal', 'mansoes', 'esplanada'], to: ['aeroporto'], reasonKey: 'ride.reason.voo', weight: 2 },
  { id: 'feira', from: ['tribunal', 'quadras'], to: ['feira'], reasonKey: 'ride.reason.feira', weight: 1 },
  { id: 'casa', from: ['tribunal', 'esplanada'], to: ['quadras', 'mansoes', 'casas'], reasonKey: 'ride.reason.casa', weight: 2 },
  // Cidade densa (M7).
  { id: 'hotel-comitiva', from: ['aeroporto'], to: ['hoteis'], reasonKey: 'ride.reason.hotel', weight: 2 },
  { id: 'hotel-expediente', from: ['hoteis'], to: ['tribunal', 'esplanada'], reasonKey: 'ride.reason.hotelExpediente', weight: 2 },
  { id: 'embaixada', from: ['tribunal', 'esplanada', 'hoteis'], to: ['embaixadas'], reasonKey: 'ride.reason.embaixada', weight: 2 },
  { id: 'clube', from: ['tribunal', 'quadras', 'casas'], to: ['clubes'], reasonKey: 'ride.reason.clube', weight: 2 },
  { id: 'entrevista', from: ['tribunal', 'esplanada'], to: ['tv'], reasonKey: 'ride.reason.entrevista', weight: 1 },
  { id: 'carimbo', from: ['quadras', 'casas', 'comercio'], to: ['autarquias'], reasonKey: 'ride.reason.carimbo', weight: 2 },
  { id: 'compras', from: ['quadras', 'casas', 'tribunal'], to: ['comercio'], reasonKey: 'ride.reason.compras', weight: 2 },
  { id: 'happy-hour', from: ['tribunal', 'autarquias', 'bancario'], to: ['pontao', 'orla'], reasonKey: 'ride.reason.happyHour', weight: 1 },
  { id: 'setor-bancario', from: ['tribunal', 'esplanada'], to: ['bancario'], reasonKey: 'ride.reason.bancario', weight: 1 },
  // O Banco Confiança é fictício; o Dr. Rubens Caixeta entra na Fase 9.
  { id: 'cafezinho', from: ['tribunal', 'esplanada'], to: ['banco'], reasonKey: 'ride.reason.cafezinho', weight: 1 },
  // Favores do Dr. Caixeta (Fase 9). A maleta vai sozinha no banco de trás.
  { id: 'favor-carona', from: ['banco'], to: ['tribunal', 'mansoes', 'orla'], reasonKey: 'favor.reason.carona', passengers: ['caixeta'], favor: 'carona', maxDistance: 3600 },
  { id: 'favor-maleta', from: ['banco'], to: ['mansoes', 'orla', 'quadras', 'hoteis', 'clubes'], reasonKey: 'favor.reason.maleta', passengers: ['caixeta'], favor: 'maleta', maxDistance: 3600 },
];

/** Tempo e distância. */
export const RIDE_TIMING = {
  /** Distância em linha reta aceitável entre origem e destino (m). */
  minDistance: 450,
  maxDistance: 2300,
  /** Tempo limite = distância / velocidade média × folga + bônus fixo (s), arredondado para 5 s. */
  avgSpeed: 22,
  slack: 1.7, // o caminho pelas pistas é bem maior que a linha reta (e agora há tráfego)
  extraSeconds: 25,
  /** Raio (m) para embarque e para a área de desembarque; velocidade máxima (km/h) para "parado". */
  pickupRadius: 12,
  dropoffRadius: 18,
  stopKmh: 6,
  /** Segundos parado no ponto até embarcar/desembarcar. */
  stopSeconds: 0.8,
  /** Intervalo entre corridas e validade do chamado (s). */
  firstCallDelay: 5,
  nextCallDelay: 7,
  callExpires: 25,
  /** Distância em que o farol do destino começa a aparecer (m): achar o endereço faz parte da piada. */
  beaconRevealDistance: 180, // a cidade densa esconde mais o endereço
};

/** Pagamento (R$). */
export const PAYMENT = {
  base: 150, // diária proporcional por corrida concluída
  tipPerSecond: 2, // gorjeta por segundo que sobrou
  jumpBonus: 25, // por salto (ver jumpMinAir)
  jumpMinAir: 0.7, // s no ar para contar como salto
  driftBonusPerSecond: 6, // derrapagem com o passageiro a bordo (ele grita, mas paga)
  crashPenalty: 12, // por batida forte
  propPenalty: 8, // "danos ao patrimônio público" (poste, árvore, placa)
  lakePenalty: 120, // carro oficial no lago
  timeoutBase: 0.4, // fração da diária paga se estourar o tempo
  nightBonus: 0.25, // adicional noturno: fração da diária
  holidayTipMul: 2, // gorjeta em dobro no feriado
  rainTimeMul: 1.15, // chuva: mais tempo para cada corrida
  holidayAirportMul: 4, // feriado/véspera: peso extra das corridas para o aeroporto
};

/** Condições do mundo real que mexem nas corridas (vindas de env/Environment). */
export interface RideConditions {
  holiday: boolean;
  holidayEve: boolean;
  rain: boolean;
  dry: boolean;
  night: boolean;
}

/** Gatilhos de falas do passageiro. */
export type LineTrigger =
  | 'board'
  | 'jump'
  | 'crash'
  | 'drift'
  | 'fast'
  | 'slow'
  | 'hurry'
  | 'prop'
  | 'lake'
  | 'idle'
  | 'arrive'
  | 'timeout'
  // Ambiente (clima/horário/feriado reais).
  | 'rain'
  | 'dry'
  | 'holiday'
  | 'night'
  // Facções (Fase 8).
  | 'chase'
  | 'tomato'
  | 'escape'
  | 'hostile'
  | 'friendly'
  // Imprensa (Fase 9).
  | 'photo'
  // Arquétipos (Fase 10).
  | 'speech'
  | 'speechEnd'
  | 'interrupted'
  | 'stopAsk'
  | 'lecture'
  | 'scared'
  | 'thrilled'
  | 'rush'
  | 'exposed'
  | 'hidden';

/** Quantas variações de cada fala existem no i18n (chaves line.<gatilho>.<n>). */
export const LINE_COUNTS: Record<LineTrigger, number> = {
  board: 6,
  jump: 5,
  crash: 6,
  drift: 5,
  fast: 4,
  slow: 4,
  hurry: 4,
  prop: 5,
  lake: 3,
  idle: 8,
  arrive: 5,
  timeout: 4,
  rain: 4,
  dry: 4,
  holiday: 3,
  night: 3,
  chase: 4,
  tomato: 3,
  escape: 3,
  hostile: 3,
  friendly: 2,
  photo: 3,
  speech: 6,
  speechEnd: 3,
  interrupted: 3,
  stopAsk: 3,
  lecture: 3,
  scared: 3,
  thrilled: 3,
  rush: 3,
  exposed: 3,
  hidden: 2,
};
