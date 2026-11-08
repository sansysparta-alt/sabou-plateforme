// Lighthouse CI sur chaque page livrée, téléphone puis ordinateur (US-016).
//   1. sert l'application compilée (scripts/serve.mjs) ;
//   2. ouvre les sessions nécessaires (lighthouse/prepare.spec.ts → .lighthouse/pages.json) ;
//   3. pour chaque format, mesure chaque groupe de pages avec les cookies de sa session, puis
//      vérifie les seuils (lighthouserc.cjs). Rapports dans .lighthouse/<format>/.
// Prérequis : environnement local démarré et application compilée (infra/ci/e2e-admin.sh).
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const FORM_FACTORS = ['mobile', 'desktop'];

// Outils lancés directement par Node, sans interpréteur de commandes
const require = createRequire(import.meta.url);
const CLI = {
  lhci: require.resolve('@lhci/cli/src/cli.js'),
  // cli.js n'est pas exporté par @playwright/test : chemin pris à côté de son point d'entrée
  playwright: join(dirname(require.resolve('@playwright/test')), 'cli.js'),
};

function run(tool, args, env = {}) {
  const result = spawnSync(process.execPath, [CLI[tool], ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return result.status === 0;
}

function serve() {
  const server = spawn(process.execPath, ['scripts/serve.mjs'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    server.on('exit', (code) => reject(new Error(`serveur arrêté (code ${code})`)));
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('servie sur')) resolve(server);
    });
  });
}

// Bridage du processeur calé sur la machine (méthode de Lighthouse) : × 4 pour un indice de
// performance de 2 000 (ordinateur rapide), proportionnellement moins sur une machine plus
// lente (exécuteur du pipeline), entre × 1 et × 4. Le téléphone simulé reste le même partout ;
// un multiplicateur fixe simulait sur l'exécuteur un téléphone plus lent que la cible.
function calibrateCpu() {
  if (!run('lhci', ['collect'], { LH_GROUP: '0', LH_CALIBRATE: '1' })) {
    throw new Error('mesure de calibrage en échec');
  }
  const lhr = readdirSync('.lighthouseci').find((f) => /^lhr-.*\.json$/.test(f));
  const index = JSON.parse(readFileSync(`.lighthouseci/${lhr}`, 'utf8')).environment.benchmarkIndex;
  const slowdown = Math.min(4, Math.max(1, Math.round(((4 * index) / 2000) * 10) / 10));
  console.log(`
Indice de performance de la machine : ${Math.round(index)} ; processeur divisé par ${slowdown}`);
  return slowdown;
}

const server = await serve();
let ok = false;
try {
  rmSync('.lighthouse', { recursive: true, force: true });
  if (!run('playwright', ['test', '--config', 'lighthouse/playwright.config.ts'])) {
    throw new Error('préparation des sessions en échec');
  }
  const groups = JSON.parse(readFileSync('.lighthouse/pages.json', 'utf8'));
  const cpuSlowdown = calibrateCpu();
  ok = true;
  for (const formFactor of FORM_FACTORS) {
    const env = { LH_FORM_FACTOR: formFactor, LH_CPU_SLOWDOWN: String(cpuSlowdown) };
    groups.forEach((group, index) => {
      console.log(`\nLighthouse ${formFactor} : ${group.name}`);
      const args = ['collect', ...(index > 0 ? ['--additive'] : [])];
      ok = run('lhci', args, { ...env, LH_GROUP: String(index) }) && ok;
    });
    // Seuils vérifiés format par format : une même adresse n'est jamais mélangée entre deux
    ok = run('lhci', ['assert'], env) && ok;
    run('lhci', ['upload'], env);
  }
} finally {
  server.kill();
}
process.exit(ok ? 0 : 1);
