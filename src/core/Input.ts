// Estado de teclado e mouse. Usa KeyboardEvent.code (posição física) para WASD funcionar em qualquer layout.
// Mouse: pointer lock ao clicar no canvas; sem lock, arrastar com o botão pressionado também gira a câmera.

export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  private dragging = false;
  private _pointerLocked = false;
  private readonly abort = new AbortController();
  /** Chamado quando o pointer lock é obtido/perdido (ex.: o navegador o solta ao apertar Esc). */
  onPointerLockChange?: (locked: boolean) => void;
  /** Quando false (ex.: pausado), cliques no canvas não capturam o mouse. */
  enabled = true;

  constructor(
    private readonly element: HTMLElement,
    private readonly usePointerLock: boolean,
  ) {
    const opts = { signal: this.abort.signal };

    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      if (e.code === 'Space') e.preventDefault(); // evita rolar a página
    }, opts);
    window.addEventListener('keyup', (e) => this.down.delete(e.code), opts);
    window.addEventListener('blur', () => {
      this.down.clear();
      this.dragging = false;
    }, opts);

    element.addEventListener('mousedown', () => {
      if (!this.enabled) return;
      this.dragging = true;
      if (this.usePointerLock && !this._pointerLocked) this.requestPointerLock();
    }, opts);
    window.addEventListener('mouseup', () => (this.dragging = false), opts);
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || (!this._pointerLocked && !this.dragging)) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    }, opts);
    element.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.enabled) this.wheel += e.deltaY;
    }, { ...opts, passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.element;
      if (locked === this._pointerLocked) return;
      this._pointerLocked = locked;
      this.onPointerLockChange?.(locked);
    }, opts);
  }

  get pointerLocked(): boolean {
    return this._pointerLocked;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True uma única vez por pressionamento (consumido na leitura). */
  consumePressed(code: string): boolean {
    return this.pressed.delete(code);
  }

  consumeMouseDelta(): { x: number; y: number } {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = this.mouseDY = 0;
    return d;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Limpa os "pressionados" não consumidos no fim do frame, para não vazarem para o próximo. */
  endFrame(): void {
    this.pressed.clear();
  }

  exitPointerLock(): void {
    if (this._pointerLocked) document.exitPointerLock();
  }

  /** Tecla virtual (controles de toque): pressionar gera o "pressed" de um quadro, como no teclado. */
  setVirtualKey(code: string, down: boolean): void {
    if (down && !this.down.has(code)) this.pressed.add(code);
    if (down) this.down.add(code);
    else this.down.delete(code);
  }

  /** Movimento de câmera vindo de outra fonte (arrastar no toque). */
  addLook(dx: number, dy: number): void {
    if (!this.enabled) return;
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** Solta todas as teclas e descarta movimento pendente (ao pausar, para não "grudar" tecla). */
  reset(): void {
    this.down.clear();
    this.pressed.clear();
    this.dragging = false;
    this.mouseDX = this.mouseDY = this.wheel = 0;
  }

  dispose(): void {
    this.abort.abort();
  }

  requestPointerLock(): void {
    if (!this.usePointerLock || this._pointerLocked) return;
    try {
      // Em navegadores novos retorna Promise; falhas (ex.: usuário saiu do lock há pouco) são ignoradas.
      const result = this.element.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      /* sem pointer lock: o arrastar continua funcionando */
    }
  }
}
