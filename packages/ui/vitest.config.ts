import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Composants testés sur Preact, comme dans l'application de gestion qui les livre (US-017,
// mêmes alias que apps/admin/vite.config.ts)
const from = (id: string) => fileURLToPath(import.meta.resolve(id));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^react-dom\/client$/, replacement: from('preact/compat/client') },
      { find: /^react-dom$/, replacement: from('preact/compat') },
      { find: /^react\/jsx-(dev-)?runtime$/, replacement: from('preact/compat/jsx-runtime') },
      { find: /^react$/, replacement: from('preact/compat') },
      { find: /^@testing-library\/react$/, replacement: '@testing-library/preact' },
    ],
  },
  test: {
    environment: 'jsdom',
    // Poste chargé (tous les paquets testés ensemble) : délai d'un test plus large que les
    // 5 s par défaut, comme dans apps/admin
    testTimeout: 15_000,
  },
});
