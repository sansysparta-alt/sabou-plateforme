import { defineConfig } from 'vitest/config';

// Fichiers de test de la base exécutés en même temps au plus. Chacun ouvre ses connexions à
// PostgreSQL et s'adresse à Keycloak : au-delà de 2 sur le poste de 7 Go, connexions coupées
// (ECONNRESET) et délais dépassés. DB_TEST_WORKERS permet d'élargir sur une machine plus grosse.
const workers = Number.parseInt(process.env.DB_TEST_WORKERS ?? '', 10);

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    maxWorkers: Number.isInteger(workers) && workers > 0 ? workers : 2,
    // Atlas et PostgreSQL tournent dans des conteneurs : délais à la mesure
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
