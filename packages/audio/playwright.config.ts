import { defineConfig } from '@playwright/test';

// Mesure de la lecture en 3G simulée (US-005). FFmpeg (Docker) prépare la voix traitée.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  reporter: [['list']],
  use: { headless: true },
});
