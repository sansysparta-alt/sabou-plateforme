import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Fichiers de test exécutés en même temps au plus : au-delà de 2 sur le poste de 7 Go, les
// démarrages dépassent leurs délais (beforeAll, Testing Library). TEST_WORKERS permet d'élargir
// sur une machine plus grosse (05_Choix_Techniques.md, contrôles du pipeline).
const testWorkers = Number.parseInt(process.env.TEST_WORKERS ?? '', 10) || 2;

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    maxWorkers: testWorkers,
    // Tests de bout en bout : lancés par Playwright (pnpm e2e), pas par Vitest
    exclude: [...configDefaults.exclude, 'e2e/**', 'e2e-compte/**'],
  },
});
