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
  if (existsSync(envFile)) return;
  const example = readFileSync(join(root, '.env.example'), 'utf8');
  // Lisible par son seul propriétaire (sans effet sous Windows, où le dossier utilisateur protège)
  writeFileSync(envFile, generateEnv(example), { mode: 0o600 });
  console.log('.env créé avec des mots de passe aléatoires (non versionné).');
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
