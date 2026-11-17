// Environnement local en une commande, depuis PowerShell comme depuis Git Bash :
//   node infra/local/up.mjs [up | down | reset | realm]
// up    : crée .env au premier lancement, construit l'API, démarre tout et attend
//         que chaque contrôle de santé soit vert ;
// down  : arrête les conteneurs, les données sont conservées ;
// reset : arrête et supprime les données (base, cache, fichiers) des volumes locaux ;
// realm : réimporte les domaines Keycloak « sabou » et « sabou-public » depuis
//         infra/local/keycloak/ (comptes locaux de ces domaines effacés).
// Projet Docker : « sabou » (compose.yaml). COMPOSE_PROJECT_NAME en donne un autre, avec ses
// propres volumes : pour tester une branche dont les migrations divergent de celles déjà
// appliquées à la base locale, sans effacer celle-ci (arrêter d'abord l'autre projet : mêmes ports).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = join(root, '.env');
const compose = ['compose', '--file', 'infra/local/compose.yaml', '--env-file', '.env'];

// Copie .env.example en remplissant chaque variable vide par un secret aléatoire
// (base64url : utilisable tel quel dans une URL de connexion ; 256 bits, assez pour une clé HS256)
function generateEnv(example) {
  return example
    .replaceAll('\r\n', '\n')
    .replace(/^([A-Z0-9_]+)=$/gm, (_, name) => `${name}=${randomBytes(32).toString('base64url')}`);
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

// Domaines versionnés : administration (US-010) et citoyens (lot D)
const REALMS = ['sabou', 'sabou-public'];

// Keycloak n'importe le domaine qu'à sa création : on le supprime, puis on redémarre
// Keycloak, qui le recrée depuis le fichier versionné.
async function reimportRealm() {
  const env = readEnv();
  const base = `http://localhost:${env.KEYCLOAK_PORT}`;
  const token = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'admin',
      password: env.KEYCLOAK_ADMIN_PASSWORD,
    }),
  }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Keycloak : ${r.status}`))));
  for (const realm of REALMS) {
    const removed = await fetch(`${base}/admin/realms/${realm}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!removed.ok && removed.status !== 404) {
      console.error(`Suppression du domaine ${realm} impossible : ${removed.status}`);
      process.exit(1);
    }
  }
  docker(['restart', 'keycloak']);
  docker(['up', '--detach', '--wait', '--wait-timeout', '300', 'keycloak']);
  console.log(`Domaines ${REALMS.join(', ')} réimportés depuis infra/local/keycloak/.`);
}

async function main(command = 'up') {
  // Avant toute commande : Compose refuse un .env auquel manque une variable
  if (['up', 'down', 'reset', 'realm'].includes(command)) ensureEnv();
  switch (command) {
    case 'up': {
      docker(['up', '--detach', '--build', '--wait', '--wait-timeout', '300']);
      const env = readEnv();
      console.log(`
Environnement prêt, contrôles de santé verts :
  API          http://localhost:${env.API_PORT}/health/ready
  PowerSync    http://localhost:${env.POWERSYNC_PORT}/probes/liveness
  Keycloak     http://localhost:${env.KEYCLOAK_PORT} (admin, mot de passe dans .env)
  PostgreSQL   localhost:${env.POSTGRES_PORT}, base sabou
  Valkey       localhost:${env.VALKEY_PORT}
  S3           http://localhost:${env.S3_PORT}
  Mailpit      http://localhost:${env.MAILPIT_PORT ?? 8025} (e-mails envoyés par Keycloak)`);
      break;
    }
    case 'realm':
      await reimportRealm();
      break;
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

await main(process.argv[2]);
