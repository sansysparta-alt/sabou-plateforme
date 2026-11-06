/// <reference types="vitest/config" />
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// /auth est servi par l'API sous la même origine que l'application (US-010) : le cookie de
// session reste « same-origin ». En production, c'est le serveur frontal qui fait ce relais.
const port = Number(process.env.ADMIN_PORT ?? 5173);
const proxy: Record<string, ProxyOptions> = {
  '/auth': {
    target: `http://127.0.0.1:${process.env.API_PORT ?? 4000}`,
    // Premier mandataire : l'IP du client (journal d'audit, US-030) est celle de la connexion,
    // jamais un en-tête X-Forwarded-For ou Forwarded envoyé par le client lui-même
    configure: (server) => {
      server.on('proxyReq', (proxyReq, req) => {
        proxyReq.removeHeader('forwarded');
        proxyReq.setHeader('x-forwarded-for', req.socket.remoteAddress ?? '');
      });
    },
  },
};

export default defineConfig({
  plugins: [react()],
  // Adresse de retour enregistrée dans Keycloak : le port ne doit pas changer en silence
  server: { port, strictPort: true, proxy },
  preview: { port, strictPort: true, proxy },
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
