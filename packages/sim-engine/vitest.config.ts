import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@fifa/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
