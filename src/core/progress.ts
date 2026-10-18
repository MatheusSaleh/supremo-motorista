// Progresso de carregamento ponderado por etapa (ex.: personagem pesa mais que iniciar a física).

export type ProgressCallback = (fraction: number, label: string) => void;

export class ProgressTracker<K extends string> {
  private readonly values = new Map<K, number>();
  private readonly total: number;
  private label = '';

  constructor(
    private readonly weights: Record<K, number>,
    private readonly onProgress: ProgressCallback,
  ) {
    this.total = Object.values<number>(weights).reduce((a, b) => a + b, 0);
  }

  set(step: K, fraction: number, label?: string): void {
    this.values.set(step, Math.min(1, Math.max(this.values.get(step) ?? 0, fraction)));
    if (label) this.label = label;
    let sum = 0;
    for (const [k, v] of this.values) sum += v * this.weights[k];
    this.onProgress(sum / this.total, this.label);
  }
}

/** Aguarda o próximo frame (permite ao navegador redesenhar a tela de carregamento). */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
