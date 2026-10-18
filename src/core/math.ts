// Utilidades matemáticas independentes de framerate.

/** Fator de interpolação para suavização exponencial: lerp(a, b, damp(rate, dt)). */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Diferença angular no intervalo [-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Normaliza um ângulo para [-PI, PI]. */
export function wrapAngle(a: number): number {
  return angleDelta(0, a);
}

export function dampAngle(from: number, to: number, rate: number, dt: number): number {
  return from + angleDelta(from, to) * damp(rate, dt);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
