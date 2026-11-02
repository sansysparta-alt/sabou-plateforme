import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { migrationsDir, runAtlas } from './atlas.ts';
import { findAlteredMigrations } from './verify.ts';

export interface MigrateOptions {
  // Adresse de la base vue depuis ce processus (contrôle des empreintes)
  url: string;
  // Réseau Docker et adresse de la même base vue depuis le conteneur d'Atlas
  network: string;
  atlasUrl: string;
  dir?: string;
}

// Applique les migrations en attente, chacune dans sa transaction ; la première erreur
// arrête tout (comportement d'Atlas). Refuse d'abord toute migration appliquée modifiée.
export async function migrate(options: MigrateOptions): Promise<string> {
  const dir = options.dir ?? migrationsDir;
  const client = new pg.Client({ connectionString: options.url });
  await client.connect();
  try {
    const altered = await findAlteredMigrations(
      client,
      readFileSync(join(dir, 'atlas.sum'), 'utf8'),
    );
    if (altered.length > 0) {
      throw new Error(
        `Migrations déjà appliquées modifiées ou retirées : ${altered.join(' ; ')}. ` +
          'Une migration appliquée ne se modifie pas : écrire une nouvelle migration.',
      );
    }
  } finally {
    await client.end();
  }

  const result = runAtlas(['migrate', 'apply', '--env', 'sabou'], {
    dir,
    network: options.network,
    databaseUrl: options.atlasUrl,
  });
  if (!result.ok) throw new Error(`Échec des migrations :\n${result.output}`);
  return result.output;
}

// Exécute un fichier SQL de plusieurs instructions (jeu d'exemple, requêtes d'exemple)
export async function runSqlFile(url: string, file: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(readFileSync(file, 'utf8'));
  } finally {
    await client.end();
  }
}
