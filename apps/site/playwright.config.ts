import { defineConfig } from '@playwright/test';

// Tests de bout en bout du site (US-006 : vérification hors ligne d'un QR signé).
// Le site doit être compilé (pnpm build) ; les QR d'essai sont générés par e2e/samples.ts.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  // Les tests lancent et arrêtent eux-mêmes le serveur : un seul à la fois
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  reporter: [['list']],
  use: { headless: true },
});
