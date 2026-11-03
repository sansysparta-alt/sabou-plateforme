// Jeton de synchronisation pour un compte du jeu d'exemple, en développement seulement :
//   pnpm --filter @sabou/api build, puis pnpm --filter @sabou/api sync:token <agent> <préfecture>
// La clé est lue dans le .env local (POWERSYNC_JWT_SECRET) ; le jeton dure 12 heures.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signSyncToken } from './sync-token';

async function main(): Promise<void> {
  const [id, prefectureId] = process.argv.slice(2).map(Number);
  if (!id || !prefectureId) {
    console.error('Usage : sync:token <agent> <préfecture>   (ex. 3 4 pour l’agent de Labé)');
    process.exit(1);
  }
  // Lancé par pnpm depuis apps/api
  const env = readFileSync(join(process.cwd(), '..', '..', '.env'), 'utf8');
  const secret = /^POWERSYNC_JWT_SECRET=(.+)$/m.exec(env)?.[1]?.trim();
  if (!secret) throw new Error('POWERSYNC_JWT_SECRET absent de .env : lancer pnpm env:up');
  console.log(await signSyncToken({ id, role: 'prefectoral', prefectureId }, secret));
}

void main();
