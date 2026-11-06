/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /auth est servi par l'API sous la même origine que l'application (US-010) : le cookie de
// session reste « same-origin ». En production, c'est le serveur frontal qui fait ce relais.
const port = Number(process.env.ADMIN_PORT ?? 5173);
const proxy = { '/auth': { target: `http://127.0.0.1:${process.env.API_PORT ?? 4000}` } };

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
