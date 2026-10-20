// Medidor de Suspeição (Fase 9): sobe com os favores do Dr. Caixeta e com as fotos da imprensa; desce
// com o tempo, com corridas limpas e recusando favores. Cheio, vira escândalo (multa da Corregedoria).
// Também guarda o histórico de escolhas, para a campanha e os finais (Fase 12). Sem DOM nem Three.js.
import { SUSPICION as S } from '../data/banker';

export class Suspicion {
  value = 0;
  /** Histórico (finais da campanha). */
  favorsAccepted = 0;
  favorsDeclined = 0;
  scandals = 0;

  /** Por frame. favorActive = há um favor em andamento (aceito e ainda não entregue). */
  update(dt: number, favorActive: boolean): void {
    this.add((favorActive ? S.favorActive : -S.decay) * dt);
  }

  accepted(): void {
    this.favorsAccepted++;
    this.add(S.acceptFavor);
  }

  declined(): void {
    this.favorsDeclined++;
    this.add(S.declineFavor);
  }

  deliveredFavor(): void {
    this.add(S.deliverFavor);
  }

  cleanRide(): void {
    this.add(S.cleanRide);
  }

  cafezinho(): void {
    this.add(S.cafezinho);
  }

  maletaShaken(): void {
    this.add(S.maletaShaken);
  }

  /** Foto da imprensa: flagrante (favor a bordo) pesa muito mais. */
  photographed(favorAboard: boolean, mul = 1): void {
    this.add((favorAboard ? S.photoFavor : S.photoClean) * mul);
  }

  /** Carros da imprensa desejados agora. */
  wantedPress(): number {
    return S.pressThresholds.filter((t) => this.value >= t).length;
  }

  get full(): boolean {
    return this.value >= S.max;
  }

  /** Escândalo: calcula a multa sobre o dinheiro atual e baixa o medidor. */
  scandal(money: number): number {
    this.scandals++;
    this.value = S.afterScandal;
    return Math.round(Math.max(S.scandalMinFine, Math.max(0, money) * S.scandalFine));
  }

  private add(v: number): void {
    this.value = Math.min(S.max, Math.max(0, this.value + v));
  }
}
