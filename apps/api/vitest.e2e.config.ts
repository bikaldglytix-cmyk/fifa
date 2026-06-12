import { defineConfig } from 'vitest/config';

/**
 * E2E config: boots the COMPILED app (dist/) against a throwaway PGlite dir.
 * tsc emits the decorator metadata Nest DI needs (vitest's esbuild does not),
 * so `npm run build` runs first — see the test:e2e script.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.e2e.spec.ts', 'test/**/*.unit.spec.ts'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 240_000,
  },
});
