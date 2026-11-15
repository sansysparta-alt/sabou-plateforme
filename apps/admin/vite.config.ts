/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig, type ProxyOptions } from 'vite';

// /auth et /api sont servis par l'API sous la même origine que l'application (US-010) : le cookie de
// session reste « same-origin ». En production, c'est le serveur frontal qui fait ce relais.
const port = Number(process.env.ADMIN_PORT ?? 5173);
const api: ProxyOptions = {
  target: `http://127.0.0.1:${process.env.API_PORT ?? 4000}`,
  // Premier mandataire : l'IP du client (journal d'audit, US-030) est celle de la connexion,
  // jamais un en-tête X-Forwarded-For ou Forwarded envoyé par le client lui-même
  configure: (server) => {
    server.on('proxyReq', (proxyReq, req) => {
      proxyReq.removeHeader('forwarded');
      proxyReq.setHeader('x-forwarded-for', req.socket.remoteAddress ?? '');
    });
  },
};
// /auth : connexion (US-010) ; /api : gestion des comptes et suivantes (lot A)
const proxy: Record<string, ProxyOptions> = { '/auth': api, '/api': api };

// US-017 : Preact (compatibilité React) à la place de React : 4 Ko compressés au lieu de 60,
// soit environ 0,7 s de moins en 3G avant le premier affichage (05_Choix_Techniques.md §2.46).
// Le code reste écrit pour React ; ces alias suffisent à revenir en arrière.
// Chemins absolus : le paquet partagé @sabou/ui importe « react » depuis son propre dossier
const from = (id: string) => fileURLToPath(import.meta.resolve(id));
const preact = [
  { find: /^react-dom\/test-utils$/, replacement: from('preact/compat/test-utils') },
  { find: /^react-dom\/client$/, replacement: from('preact/compat/client') },
  { find: /^react-dom$/, replacement: from('preact/compat') },
  { find: /^react\/jsx-(dev-)?runtime$/, replacement: from('preact/compat/jsx-runtime') },
  { find: /^react$/, replacement: from('preact/compat') },
];

export default defineConfig({
  resolve: { alias: preact },
  // Adresse de retour enregistrée dans Keycloak : le port ne doit pas changer en silence
  server: { port, strictPort: true, proxy },
  preview: { port, strictPort: true, proxy },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    exclude: ['e2e/**', 'lighthouse/**', 'node_modules/**'],
    // Au-delà du délai des recherches de Testing Library (5 s, src/test-setup.ts) : sur un poste
    // chargé, une recherche lente doit échouer avec son propre message, pas faire expirer le test
    testTimeout: 15_000,
    // Tests sur Preact, comme l'application livrée : même interface que la version React
    alias: [{ find: /^@testing-library\/react$/, replacement: '@testing-library/preact' }],
  },
});
