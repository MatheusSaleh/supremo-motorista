// Fase 9: o banqueiro FICTÍCIO Dr. Rubens Caixeta (Banco Confiança S.A.), seus "favores" e o Medidor de
// Suspeição. A imprensa e a Corregedoria também são fictícias (Gazeta da Tesourinha, Corregedoria do
// Tribunal). Textos no i18n (pt-BR.banker.ts).
import type { Look } from '../player/outfit';
import type { LineTrigger } from './rides';

export type FavorKind = 'carona' | 'maleta';

export const CAIXETA = {
  passengerId: 'caixeta',
  /** Terno creme, inconfundível de longe. */
  look: { suit: [1, 1, 1], skin: [1.05, 0.98, 0.92], fabric: 0xe8dcc0 } satisfies Look,
};

/** Ligações do Dr. Caixeta (no celular particular, não no rádio do Tribunal). */
export const FAVORS = {
  /** Chance de a próxima oferta ser um favor (depois de cada corrida normal). */
  callChance: 0.3,
  /** Não liga com a suspeição acima disto (nem ele é tão descuidado). */
  maxSuspicion: 90,
  /** Pagamento: múltiplo da diária, como "consultoria". Atrasado, paga metade. */
  payMul: { carona: 3, maleta: 5 } satisfies Record<FavorKind, number>,
  /** Favores podem ir mais longe que as corridas normais (o Lago Sul fica do outro lado do lago). */
  maxDistance: 3600,
};

/** Medidor de Suspeição (0–100). Valores por segundo salvo indicação. */
export const SUSPICION = {
  max: 100,
  /** Eventos. */
  acceptFavor: 10,
  deliverFavor: 6,
  declineFavor: -4,
  cleanRide: -8,
  /** Corrida comum com destino no banco ("cafezinho"). */
  cafezinho: 4,
  /** Bateu com a maleta a bordo: dinheiro voando pela janela. */
  maletaShaken: 3,
  /** Contínuos. */
  favorActive: 0.4,
  decay: 0.12,
  /** Foto da imprensa: com favor a bordo (flagrante) ou sem (só fofoca). */
  photoFavor: 8,
  photoClean: 1.5,
  /** Carros da imprensa a partir destes valores (1º, 2º). */
  pressThresholds: [35, 70],
  /** Escândalo: multa (fração do dinheiro, com mínimo), e o medidor volta a este valor. */
  scandalFine: 0.4,
  scandalMinFine: 400,
  afterScandal: 30,
  /** Sem chamados do rádio por estes segundos depois do escândalo (a manchete fica na tela). */
  scandalQuiet: 10,
};

/** Carro da imprensa (reaproveita o pool dos perseguidores). */
export const PRESS = {
  color: 0xeef1f4,
  accent: 0x1b5fa8,
  css: '#cfe3ff',
  /** Fica a esta distância atrás do alvo (não bate). */
  followDistance: 18,
  photoRange: 38,
  photoInterval: 1.3,
};

/** Falas próprias (chaves line.caixeta.<gatilho>.<n> e line.maleta.<gatilho>.<n>); o resto usa as comuns. */
export const CAIXETA_LINES: Partial<Record<LineTrigger, number>> = {
  board: 3,
  crash: 3,
  jump: 2,
  drift: 2,
  fast: 2,
  slow: 2,
  hurry: 2,
  idle: 4,
  arrive: 3,
  timeout: 2,
  lake: 2,
  photo: 3,
};
/** Com a maleta, quem "fala" é o Dr. Caixeta por mensagem no celular (só nestas situações). */
export const MALETA_LINES: Partial<Record<LineTrigger, number>> = {
  board: 3,
  crash: 3,
  jump: 2,
  lake: 2,
  idle: 3,
  arrive: 2,
  timeout: 2,
  photo: 2,
};
