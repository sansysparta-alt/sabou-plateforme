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

const calibrating = process.env.LH_CALIBRATE === '1';
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
  // Processeur : ÷ 4 sur un ordinateur rapide, calé sur la machine par scripts/lighthouse.mjs
  throttling: {
    rttMs: 300,
    throughputKbps: 700,
    cpuSlowdownMultiplier: Number(process.env.LH_CPU_SLOWDOWN ?? 4),
  },
};
// Préréglage « ordinateur » de Lighthouse (écran 1350 × 940, réseau et processeur peu bridés) :
// mise en page large, accessibilité et bonnes pratiques vérifiées dans ce format aussi
const desktop = { preset: 'desktop' };

// Seuils bloquants. Scores : mesure médiane (« median-run », choisie sur le score de
// performance). Valeurs mesurées (LCP, TBT…) : médiane des valeurs de toutes les mesures
// (« median ») ; « median-run » vérifiait le TBT de la seule mesure retenue pour son score,
// qui pouvait être la plus lente des cinq (226 ms sur Comptes dans le pipeline de main).
const budgets = {
  'categories:performance': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
  'categories:accessibility': ['error', { minScore: 1, aggregationMethod: 'median-run' }],
  'categories:best-practices': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
  // 3 s en 3G normale (300 ms, 700 kbit/s) : application à page unique, le contenu
  // attend React (60 Ko compressés). Piste pour descendre à 2,5 s : pré-générer la page
  // de connexion à la compilation (05_Choix_Techniques.md §2.20).
  'largest-contentful-paint': ['error', { maxNumericValue: 3000, aggregationMethod: 'median' }],
  'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, aggregationMethod: 'median' }],
  'total-blocking-time': ['error', { maxNumericValue: 200, aggregationMethod: 'median' }],
  'total-byte-weight': ['error', { maxNumericValue: 150 * 1024, aggregationMethod: 'median' }],
};
// Pages qui attendent des données (session, puis morceau de la page, puis API) : LCP de 4 s
// et score de 0,80 en 3G, décision du maître d'œuvre du 8/11/2026, jusqu'au récit de
// performance qui ramènera 3 s partout (05_Choix_Techniques.md §2.28, backlog)
const DATA_PAGES = /localhost:\d+\/(invitation|comptes|referentiels|verification-terrain|\?vue=)/;
const dataPageBudgets = {
  'categories:performance': ['error', { minScore: 0.8, aggregationMethod: 'median-run' }],
  'largest-contentful-paint': ['error', { maxNumericValue: 4000, aggregationMethod: 'median' }],
};

module.exports = {
  ci: {
    collect: {
      // Calibrage : une seule mesure de la première page, pour lire l'indice de la machine
      url: calibrating ? group.urls.slice(0, 1) : group.urls,
      // Médiane de 5 mesures sur téléphone (le temps de blocage varie sur l'exécuteur partagé
      // du pipeline : 231 ms une fois sur l'accueil, contre 0 à 24 ms sur le poste), 3 sur ordinateur
      numberOfRuns: calibrating ? 1 : formFactor === 'mobile' ? 5 : 3,
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
      assertMatrix: [
        { matchingUrlPattern: DATA_PAGES.source, assertions: { ...budgets, ...dataPageBudgets } },
        { matchingUrlPattern: `^(?!.*${DATA_PAGES.source})`, assertions: budgets },
      ],
    },
    // Rapports gardés sur le poste ou dans le pipeline : aucun envoi à un service externe
    upload: { target: 'filesystem', outputDir: `.lighthouse/${formFactor}` },
  },
};
