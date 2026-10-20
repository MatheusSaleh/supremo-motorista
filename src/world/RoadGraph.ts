// Grafo de navegação das ruas, montado a partir dos eixos das pistas (Level.roads). A IA dos
// perseguidores calcula rotas nele (A*) em vez de cortar caminho pelo gramado.
//
// Montagem: cada trecho é dividido onde cruza outro, onde outro trecho termina encostado nele (os "T":
// uma pista que termina na lateral de outra) e nas pontas. Pontos a menos de MERGE metros viram um nó só.
import type { RoadSegment } from './city/builder';

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  /** Largura da pista mais larga que passa pelo nó (m). */
  width: number;
  edges: { to: number; cost: number }[];
}

const MERGE = 3;
/** Ligações mais longas que isto são divididas: com nós próximos, "o nó mais perto" do alvo fica perto dele. */
const MAX_EDGE = 100;
/** Folga (além da meia largura) para considerar que uma pista termina encostada em outra. */
const T_SLACK = 6;

export class RoadGraph {
  readonly nodes: RoadNode[] = [];
  private readonly grid = new Map<string, number[]>();

  constructor(segments: readonly RoadSegment[]) {
    const splits = segments.map(() => [0, 1]);
    const tLinks: { seg: number; t: number; other: number; end: 0 | 1 }[] = [];

    for (let i = 0; i < segments.length; i++) {
      const a = segments[i];
      for (let j = 0; j < segments.length; j++) {
        if (i === j) continue;
        const b = segments[j];
        if (j > i) {
          const hit = intersect(a, b);
          if (hit) {
            splits[i].push(hit.t);
            splits[j].push(hit.u);
          }
        }
        // Ponta de b encostada no meio de a (cruzamento em T).
        for (const end of [0, 1] as const) {
          const ex = end ? b.x2 : b.x1;
          const ez = end ? b.z2 : b.z1;
          const { t, dist } = project(a, ex, ez);
          if (t > 0.001 && t < 0.999 && dist <= a.width / 2 + T_SLACK) {
            splits[i].push(t);
            tLinks.push({ seg: i, t, other: j, end });
          }
        }
      }
    }

    const at = (s: RoadSegment, t: number) => ({ x: s.x1 + (s.x2 - s.x1) * t, z: s.z1 + (s.z2 - s.z1) * t });
    segments.forEach((s, i) => {
      const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
      const sorted = [...new Set(splits[i].map((t) => Math.round(t * 1e5) / 1e5))].sort((p, q) => p - q);
      // Divide trechos longos entre os pontos de corte.
      const ts: number[] = [];
      sorted.forEach((t, k) => {
        if (k > 0) {
          const prev = sorted[k - 1];
          const n = Math.ceil(((t - prev) * len) / MAX_EDGE);
          for (let j = 1; j < n; j++) ts.push(prev + ((t - prev) * j) / n);
        }
        ts.push(t);
      });
      let prev = -1;
      for (const t of ts) {
        const p = at(s, t);
        const id = this.node(p.x, p.z, s.width);
        if (prev >= 0 && prev !== id) this.link(prev, id);
        prev = id;
      }
    });
    for (const l of tLinks) {
      const p = at(segments[l.seg], l.t);
      const o = segments[l.other];
      const a = this.node(p.x, p.z, segments[l.seg].width);
      const b = this.node(l.end ? o.x2 : o.x1, l.end ? o.z2 : o.z1, o.width);
      if (a !== b) this.link(a, b);
    }
  }

  /** Nó mais próximo de (x, z) (opcionalmente só entre os que têm ligação). */
  nearest(x: number, z: number): RoadNode | null {
    let best: RoadNode | null = null;
    let bestD = Infinity;
    for (const n of this.nodes) {
      if (n.edges.length === 0) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /** Rota mais curta (A*) entre dois nós, incluindo os dois; vazia se não houver caminho. */
  path(from: RoadNode, to: RoadNode): RoadNode[] {
    if (from === to) return [from];
    const g = new Map<number, number>([[from.id, 0]]);
    const came = new Map<number, number>();
    const open = new Set<number>([from.id]);
    const f = new Map<number, number>([[from.id, dist(from, to)]]);
    while (open.size) {
      let cur = -1;
      let best = Infinity;
      for (const id of open) {
        const v = f.get(id)!;
        if (v < best) {
          best = v;
          cur = id;
        }
      }
      if (cur === to.id) {
        const out = [to];
        let c = cur;
        while (came.has(c)) {
          c = came.get(c)!;
          out.push(this.nodes[c]);
        }
        return out.reverse();
      }
      open.delete(cur);
      const gc = g.get(cur)!;
      for (const e of this.nodes[cur].edges) {
        const ng = gc + e.cost;
        if (ng < (g.get(e.to) ?? Infinity)) {
          came.set(e.to, cur);
          g.set(e.to, ng);
          f.set(e.to, ng + dist(this.nodes[e.to], to));
          open.add(e.to);
        }
      }
    }
    return [];
  }

  /** Total de ligações (para depuração). */
  get edgeCount(): number {
    return this.nodes.reduce((s, n) => s + n.edges.length, 0) / 2;
  }

  private node(x: number, z: number, width: number): number {
    const cx = Math.floor(x / MERGE);
    const cz = Math.floor(z / MERGE);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const id of this.grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          const n = this.nodes[id];
          if (Math.hypot(n.x - x, n.z - z) < MERGE) {
            n.width = Math.max(n.width, width);
            return id;
          }
        }
    const id = this.nodes.length;
    this.nodes.push({ id, x, z, width, edges: [] });
    const key = `${cx},${cz}`;
    this.grid.set(key, [...(this.grid.get(key) ?? []), id]);
    return id;
  }

  private link(a: number, b: number): void {
    const na = this.nodes[a];
    const nb = this.nodes[b];
    if (na.edges.some((e) => e.to === b)) return;
    const cost = dist(na, nb);
    na.edges.push({ to: b, cost });
    nb.edges.push({ to: a, cost });
  }
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Projeção de (x, z) no segmento: parâmetro t (0..1, sem limitar) e distância ao ponto projetado. */
function project(s: RoadSegment, x: number, z: number): { t: number; dist: number } {
  const dx = s.x2 - s.x1;
  const dz = s.z2 - s.z1;
  const len2 = dx * dx + dz * dz || 1;
  const t = ((x - s.x1) * dx + (z - s.z1) * dz) / len2;
  const px = s.x1 + dx * t;
  const pz = s.z1 + dz * t;
  return { t, dist: Math.hypot(x - px, z - pz) };
}

/** Cruzamento dos eixos de dois trechos (parâmetros t em a e u em b), ou null. */
function intersect(a: RoadSegment, b: RoadSegment): { t: number; u: number } | null {
  const rx = a.x2 - a.x1;
  const rz = a.z2 - a.z1;
  const sx = b.x2 - b.x1;
  const sz = b.z2 - b.z1;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null; // paralelos
  const qx = b.x1 - a.x1;
  const qz = b.z1 - a.z1;
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  const eps = 1e-6;
  return t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps ? { t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)) } : null;
}
