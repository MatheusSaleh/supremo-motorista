// Tela de carregamento. O HTML já está no index.html para aparecer antes do bundle principal baixar.

export class LoadingScreen {
  private readonly bar: HTMLElement;
  private readonly label: HTMLElement;
  private readonly percent: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.bar = root.querySelector<HTMLElement>('[data-ref="bar"]')!;
    this.label = root.querySelector<HTMLElement>('[data-ref="label"]')!;
    this.percent = root.querySelector<HTMLElement>('[data-ref="percent"]')!;
  }

  setTitle(title: string, subtitle: string): void {
    this.root.querySelector('[data-ref="title"]')!.textContent = title;
    this.root.querySelector('[data-ref="subtitle"]')!.textContent = subtitle;
  }

  /** fraction = null → barra indeterminada (ex.: baixando o código, sem progresso disponível). */
  set(fraction: number | null, label: string): void {
    this.label.textContent = label;
    this.root.classList.toggle('indeterminate', fraction === null);
    if (fraction !== null) {
      const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
      this.bar.style.width = `${pct}%`;
      this.percent.textContent = `${pct}%`;
    } else {
      this.percent.textContent = '';
    }
  }

  error(message: string): void {
    this.root.classList.remove('indeterminate');
    this.root.classList.add('error');
    this.label.textContent = message;
    this.percent.textContent = '';
  }

  hide(): void {
    this.root.classList.add('hidden');
    setTimeout(() => this.root.remove(), 600);
  }
}
