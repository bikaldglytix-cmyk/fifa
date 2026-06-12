/** Small shared helpers (no runtime deps). */

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const round = (v: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export const mean = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0);

export const stddev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
};

export const ageOn = (dateOfBirth: string, onDate: string): number => {
  const dob = new Date(dateOfBirth + 'T00:00:00Z');
  const on = new Date(onDate + 'T00:00:00Z');
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const m = on.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < dob.getUTCDate())) age--;
  return age;
};

/** Wilson score interval (95%) for a binomial proportion — used for sim CIs. */
export const wilsonInterval = (successes: number, n: number): { low: number; high: number } => {
  if (n === 0) return { low: 0, high: 1 };
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (center - margin) / denom), high: Math.min(1, (center + margin) / denom) };
};

export const formatPct = (p: number, dp = 1): string => `${(p * 100).toFixed(dp)}%`;

/** Deterministic 32-bit FNV-1a hash for cache keys / seeds. */
export const fnv1a = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

export const generateJoinCode = (rand: () => number = Math.random): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[Math.floor(rand() * alphabet.length)];
  return code;
};
