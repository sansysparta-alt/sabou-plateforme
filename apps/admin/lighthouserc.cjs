// Lighthouse CI (US-010, étendu par US-016) : chaque page livrée, connectée ou non, mesurée
// sur téléphone d'entrée de gamme en 3G et processeur bridés, puis sur ordinateur ; seuils
// bloquants. Lancé par scripts/lighthouse.mjs, qui ouvre les sessions (lighthouse/
// prepare.spec.ts) puis appelle Lighthouse groupe par groupe :
//   LH_GROUP       indice du groupe de pages dans .lighthouse/pages.json
//   LH_FORM_FACTOR « mobile » (défaut) ou « desktop »
// Chaque récit qui ajoute des pages les ajoute à la préparation.
// Fichier CommonJS : format de configuration lu par Lighthouse CI
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync, readFileSync } = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require('@playwright/test');

const formFactor = process.env.LH_FORM_FACTOR === 'desktop' ? 'desktop' : 'mobile';
const groups = existsSync('.lighthouse/pages.json')
  ? JSON.parse(readFileSync('.lighthouse/pages.json', 'utf8'))
  : [];
const group = groups[Number(process.env.LH_GROUP ?? 0)] ?? { cookie: '', urls: [] };

const mobile = {
  formFactor: 'mobile',
  screenEmulation: { mobile: true, width: 360, height: 640, deviceScaleFactor: 2 },
  // « 3G normale » de Lighthouse : 300 ms d'aller-retour, 700 kbit/s, processeur ÷ 4
  throttlingMethod: 'simulate',
  throttling: { rttMs: 300, throughputKbps: 700, cpuSlowdownMultiplier: 4 },
};
// Préréglage « ordinateur » de Lighthouse (écran 1350 × 940, réseau et processeur peu bridés) :
// mise en page large, accessibilité et bonnes pratiques vérifiées dans ce format aussi
const desktop = { preset: 'desktop' };

module.exports = {
  ci: {
    collect: {
      url: group.urls,
      numberOfRuns: 3,
      chromePath: chromium.executablePath(),
      settings: {
        ...(formFactor === 'desktop' ? desktop : mobile),
        // Session du groupe (comptes de test jetables) ; aucun cookie pour les pages publiques
        ...(group.cookie ? { extraHeaders: { Cookie: group.cookie } } : {}),
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
    upload: { target: 'filesystem', outputDir: `.lighthouse/${formFactor}` },
  },
};
