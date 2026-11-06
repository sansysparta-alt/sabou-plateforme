// Lighthouse CI du site public (lot D : US-014) : mêmes conditions et mêmes seuils que
// l'application de gestion (apps/admin/lighthouserc.cjs, §2.20). Chaque récit qui ajoute des
// pages du site les ajoute ici. Prérequis : environnement local démarré et site compilé.
// Fichier CommonJS : format de configuration lu par Lighthouse CI
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require('@playwright/test');

const site = `http://localhost:${process.env.SITE_PORT ?? 3000}`;
const keycloak = `http://localhost:${process.env.KEYCLOAK_PORT ?? 8080}`;
// Page de connexion des citoyens (thème « sabou-public ») : demande d'autorisation sans session
const keycloakLogin =
  `${keycloak}/realms/sabou-public/protocol/openid-connect/auth?client_id=sabou-site` +
  `&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(`${site}/auth/citoyen/callback`)}` +
  `&code_challenge=${'A'.repeat(43)}&code_challenge_method=S256&state=lighthouse`;

module.exports = {
  ci: {
    collect: {
      url: [`${site}/inscription`, `${site}/connexion`, keycloakLogin],
      startServerCommand: `pnpm exec next start --port ${process.env.SITE_PORT ?? 3000}`,
      startServerReadyPattern: 'Ready',
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
      // Médiane des 3 mesures, pour chaque groupe de pages
      assertMatrix: [
        {
          // Page de connexion Keycloak : tous les seuils bloquants, comme pour l'administration
          matchingUrlPattern: '/realms/sabou-public/',
          aggregationMethod: 'median-run',
          assertions: {
            'categories:performance': ['error', { minScore: 0.9 }],
            'categories:accessibility': ['error', { minScore: 1 }],
            'categories:best-practices': ['error', { minScore: 0.9 }],
            'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
            'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
            'total-blocking-time': ['error', { maxNumericValue: 200 }],
            'total-byte-weight': ['error', { maxNumericValue: 150 * 1024 }],
          },
        },
        {
          // Pages du site : accessibilité, bonnes pratiques et stabilité bloquantes. La vitesse
          // est mesurée mais seulement signalée : le socle de Next.js et React (~140 Ko de
          // JavaScript) donne en 3G simulée un LCP d'environ 4,9 s et un TBT d'environ 600 ms,
          // même pour une page sans code client (mesure du 6 novembre 2026). Traité par
          // US-118 (« le site est rapide en 3G », S13) ; seuils à rendre bloquants à ce moment.
          matchingUrlPattern: '^http://localhost:[0-9]+/(?!realms)',
          aggregationMethod: 'median-run',
          assertions: {
            'categories:accessibility': ['error', { minScore: 1 }],
            'categories:best-practices': ['error', { minScore: 0.9 }],
            'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
            'categories:performance': ['warn', { minScore: 0.9 }],
            'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }],
            'total-blocking-time': ['warn', { maxNumericValue: 200 }],
            'total-byte-weight': ['warn', { maxNumericValue: 150 * 1024 }],
          },
        },
      ],
    },
    // Rapports gardés sur le poste ou dans le pipeline : aucun envoi à un service externe
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
};
