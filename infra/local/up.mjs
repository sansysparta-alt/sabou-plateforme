// Environnement local en une commande, depuis PowerShell comme depuis Git Bash :
//   node infra/local/up.mjs [up | down | reset]
// up    : crée .env au premier lancement, construit l'API, démarre tout et attend
//         que chaque contrôle de santé soit vert ;
// down  : arrête les conteneurs, les données sont conservées ;
// reset : arrête et supprime les données (base, cache, fichiers) des volumes locaux.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = join(root, '.env');
const compose = ['compose', '--file', 'infra/local/compose.yaml', '--env-file', '.env'];

// Copie .env.example en remplissant chaque variable vide par un secret aléatoire
// (base64url : utilisable tel quel dans une URL de connexion)
function generateEnv(example) {
  return example
    .replaceAll('\r\n', '\n')
    .replace(/^([A-Z0-9_]+)=$/gm, (_, name) => `${name}=${randomBytes(24).toString('base64url')}`);
}

function ensureEnv() {
  const example = readFileSync(join(root, '.env.example'), 'utf8');
  if (existsSync(envFile)) {
    addMissingVariables(example);
    return;
  }
  // Lisible par son seul propriétaire (sans effet sous Windows, où le dossier utilisateur protège)
  writeFileSync(envFile, generateEnv(example), { mode: 0o600 });
  console.log('.env créé avec des mots de passe aléatoires (non versionné).');
}

// .env créé par une version précédente : ajoute les variables apparues depuis, sans
// toucher aux autres. Les rôles PostgreSQL ne sont créés qu'à l'initialisation du volume.
function addMissingVariables(example) {
  const present = new Set(Object.keys(readEnv()));
  const missing = generateEnv(example)
    .split('\n')
    .filter((line) => /^[A-Z0-9_]+=/.test(line) && !present.has(line.split('=')[0]));
  if (missing.length === 0) return;
  const current = readFileSync(envFile, 'utf8').replace(/\r?\n?$/, '\n');
  writeFileSync(envFile, `${current}${missing.join('\n')}\n`);
  console.log(`.env complété : ${missing.map((line) => line.split('=')[0]).join(', ')}.`);
  console.log(
    'Nouveaux rôles de base : lancer « node infra/local/up.mjs reset » (données locales effacées).',
  );
}

function readEnv() {
  return Object.fromEntries(
    readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => line.split(/=(.*)/s, 2)),
  );
}

function docker(args) {
  const result = spawnSync('docker', [...compose, ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) {
    console.error('Docker est introuvable : installer et démarrer Docker Desktop.');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main(command = 'up') {
  switch (command) {
    case 'up': {
      ensureEnv();
      docker(['up', '--detach', '--build', '--wait', '--wait-timeout', '300']);
      const env = readEnv();
      console.log(`
Environnement prêt, contrôles de santé verts :
  API          http://localhost:${env.API_PORT}/health/ready
  PowerSync    http://localhost:${env.POWERSYNC_PORT}/probes/liveness
  Keycloak     http://localhost:${env.KEYCLOAK_PORT} (admin, mot de passe dans .env)
  PostgreSQL   localhost:${env.POSTGRES_PORT}, base sabou
  Valkey       localhost:${env.VALKEY_PORT}
  S3           http://localhost:${env.S3_PORT}`);
      break;
    }
    case 'down':
      docker(['down']);
      break;
    case 'reset':
      docker(['down', '--volumes', '--remove-orphans']);
      break;
    default:
      console.error(`Commande inconnue : ${command} (up, down ou reset)`);
      process.exit(1);
  }
}

main(process.argv[2]);
