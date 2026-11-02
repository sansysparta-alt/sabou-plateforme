import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // FFmpeg tourne dans un conteneur, STOI sur 90 s : délais à la mesure
    testTimeout: 300_000,
    hookTimeout: 600_000,
  },
});
