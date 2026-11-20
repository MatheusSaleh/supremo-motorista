// Fila de estados recebidos pela rede e interpolação entre eles (carros dos outros jogadores e
// perseguidores do anfitrião).
//
// Os estados saem a intervalos regulares e chegam com tremidas. Quem desenha pede a pose num instante um
// pouco no passado (interpDelay) e recebe a interpolação entre os dois estados em volta dele; se os
// pacotes atrasarem, a pose é projetada para frente por pouco tempo.
import * as THREE from 'three';
import { SEND_RATE } from './protocol';

export interface Pose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

/** Acima deste salto (m) entre dois estados, é teleporte (R, troca de carro, novo perseguidor): não interpola. */
export const TELEPORT_DISTANCE = 8;

interface Snapshot<T> {
  t: number;
  s: T;
}

export class SnapshotBuffer<T extends Pose> {
  private readonly buffer: Snapshot<T>[] = [];
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();

  get empty(): boolean {
    return this.buffer.length === 0;
  }

  /** Último estado recebido (sem atraso), para quem precisa da posição mais nova (IA do anfitrião). */
  get latest(): T | null {
    return this.buffer[this.buffer.length - 1]?.s ?? null;
  }

  /** Instante (s) da chegada do último estado. */
  get latestTime(): number {
    return this.buffer[this.buffer.length - 1]?.t ?? -Infinity;
  }

  /** Velocidade (m/s) entre os dois últimos estados. */
  velocity(out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const b = this.buffer;
    out.x = out.y = out.z = 0;
    if (b.length < 2) return out;
    const a = b[b.length - 2];
    const c = b[b.length - 1];
    const dt = c.t - a.t;
    if (dt <= 1e-3 || Math.hypot(c.s.x - a.s.x, c.s.z - a.s.z) > TELEPORT_DISTANCE) return out;
    out.x = (c.s.x - a.s.x) / dt;
    out.y = (c.s.y - a.s.y) / dt;
    out.z = (c.s.z - a.s.z) / dt;
    return out;
  }

  push(state: T, now: number): void {
    // Chegada perto do horário esperado: usa o esperado (movimento uniforme); longe: ressincroniza.
    const last = this.buffer[this.buffer.length - 1];
    const expected = last ? last.t + 1 / SEND_RATE : now;
    const t = last && Math.abs(now - expected) < 0.06 ? expected : now;
    this.buffer.push({ t, s: state });
    if (this.buffer.length > 40) this.buffer.splice(0, this.buffer.length - 40);
  }

  clear(): void {
    this.buffer.length = 0;
  }

  /**
   * Pose no instante `t` (em `pos`/`rot`) e o estado mais próximo dele (para flags, velocidade...).
   * `extrapolate(s)` diz se dá para projetar a partir de `s` (ex.: não a pé).
   */
  sample(t: number, pos: THREE.Vector3, rot: THREE.Quaternion, maxExtrapolation: number, extrapolate: (s: T) => boolean = () => true): T | null {
    const b = this.buffer;
    if (b.length === 0) return null;
    // Descarta o que já passou, mantendo um estado antes de `t`.
    while (b.length > 2 && b[1].t <= t) b.shift();
    const a = b[0];
    const next = b[1];
    if (t < a.t) {
      // Ainda antes do primeiro estado guardado (acabou de chegar): fica nele.
      pos.set(a.s.x, a.s.y, a.s.z);
      rot.set(a.s.qx, a.s.qy, a.s.qz, a.s.qw).normalize();
      return a.s;
    }
    if (next) {
      const k = Math.min(1, (t - a.t) / Math.max(1e-3, next.t - a.t));
      const jump = Math.hypot(next.s.x - a.s.x, next.s.y - a.s.y, next.s.z - a.s.z) > TELEPORT_DISTANCE;
      const kk = jump ? (k < 1 ? 0 : 1) : k;
      pos.set(a.s.x + (next.s.x - a.s.x) * kk, a.s.y + (next.s.y - a.s.y) * kk, a.s.z + (next.s.z - a.s.z) * kk);
      rot.slerpQuaternions(this.qa.set(a.s.qx, a.s.qy, a.s.qz, a.s.qw).normalize(), this.qb.set(next.s.qx, next.s.qy, next.s.qz, next.s.qw).normalize(), kk);
      return kk < 0.5 ? a.s : next.s;
    }
    // Só um estado, ou `t` passou do último: projeta pela velocidade dos dois últimos, por pouco tempo.
    const last = b[b.length - 1];
    const prev = b.length > 1 ? b[b.length - 2] : null;
    let ahead = Math.min(Math.max(0, t - last.t), maxExtrapolation);
    if (!prev || !extrapolate(last.s)) ahead = 0;
    const span = prev ? Math.max(1e-3, last.t - prev.t) : 1;
    const vx = prev ? (last.s.x - prev.s.x) / span : 0;
    const vy = prev ? (last.s.y - prev.s.y) / span : 0;
    const vz = prev ? (last.s.z - prev.s.z) / span : 0;
    pos.set(last.s.x + vx * ahead, last.s.y + vy * ahead, last.s.z + vz * ahead);
    rot.set(last.s.qx, last.s.qy, last.s.qz, last.s.qw).normalize();
    return last.s;
  }
}
