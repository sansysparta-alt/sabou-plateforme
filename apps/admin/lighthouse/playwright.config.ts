import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

// Préparation de Lighthouse CI (scripts/lighthouse.mjs) : même environnement que les tests de
// bout en bout, seul le fichier de préparation est exécuté
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'prepare.spec.ts',
  webServer: undefined,
});
