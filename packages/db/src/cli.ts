// Base de l'environnement local (pnpm env:up) :
//   pnpm db:migrate   applique les migrations en attente
//   pnpm db:seed      charge le jeu d'exemple fictif dans une base migrée et vide
//   pnpm db:hash      recalcule atlas.sum après l'ajout d'une migration
// Les mots de passe sont lus dans le .env de la racine du dépôt.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { packageDir, runAtlas } from './atlas.ts';
import { migrate, runSqlFile } from './migrate.ts';

function readEnv(): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(join(packageDir, '..', '..', '.env'), 'utf8');
  } catch {
    throw new Error('.env introuvable : lancer d’abord « pnpm env:up ».');
  }
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => line.split(/=(.*)/s, 2) as [string, string]),
  );
}

async function main(command: string | undefined): Promise<void> {
  if (command === 'hash') {
    // Après l'ajout d'une migration : recalcule atlas.sum (jamais pour en modifier une appliquée)
    const result = runAtlas(['migrate', 'hash', '--dir', 'file:///migrations'], {
      writable: true,
    });
    if (!result.ok) throw new Error(result.output);
    console.log('atlas.sum recalculé.');
    return;
  }
  const env = readEnv();
  const password = encodeURIComponent(env.SABOU_MIGRATOR_PASSWORD);
  const url = `postgres://sabou_migrator:${password}@127.0.0.1:${env.POSTGRES_PORT}/sabou`;

  switch (command) {
    case 'migrate':
      console.log(
        await migrate({
          url,
          network: 'sabou_default',
          atlasUrl: `postgres://sabou_migrator:${password}@postgres:5432/sabou?sslmode=disable`,
        }),
      );
      break;
    case 'seed': {
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      const { rows } = await client
        .query<{ n: number }>('SELECT count(*)::int AS n FROM sabou.utilisateur')
        .finally(() => client.end());
      if (rows[0].n > 0) {
        throw new Error(
          'La base contient déjà des données : « pnpm env:reset » pour repartir à vide.',
        );
      }
      await runSqlFile(url, join(packageDir, 'seed', 'dev.sql'));
      console.log('Jeu d’exemple fictif chargé.');
      break;
    }
    default:
      throw new Error(`Commande inconnue : ${command ?? '(aucune)'} (migrate, seed ou hash)`);
  }
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
