import { defineConfig } from '@playwright/test';

// Tests de bout en bout de l'application de gestion (US-010). Prérequis : environnement local
// démarré (pnpm env:up) et application compilée (pnpm --filter @sabou/admin build).
const port = Number(process.env.ADMIN_PORT ?? 5173);

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  // Un test à la fois : chacun ouvre de vraies sessions Keycloak, la sortie reste lisible
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { headless: true, locale: 'fr-FR' },
  webServer: {
    // Fichiers compilés, compressés comme en production ; /auth relayé vers l'API
    command: 'node scripts/serve.mjs',
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
