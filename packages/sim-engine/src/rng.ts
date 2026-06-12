/**
 * Seedable PRNG + statistical samplers.
 * mulberry32 — fast, well-distributed 32-bit generator; every simulation is
 * reproducible from its seed (stored with results for auditability).
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

/** Derive a child seed deterministically (stream splitting). */
export function deriveSeed(seed: number, stream: number): number {
  let h = seed ^ 0x9e3779b9;
  h = Math.imul(h ^ stream, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Poisson sampler — Knuth for small lambda, normal approximation for large. */
export function poissonSample(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    const n = Math.round(normalSample(rng, lambda, Math.sqrt(lambda)));
    return Math.max(0, n);
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

/**
 * Correlated goal pair via trivariate reduction:
 * X = X1 + C, Y = X2 + C with C ~ Poisson(lambda3).
 */
export function bivariatePoisson(
  rng: Rng,
  lambda1: number,
  lambda2: number,
  lambda3: number,
): [number, number] {
  const l3 = Math.min(lambda3, lambda1 * 0.9, lambda2 * 0.9);
  const common = poissonSample(rng, Math.max(0, l3));
  const x = poissonSample(rng, Math.max(0.01, lambda1 - l3)) + common;
  const y = poissonSample(rng, Math.max(0.01, lambda2 - l3)) + common;
  return [x, y];
}

export function normalSample(rng: Rng, mean = 0, sd = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function weightedPick<T>(rng: Rng, items: T[], weightOf: (t: T) => number): T {
  let total = 0;
  for (const it of items) total += Math.max(0, weightOf(it));
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (const it of items) {
    r -= Math.max(0, weightOf(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

export function shuffled<T>(rng: Rng, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Poisson pmf (used by the analytic prediction matrix). */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}
