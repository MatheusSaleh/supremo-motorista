// Telas da vitrine desenhadas em canvas: o editor em que o personagem "digita" e o relógio de mesa
// com a hora e a temperatura reais de Brasília.
import * as THREE from 'three';

const SNIPPETS: string[][] = [
  [
    '// Supremo Motorista — Brasília em tempo real',
    "import { Environment } from './env';",
    "import { createCity } from './world/city';",
    '',
    'const env = new Environment(true);',
    'const city = createCity(1960);',
    '',
    'function frame(dt: number) {',
    '  const agora = env.snapshot();',
    '  sky.update(dt, agora); // sol, chuva e lua reais',
    '  renderer.render(scene, camera);',
    '}',
  ],
  [
    '<?php',
    '',
    'final class CotacaoFreteService',
    '{',
    '    public function cotar(Pedido $pedido): Collection',
    '    {',
    '        return $this->transportadoras',
    '            ->map(fn ($t) => $t->cotar($pedido))',
    '            ->filter->disponivel()',
    "            ->sortBy('preco');",
    '    }',
    '}',
  ],
  [
    '@RestController',
    '@RequestMapping("/api/doacoes")',
    'public class DoacaoController {',
    '',
    '    @PostMapping',
    '    public ResponseEntity<Doacao> registrar(',
    '            @Valid @RequestBody DoacaoDto dto) {',
    '        var doacao = service.registrar(dto);',
    '        return ResponseEntity.status(CREATED)',
    '                .body(doacao);',
    '    }',
    '}',
  ],
];

const KEYWORDS =
  /\b(import|from|const|let|function|return|new|final|class|public|private|fn|var|true|false|static|extends|implements|this|await|async)\b/g;

const COLORS = {
  bg: '#14161f',
  gutter: '#3b4052',
  text: '#d7dae0',
  keyword: '#c792ea',
  string: '#c3e88d',
  comment: '#6a7390',
  annotation: '#ffcb6b',
  number: '#f78c6c',
};

export class CodeScreen {
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private snippet = 0;
  private chars = 0;
  private hold = 0;
  private acc = 0;
  /** Teclas por segundo (varia um pouco para parecer gente digitando). */
  private speed = 18;
  /** true enquanto há caracteres saindo (as mãos mexem só aí). */
  typing = true;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 576;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    // Começa no meio do primeiro trecho: a imagem estática do portfólio mostra esta mesma tela, e a troca
    // para a cena ao vivo fica imperceptível.
    const total = SNIPPETS[0].reduce((n, l) => n + l.length + 1, 0);
    this.chars = Math.floor(total * 0.62);
    this.draw();
  }

  update(dt: number): void {
    const lines = SNIPPETS[this.snippet];
    const total = lines.reduce((n, l) => n + l.length + 1, 0);
    if (this.chars >= total) {
      this.typing = false;
      this.hold += dt;
      if (this.hold > 4) {
        this.hold = 0;
        this.chars = 0;
        this.snippet = (this.snippet + 1) % SNIPPETS.length;
        this.typing = true;
        this.draw();
      }
      return;
    }
    this.acc += dt * this.speed;
    if (this.acc < 1) return;
    const step = Math.floor(this.acc);
    this.acc -= step;
    this.chars = Math.min(total, this.chars + step);
    if (Math.random() < 0.08) this.speed = 10 + Math.random() * 16;
    this.draw();
  }

  private draw(): void {
    const g = this.ctx;
    const { width: W, height: H } = g.canvas;
    g.fillStyle = COLORS.bg;
    g.fillRect(0, 0, W, H);
    // Barra de abas.
    g.fillStyle = '#0e1017';
    g.fillRect(0, 0, W, 40);
    g.fillStyle = COLORS.bg;
    g.fillRect(16, 6, 230, 34);
    g.font = '600 20px ui-monospace, Menlo, Consolas, monospace';
    g.fillStyle = '#9fd671';
    g.fillText(['main.ts', 'CotacaoFreteService.php', 'DoacaoController.java'][this.snippet], 30, 30);

    const lines = SNIPPETS[this.snippet];
    let left = this.chars;
    const lh = 38;
    g.font = '24px ui-monospace, Menlo, Consolas, monospace';
    let cursor: [number, number] | null = null;
    for (let i = 0; i < lines.length; i++) {
      const y = 82 + i * lh;
      g.fillStyle = COLORS.gutter;
      g.fillText(String(i + 1).padStart(2, ' '), 18, y);
      if (left <= 0) continue;
      const shown = lines[i].slice(0, left);
      left -= lines[i].length + 1;
      this.drawLine(shown, 80, y);
      if (left <= 0) cursor = [80 + g.measureText(shown).width, y];
    }
    if (cursor && Math.floor(performance.now() / 450) % 2 === 0) {
      g.fillStyle = '#5bf8ff';
      g.fillRect(cursor[0] + 2, cursor[1] - 22, 12, 28);
    }
    // Barra de status.
    g.fillStyle = '#9fd671';
    g.fillRect(0, H - 30, W, 30);
    g.fillStyle = '#10200a';
    g.font = '600 18px ui-monospace, Menlo, Consolas, monospace';
    g.fillText('⎇ main   ✓ build ok', 16, H - 9);
    this.texture.needsUpdate = true;
  }

  /** Realce de sintaxe bem simples: comentário, string, anotação, número e palavra-chave. */
  private drawLine(text: string, x: number, y: number): void {
    const g = this.ctx;
    if (/^\s*(\/\/|#)/.test(text)) {
      g.fillStyle = COLORS.comment;
      g.fillText(text, x, y);
      return;
    }
    const tokens = text.split(/('[^']*'?|"[^"]*"?|\/\/.*$|@\w+|\b\d+\b|\b\w+\b)/);
    for (const tok of tokens) {
      if (!tok) continue;
      if (tok.startsWith('//')) g.fillStyle = COLORS.comment;
      else if (tok.startsWith("'") || tok.startsWith('"')) g.fillStyle = COLORS.string;
      else if (tok.startsWith('@')) g.fillStyle = COLORS.annotation;
      else if (/^\d+$/.test(tok)) g.fillStyle = COLORS.number;
      else if (KEYWORDS.test(tok)) g.fillStyle = COLORS.keyword;
      else g.fillStyle = COLORS.text;
      KEYWORDS.lastIndex = 0;
      g.fillText(tok, x, y);
      x += g.measureText(tok).width;
    }
  }
}

/** Relógio de mesa: "15:56" grande e "BRASÍLIA · 27 °C" embaixo. */
export class DeskClock {
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private last = '';

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  set(clock: string, temperature: number | null, raining: boolean): void {
    const sub = `BRASÍLIA${temperature === null ? '' : ` · ${Math.round(temperature)}°C`}${raining ? ' · CHUVA' : ''}`;
    const key = clock + sub;
    if (key === this.last) return;
    this.last = key;
    const g = this.ctx;
    g.fillStyle = '#07080c';
    g.fillRect(0, 0, 256, 128);
    g.textAlign = 'center';
    g.fillStyle = '#5bf8ff';
    g.font = '700 64px ui-monospace, Menlo, Consolas, monospace';
    g.fillText(clock, 128, 72);
    g.fillStyle = '#9fd671';
    g.font = '600 18px ui-monospace, Menlo, Consolas, monospace';
    g.fillText(sub, 128, 108);
    this.texture.needsUpdate = true;
  }
}
