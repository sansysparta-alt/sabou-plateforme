import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

// Comptes et dossiers d'essai pour la vérification dans le navigateur par le maître d'œuvre
// (fin de sprint). Même environnement que les tests de bout en bout ; aucune page ouverte.
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'comptes.spec.ts',
  webServer: undefined,
});
