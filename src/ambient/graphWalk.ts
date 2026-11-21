// Base do tráfego e dos pedestres (M6): um "andarilho" que percorre as ligações do grafo de ruas
// (world/RoadGraph) com um deslocamento lateral (faixa da direita para carros, calçada para pedestres) e
// escolhe a próxima ligação ao chegar num nó. Também a sonda de altura do chão (raio na física), para quem
// passa pela Ponte JK e pelas lombadas das tesourinhas não andar dentro delas.
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups } from '../core/collisionGroups';
import type { RoadGraph, RoadNode } from '../world/RoadGraph';

export interface Walker {
  from: RoadNode;
  to: RoadNode;
  /** Distância percorrida na ligação atual (m) e o comprimento dela. */
  s: number;
  len: number;
  /** Deslocamento lateral para a direita de quem anda (m). */
  offset: number;
  /** Posição e rumo resultantes (plano), atualizados por placeWalker. */
  x: number;
  z: number;
  yaw: number;
  /** Suaviza a troca de ligação (sem "teleporte" lateral no cruzamento): de onde vinha e quanto falta. */
  bx: number;
  bz: number;
  blend: number;
}

/** Comprimento (m) da transição suave ao virar num nó. */
const BLEND = 9;

export function startWalker(from: RoadNode, to: RoadNode, offsetFor: (from: RoadNode, to: RoadNode) => number, s = 0): Walker {
  const len = Math.hypot(to.x - from.x, to.z - from.z) || 1;
  const w: Walker = { from, to, s: Math.min(s, len), len, offset: offsetFor(from, to), x: 0, z: 0, yaw: 0, bx: 0, bz: 0, blend: 0 };
  placeWalker(w);
  return w;
}

/** Ponto da ligação a `s` metros do início, já com o deslocamento lateral. */
function lanePoint(w: Walker, s: number): { x: number; z: number; dx: number; dz: number } {
  const dx = (w.to.x - w.from.x) / w.len;
  const dz = (w.to.z - w.from.z) / w.len;
  // Direita de quem olha para (dx, dz), com Y para cima: (−dz, dx).
  return { x: w.from.x + dx * s - dz * w.offset, z: w.from.z + dz * s + dx * w.offset, dx, dz };
}

export function placeWalker(w: Walker): void {
  const p = lanePoint(w, w.s);
  if (w.blend > 0) {
    const k = 1 - w.blend / BLEND;
    const e = k * k * (3 - 2 * k);
    w.x = w.bx + (p.x - w.bx) * e;
    w.z = w.bz + (p.z - w.bz) * e;
    const tx = p.x - w.x + p.dx * 2;
    const tz = p.z - w.z + p.dz * 2;
    w.yaw = Math.atan2(tx, tz);
  } else {
    w.x = p.x;
    w.z = p.z;
    w.yaw = Math.atan2(p.dx, p.dz);
  }
}

/**
 * Avança `ds` metros. Ao fim da ligação escolhe a próxima (preferindo seguir reto; volta só sem saída).
 * `allowed` filtra ligações proibidas (ex.: pedestre sobre a água).
 */
export function advanceWalker(
  w: Walker,
  ds: number,
  rng: () => number,
  offsetFor: (from: RoadNode, to: RoadNode) => number,
  nodes: readonly RoadNode[],
  allowed: (from: RoadNode, to: RoadNode) => boolean = () => true,
): void {
  w.s += ds;
  if (w.blend > 0) w.blend = Math.max(0, w.blend - ds);
  while (w.s >= w.len) {
    const extra = w.s - w.len;
    const end = lanePoint(w, w.len);
    const next = chooseNext(w, rng, nodes, allowed);
    w.from = w.to;
    w.to = next;
    w.len = Math.hypot(w.to.x - w.from.x, w.to.z - w.from.z) || 1;
    w.offset = offsetFor(w.from, w.to);
    w.s = extra;
    w.bx = end.x;
    w.bz = end.z;
    w.blend = BLEND;
  }
  placeWalker(w);
}

/** Ângulo (cosseno) da curva para a próxima ligação provável: 1 = reto. Usado para frear antes. */
export function chooseNext(w: Walker, rng: () => number, nodes: readonly RoadNode[], allowed: (from: RoadNode, to: RoadNode) => boolean): RoadNode {
  const here = w.to;
  const dx = (here.x - w.from.x) / w.len;
  const dz = (here.z - w.from.z) / w.len;
  const options = here.edges.map((e) => nodes[e.to]).filter((n) => n !== w.from && allowed(here, n));
  if (!options.length) return w.from; // sem saída: dá meia-volta
  const weights = options.map((n) => {
    const l = Math.hypot(n.x - here.x, n.z - here.z) || 1;
    const cos = ((n.x - here.x) * dx + (n.z - here.z) * dz) / l;
    return 0.4 + Math.max(0, cos) * 3;
  });
  let r = rng() * weights.reduce((a, c) => a + c, 0);
  for (let i = 0; i < options.length; i++) if ((r -= weights[i]) <= 0) return options[i];
  return options[options.length - 1];
}

/** Nó aleatório com ligações a uma distância entre rMin e rMax de (x, z) (ou null). */
export function randomNodeAround(graph: RoadGraph, x: number, z: number, rMin: number, rMax: number, rng: () => number, tries = 24): RoadNode | null {
  const nodes = graph.nodes;
  for (let i = 0; i < tries; i++) {
    const n = nodes[Math.floor(rng() * nodes.length)];
    if (!n.edges.length) continue;
    const d = Math.hypot(n.x - x, n.z - z);
    if (d >= rMin && d <= rMax) return n;
  }
  return null;
}

/** Altura do chão (colisores fixos do cenário; ignora carros, jogador e postes) com o relevo de reserva. */
export class GroundProbe {
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly filter = groups(0xffff, GROUP.WORLD);
  private readonly flags = RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;

  constructor(
    private readonly physics: RAPIER.World,
    private readonly heightAt: (x: number, z: number) => number,
  ) {}

  /** `from`: altura de onde o raio parte (acima de qualquer tabuleiro por onde se possa passar ali). */
  y(x: number, z: number, from = this.heightAt(x, z) + 30): number {
    this.ray.origin = { x, y: from, z };
    const hit = this.physics.castRay(this.ray, 80, true, this.flags, this.filter);
    return hit ? from - hit.timeOfImpact : this.heightAt(x, z);
  }
}
