// Estado de teclado e mouse. Usa KeyboardEvent.code (posição física) para WASD funcionar em qualquer layout.
// Mouse: pointer lock ao clicar no canvas; sem lock, arrastar com o botão pressionado também gira a câmera.

/** Movimento (px) a partir do qual um evento pode ser um pico espúrio... */
const SPIKE_MIN = 120;
/** ...se for mais que SPIKE_RATIO vezes o evento anterior (+ folga, para partidas do repouso). */
const SPIKE_RATIO = 6;
const SPIKE_SLACK = 12;

export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  private dragging = false;
  private _pointerLocked = false;
  /** Filtro de picos do mouse: tamanho do último movimento aceito e descarte do primeiro evento. */
  private lastMoveMag = 0;
  private skipNextMove = false;
  /** O navegador suporta movimento bruto (sem aceleração do sistema) no pointer lock. */
  private rawMovement = true;
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
      if (!this.dragging) this.resetMoveFilter();
      this.dragging = true;
      if (this.usePointerLock && !this._pointerLocked) this.requestPointerLock();
    }, opts);
    window.addEventListener('mouseup', () => (this.dragging = false), opts);
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || (!this._pointerLocked && !this.dragging)) return;
      // Primeiro evento depois de capturar o mouse ou começar a arrastar: o navegador costuma mandar o
      // salto do cursor até ali, não um movimento real.
      if (this.skipNextMove) {
        this.skipNextMove = false;
        return;
      }
      const dx = e.movementX;
      const dy = e.movementY;
      const mag = Math.hypot(dx, dy);
      // Pico espúrio (bug conhecido do pointer lock no Chrome): um evento centenas de pixels maior que o
      // anterior. A mão não acelera assim de um evento para o outro, então é descartado. Sem isso, a
      // câmera dava meia-volta sozinha.
      if (mag > SPIKE_MIN && mag > SPIKE_RATIO * (this.lastMoveMag + SPIKE_SLACK)) return;
      this.lastMoveMag = mag;
      this.mouseDX += dx;
      this.mouseDY += dy;
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
      this.resetMoveFilter();
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

  private resetMoveFilter(): void {
    this.lastMoveMag = 0;
    this.skipNextMove = true;
  }

  requestPointerLock(): void {
    if (!this.usePointerLock || this._pointerLocked) return;
    try {
      // unadjustedMovement: movimento bruto do mouse, sem a aceleração do sistema operacional (a mesma
      // distância da mão gira sempre o mesmo ângulo) e sem os saltos do lock comum. Onde não há suporte,
      // a Promise falha com NotSupportedError e o lock é pedido do jeito normal.
      // Em navegadores antigos não há Promise; outras falhas (ex.: usuário saiu do lock há pouco) são ignoradas.
      const options = this.rawMovement ? { unadjustedMovement: true } : undefined;
      const result = this.element.requestPointerLock(options) as unknown;
      if (result instanceof Promise)
        result.catch((err: unknown) => {
          if (this.rawMovement && err instanceof DOMException && err.name === 'NotSupportedError') {
            this.rawMovement = false;
            this.requestPointerLock();
          }
        });
    } catch {
      /* sem pointer lock: o arrastar continua funcionando */
    }
  }
}
