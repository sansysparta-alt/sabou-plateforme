// Lighthouse CI sur chaque page livrée, téléphone puis ordinateur (US-016).
//   1. sert l'application compilée (scripts/serve.mjs) ;
//   2. ouvre les sessions nécessaires (lighthouse/prepare.spec.ts → .lighthouse/pages.json) ;
//   3. pour chaque format, mesure chaque groupe de pages avec les cookies de sa session, puis
//      vérifie les seuils (lighthouserc.cjs). Rapports dans .lighthouse/<format>/.
// Prérequis : environnement local démarré et application compilée (infra/ci/e2e-admin.sh).
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

const FORM_FACTORS = ['mobile', 'desktop'];

function run(command, args, env = {}) {
  // shell : pnpm est un script .cmd sous Windows ; aucun argument ne vient de l'extérieur
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: true,
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

const server = await serve();
let ok = false;
try {
  rmSync('.lighthouse', { recursive: true, force: true });
  if (!run('pnpm', ['exec', 'playwright', 'test', '--config', 'lighthouse/playwright.config.ts'])) {
    throw new Error('préparation des sessions en échec');
  }
  const groups = JSON.parse(readFileSync('.lighthouse/pages.json', 'utf8'));
  ok = true;
  for (const formFactor of FORM_FACTORS) {
    const env = { LH_FORM_FACTOR: formFactor };
    groups.forEach((group, index) => {
      console.log(`\nLighthouse ${formFactor} : ${group.name}`);
      const args = ['exec', 'lhci', 'collect', ...(index > 0 ? ['--additive'] : [])];
      ok = run('pnpm', args, { ...env, LH_GROUP: String(index) }) && ok;
    });
    // Seuils vérifiés format par format : une même adresse n'est jamais mélangée entre deux
    ok = run('pnpm', ['exec', 'lhci', 'assert'], env) && ok;
    run('pnpm', ['exec', 'lhci', 'upload'], env);
  }
} finally {
  server.kill();
}
process.exit(ok ? 0 : 1);
