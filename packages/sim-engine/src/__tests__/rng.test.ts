import { describe, expect, it } from 'vitest';
import { bivariatePoisson, mulberry32, poissonPmf, poissonSample } from '../rng';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('poisson sampler matches mean and variance', () => {
    const rng = mulberry32(7);
    const lambda = 1.4;
    const n = 50_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const x = poissonSample(rng, lambda);
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(mean).toBeGreaterThan(lambda - 0.04);
    expect(mean).toBeLessThan(lambda + 0.04);
    expect(variance).toBeGreaterThan(lambda - 0.08);
    expect(variance).toBeLessThan(lambda + 0.08);
  });

  it('bivariate poisson produces positive correlation', () => {
    const rng = mulberry32(11);
    const n = 30_000;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = bivariatePoisson(rng, 1.4, 1.1, 0.25);
      xs.push(x);
      ys.push(y);
    }
    const mx = xs.reduce((a, b) => a + b) / n;
    const my = ys.reduce((a, b) => a + b) / n;
    let cov = 0;
    for (let i = 0; i < n; i++) cov += (xs[i] - mx) * (ys[i] - my);
    cov /= n;
    expect(mx).toBeCloseTo(1.4, 1);
    expect(my).toBeCloseTo(1.1, 1);
    expect(cov).toBeGreaterThan(0.15);
  });

  it('poisson pmf sums to ~1', () => {
    let total = 0;
    for (let k = 0; k < 30; k++) total += poissonPmf(k, 2.3);
    expect(total).toBeCloseTo(1, 5);
  });
});
