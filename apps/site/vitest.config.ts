import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Tests de bout en bout : lancés par Playwright (pnpm e2e), pas par Vitest
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
