// Lighthouse CI (US-010) : pages livrées mesurées en 3G et processeur bridés (téléphone
// d'entrée de gamme), seuils bloquants. Chaque récit qui ajoute des pages les ajoute ici.
// Prérequis : environnement local démarré et application compilée (infra/ci/e2e-admin.sh).
// Fichier CommonJS : format de configuration lu par Lighthouse CI
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require('@playwright/test');

const app = `http://localhost:${process.env.ADMIN_PORT ?? 5173}`;
const keycloak = `http://localhost:${process.env.KEYCLOAK_PORT ?? 8080}`;
// Page de connexion Keycloak (thème SABOU) : demande d'autorisation sans session
const keycloakLogin =
  `${keycloak}/realms/sabou/protocol/openid-connect/auth?client_id=sabou-admin` +
  `&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(`${app}/auth/callback`)}` +
  `&code_challenge=${'A'.repeat(43)}&code_challenge_method=S256&state=lighthouse`;

module.exports = {
  ci: {
    collect: {
      url: [`${app}/`, keycloakLogin],
      startServerCommand: 'node scripts/serve.mjs',
      startServerReadyPattern: 'servie sur',
      numberOfRuns: 3,
      chromePath: chromium.executablePath(),
      settings: {
        formFactor: 'mobile',
        screenEmulation: { mobile: true, width: 360, height: 640, deviceScaleFactor: 2 },
        // « 3G normale » de Lighthouse : 300 ms d'aller-retour, 700 kbit/s, processeur ÷ 4
        throttlingMethod: 'simulate',
        throttling: { rttMs: 300, throughputKbps: 700, cpuSlowdownMultiplier: 4 },
        onlyCategories: ['performance', 'accessibility', 'best-practices'],
        chromeFlags: '--headless=new --no-sandbox',
      },
    },
    assert: {
      // Médiane des 3 mesures
      aggregationMethod: 'median-run',
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 1 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        // 3 s en 3G normale (300 ms, 700 kbit/s) : application à page unique, le contenu
        // attend React (60 Ko compressés). Piste pour descendre à 2,5 s : pré-générer la page
        // de connexion à la compilation (05_Choix_Techniques.md §2.20).
        'largest-contentful-paint': ['error', { maxNumericValue: 3000 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['error', { maxNumericValue: 200 }],
        'total-byte-weight': ['error', { maxNumericValue: 150 * 1024 }],
      },
    },
    // Rapports gardés sur le poste ou dans le pipeline : aucun envoi à un service externe
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
};
