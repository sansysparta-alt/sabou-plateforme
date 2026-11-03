import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // FFmpeg tourne dans un conteneur, STOI sur 90 s : délais à la mesure
    testTimeout: 300_000,
    hookTimeout: 600_000,
    // Mesure de lecture en 3G : lancée par Playwright (pnpm lecture), pas par Vitest
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
