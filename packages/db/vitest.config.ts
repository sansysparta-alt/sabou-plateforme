import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    // Atlas et PostgreSQL tournent dans des conteneurs : délais à la mesure
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
