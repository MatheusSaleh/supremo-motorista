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
  /** Projeto aberto no portfólio: toma a tela por um tempo e depois volta ao rodízio. */
  private project: { file: string; lines: string[] } | null = null;

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
    const lines = this.lines();
    const total = lines.reduce((n, l) => n + l.length + 1, 0);
    if (this.chars >= total) {
      this.typing = false;
      this.hold += dt;
      if (this.hold > (this.project ? 9 : 4)) {
        this.hold = 0;
        this.chars = 0;
        if (this.project) this.project = null;
        else this.snippet = (this.snippet + 1) % SNIPPETS.length;
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
    if (Math.random() < 0.08) this.speed = this.project ? 34 + Math.random() * 12 : 10 + Math.random() * 16;
    this.draw();
  }

  /**
   * Mostra o projeto que o visitante abriu no portfólio, como se estivesse codando nele agora (digita rápido).
   * Os textos vêm de outra página: chegam já cortados e só são desenhados no canvas.
   */
  showProject(p: { name: string; caption: string; techs: string[]; english: boolean }): void {
    const q = (v: string) => `'${v.replace(/['\\]/g, '')}'`;
    const slug = p.name.normalize('NFD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-') || 'projeto';
    const [obj, nameKey, stackKey, open, now] = p.english
      ? ['project', 'name', 'stack', 'portfolio.open(project);', '// open on the portfolio right now']
      : ['projeto', 'nome', 'stack', 'portfolio.abrir(projeto);', '// aberto agora no portfólio'];
    const stack = p.techs.length <= 3 ? [`  ${stackKey}: [${p.techs.map(q).join(', ')}],`] : [`  ${stackKey}: [`, ...p.techs.map((t) => `    ${q(t)},`), '  ],'];
    this.project = {
      file: `${slug}.ts`,
      lines: [`// ${p.name}${p.caption ? ` — ${p.caption}` : ''}`, `const ${obj} = {`, `  ${nameKey}: ${q(p.name)},`, ...stack, '};', '', `${open} ${now}`],
    };
    this.chars = 0;
    this.hold = 0;
    this.acc = 0;
    this.speed = 40;
    this.typing = true;
    this.draw();
  }

  private lines(): string[] {
    return this.project?.lines ?? SNIPPETS[this.snippet];
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
    g.fillText(this.project?.file ?? ['main.ts', 'CotacaoFreteService.php', 'DoacaoController.java'][this.snippet], 30, 30);

    const lines = this.lines();
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

/** Commit público vindo do portfólio: repositório, primeira linha da mensagem e quando foi feito. */
export interface Commit {
  repo: string;
  message: string;
  date: Date;
}

/** Log do build que o segundo monitor mostra enquanto os commits não chegam (ou fora do portfólio). */
const BUILD_LOG: [string, string][] = [
  ['#9fd671', '$ npm run build'],
  ['#8c9382', '> tsc --noEmit && vite build'],
  ['#8c9382', 'vite v8 building for production...'],
  ['#43e6ed', '✓ 412 modules transformed.'],
  ['#8c9382', 'dist/index.html        1.2 kB'],
  ['#8c9382', 'dist/assets/three.js   716 kB'],
  ['#9fd671', '✓ built in 4.81s'],
  ['#9fd671', '$ git push origin main'],
  ['#edbd9a', '→ deploy: matheussaleh.com.br'],
];

/**
 * Telão dos commits, atrás da mesa: "o que estou codando agora". Mostra o log do build até o portfólio mandar os
 * commits públicos mais recentes do GitHub; aí vira um `git log` com repositório, mensagem e há quanto tempo cada
 * um foi feito (recalculado a cada meio minuto, porque a página que manda os dados pode ter sido gerada há horas).
 * Letras grandes e poucas linhas: na câmera do desktop o telão ocupa só ~1/8 da largura do quadro.
 */
export class CommitScreen {
  /** Quantos commits cabem com letra legível. */
  static readonly MAX = 3;
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private commits: Commit[] = [];
  private english = false;
  /** Linhas já "impressas" pelo git log (saem uma a uma, como num terminal). */
  private shown = 0;
  private acc = 0;
  private refresh = 0;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 576;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.drawBuildLog();
  }

  /** Os textos vêm de outra página: chegam já validados e cortados, e só são desenhados no canvas. */
  showCommits(commits: Commit[], english: boolean): void {
    if (commits.length === 0) return;
    this.commits = commits.slice(0, CommitScreen.MAX);
    this.english = english;
    this.shown = 0;
    this.acc = 0;
    this.draw();
  }

  update(dt: number): void {
    if (this.commits.length === 0) return;
    if (this.shown <= this.commits.length) {
      this.acc += dt;
      if (this.acc < 0.25) return;
      this.acc = 0;
      this.shown++;
      this.draw();
      return;
    }
    this.refresh += dt;
    if (this.refresh < 30) return;
    this.refresh = 0;
    this.draw();
  }

  private drawBuildLog(): void {
    const g = this.ctx;
    g.fillStyle = '#0b0d12';
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.font = '600 36px ui-monospace, Menlo, Consolas, monospace';
    BUILD_LOG.forEach(([color, text], i) => {
      g.fillStyle = color;
      g.fillText(text, 32, 64 + i * 56);
    });
    this.texture.needsUpdate = true;
  }

  private draw(): void {
    const g = this.ctx;
    const { width: W, height: H } = g.canvas;
    const pad = 32;
    g.fillStyle = '#0b0d12';
    g.fillRect(0, 0, W, H);
    // Faixa de título.
    g.fillStyle = '#9fd671';
    g.fillRect(0, 0, W, 76);
    g.fillStyle = '#10200a';
    g.font = '700 40px ui-monospace, Menlo, Consolas, monospace';
    g.fillText(this.english ? '$ git log · coding now' : '$ git log · codando agora', pad, 52);

    const now = Date.now();
    const block = 164;
    this.commits.slice(0, Math.max(0, this.shown - 1)).forEach((c, i) => {
      const y = 140 + i * block;
      // A idade vem logo depois do repositório: o lado direito do telão é o que fica mais longe da câmera.
      const ageText = ` · ${timeAgo(now - c.date.getTime(), this.english)}`;
      g.font = '600 38px ui-monospace, Menlo, Consolas, monospace';
      const ageWidth = g.measureText(ageText).width;
      g.font = '700 40px ui-monospace, Menlo, Consolas, monospace';
      g.fillStyle = '#43e6ed';
      const repo = fit(g, `● ${c.repo}`, W - pad * 2 - ageWidth);
      g.fillText(repo, pad, y);
      const repoWidth = g.measureText(repo).width;
      g.font = '600 38px ui-monospace, Menlo, Consolas, monospace';
      g.fillStyle = '#edbd9a';
      g.fillText(ageText, pad + repoWidth, y);
      g.font = '42px ui-monospace, Menlo, Consolas, monospace';
      g.fillStyle = '#eef0f4';
      g.fillText(fit(g, c.message, W - pad * 2 - 44), pad + 44, y + 56);
    });
    if (this.shown <= this.commits.length) {
      g.fillStyle = '#5bf8ff';
      g.fillRect(pad, 104 + Math.max(0, this.shown - 1) * block, 22, 44);
    }
    this.texture.needsUpdate = true;
  }
}

/** Corta o texto com reticências para caber na largura (fonte já escolhida no contexto). */
function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** "há 5 min", "há 3 h", "há 2 dias"… (ou em inglês). */
function timeAgo(ms: number, english: boolean): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  const steps: [number, string, string, string, string][] = [
    // limite (min), unidade pt (1, n), unidade en (1, n)
    [60, 'min', 'min', 'min', 'min'],
    [60 * 24, 'h', 'h', 'h', 'h'],
    [60 * 24 * 7, 'dia', 'dias', 'day', 'days'],
    [60 * 24 * 30, 'sem', 'sem', 'wk', 'wk'],
    [60 * 24 * 365, 'mês', 'meses', 'month', 'months'],
    [Infinity, 'ano', 'anos', 'year', 'years'],
  ];
  if (min < 1) return english ? 'just now' : 'agora';
  let unit = 1;
  for (const [limit, pt1, ptN, en1, enN] of steps) {
    if (min < limit) {
      const n = Math.floor(min / unit);
      return english ? `${n} ${n === 1 ? en1 : enN} ago` : `há ${n} ${n === 1 ? pt1 : ptN}`;
    }
    unit = limit;
  }
  return '';
}

/** Atividade pública no GitHub vinda do portfólio (já validada em Showcase.onCommand). */
export interface GithubActivity {
  commits: number;
  pullRequests: number;
  issues: number;
  /** Do ano mais antigo ao atual. */
  commitsByYear: { year: number; count: number }[];
  /** Fatia (%) dos repositórios próprios em cada linguagem, da mais usada à menos. */
  languages: { name: string; share: number }[];
}

const LANGUAGE_COLORS = ['#43e6ed', '#9fd671', '#edbd9a', '#b545ff'];

/**
 * Painel na parede da direita (no lugar do antigo letreiro neon, que virou o cabeçalho): commits, pull requests e
 * issues públicos, commits por ano e as linguagens mais usadas. Sem dados (fora do portfólio ou com a API do
 * GitHub fora do ar), mostra só o cabeçalho e traços. Letras grandes: no desktop o painel tem ~190 px de largura.
 */
export class StatsPanel {
  static readonly WIDTH = 1024;
  static readonly HEIGHT = 732;
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = StatsPanel.WIDTH;
    canvas.height = StatsPanel.HEIGHT;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.draw(null, false);
  }

  show(stats: GithubActivity, english: boolean): void {
    this.draw(stats, english);
  }

  private draw(stats: GithubActivity | null, english: boolean): void {
    const g = this.ctx;
    const W = StatsPanel.WIDTH;
    const H = StatsPanel.HEIGHT;
    const mono = (weight: number, size: number) => `${weight} ${size}px ui-monospace, Menlo, Consolas, monospace`;
    const num = (n: number) => n.toLocaleString(english ? 'en-US' : 'pt-BR');
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#0b0d12';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#43e6ed';
    g.lineWidth = 6;
    g.strokeRect(3, 3, W - 6, H - 6);

    // Cabeçalho: o "</>" em neon (o letreiro que ficava nesta parede) e o título.
    g.save();
    g.shadowColor = '#43e6ed';
    g.shadowBlur = 28;
    g.fillStyle = '#9ff7fb';
    g.font = mono(800, 72);
    g.fillText('</>', 36, 96);
    g.restore();
    g.fillStyle = '#eef0f4';
    g.font = mono(800, 52);
    g.fillText('GITHUB', 210, 90);
    g.fillStyle = '#8c9382';
    g.font = mono(600, 30);
    g.textAlign = 'right';
    g.fillText(english ? 'public activity' : 'atividade pública', W - 36, 88);
    g.textAlign = 'left';
    g.fillStyle = '#23283a';
    g.fillRect(36, 124, W - 72, 4);

    // Totais.
    const totals: [string, number | null, string][] = [
      ['COMMITS', stats?.commits ?? null, '#9fd671'],
      ['PULL REQUESTS', stats?.pullRequests ?? null, '#43e6ed'],
      ['ISSUES', stats?.issues ?? null, '#edbd9a'],
    ];
    const colW = (W - 72) / 3;
    totals.forEach(([label, value, color], i) => {
      const x = 36 + i * colW;
      g.fillStyle = color;
      g.font = mono(800, 92);
      g.fillText(value === null ? '—' : num(value), x, 234);
      g.fillStyle = '#aab0bf';
      g.font = mono(700, 30);
      g.fillText(label, x, 280);
    });
    g.fillStyle = '#23283a';
    g.fillRect(36, 312, W - 72, 4);

    // Commits por ano (barras).
    g.fillStyle = '#aab0bf';
    g.font = mono(700, 30);
    g.fillText(english ? 'COMMITS / YEAR' : 'COMMITS / ANO', 36, 364);
    const years = stats?.commitsByYear ?? [];
    const max = Math.max(1, ...years.map((y) => y.count));
    const chart = { x: 36, w: 500, top: 420, bottom: 660 };
    const slot = chart.w / Math.max(1, years.length);
    years.forEach((y, i) => {
      const bw = slot * 0.62;
      const x = chart.x + i * slot + (slot - bw) / 2;
      const h = Math.max(6, ((chart.bottom - chart.top) * y.count) / max);
      const last = i === years.length - 1;
      g.fillStyle = last ? '#9fd671' : '#3f6f8a';
      g.fillRect(x, chart.bottom - h, bw, h);
      g.textAlign = 'center';
      g.fillStyle = '#eef0f4';
      g.font = mono(800, 34);
      g.fillText(num(y.count), x + bw / 2, chart.bottom - h - 12);
      g.fillStyle = '#aab0bf';
      g.font = mono(700, 30);
      g.fillText(String(y.year), x + bw / 2, chart.bottom + 40);
      g.textAlign = 'left';
    });
    if (years.length === 0) {
      g.fillStyle = '#4a5066';
      g.font = mono(800, 92);
      g.fillText('—', chart.x, 560);
    }

    // Linguagens mais usadas.
    const lx = 580;
    g.fillStyle = '#aab0bf';
    g.font = mono(700, 30);
    g.fillText(english ? 'LANGUAGES' : 'LINGUAGENS', lx, 364);
    (stats?.languages ?? []).forEach((l, i) => {
      const y = 424 + i * 76;
      const color = LANGUAGE_COLORS[i % LANGUAGE_COLORS.length];
      g.fillStyle = color;
      g.fillRect(lx, y - 30, 28, 28);
      g.fillStyle = '#eef0f4';
      g.font = mono(700, 38);
      g.fillText(fit(g, l.name, 250), lx + 44, y);
      g.textAlign = 'right';
      g.fillStyle = color;
      g.fillText(`${l.share}%`, W - 36, y);
      g.textAlign = 'left';
      g.fillStyle = '#23283a';
      g.fillRect(lx, y + 14, W - 36 - lx, 8);
      g.fillStyle = color;
      g.fillRect(lx, y + 14, ((W - 36 - lx) * l.share) / 100, 8);
    });
    this.texture.needsUpdate = true;
  }
}
