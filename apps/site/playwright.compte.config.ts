import { defineConfig } from '@playwright/test';

// Compte citoyen de bout en bout (lot D : US-014) : site compilé, API, Keycloak (domaine
// « sabou-public »), Valkey et PostgreSQL réels. Prérequis : environnement local démarré
// (pnpm env:up), base migrée, site compilé (pnpm --filter @sabou/site build).
// Le site écoute sur SITE_PORT : c'est l'adresse de retour enregistrée dans Keycloak.
const port = Number(process.env.SITE_PORT ?? 3000);

export default defineConfig({
  testDir: 'e2e-compte',
  testMatch: '*.spec.ts',
  // Un test à la fois : vraies sessions Keycloak, codes lus dans le journal de l'API
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { headless: true, locale: 'fr-FR', baseURL: `http://localhost:${port}` },
  webServer: {
    command: `next start --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
  },
});
