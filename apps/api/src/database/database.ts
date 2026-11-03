import { Logger } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

// Tables typées à partir des migrations (US-003)
export type Database = Kysely<Record<string, never>>;

export const DATABASE = Symbol('DATABASE');

const logger = new Logger('Database');

export function createDatabase(url: string): Database {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    // Échec rapide plutôt qu'une requête qui reste suspendue si la base ne répond plus
    connectionTimeoutMillis: 2_000,
    query_timeout: 5_000,
    application_name: 'sabou-api',
    // Les fonctions et déclencheurs du schéma résolvent leurs tables par le search_path
    options: '-c search_path=sabou,public',
  });
  // Une connexion au repos coupée par la base (redémarrage, bascule) émet « error » sur le pool :
  // sans écouteur, Node arrête le processus. Le pool la remplace à la requête suivante.
  pool.on('error', (error) => logger.warn(`Connexion à la base perdue : ${error.message}`));
  return new Kysely({ dialect: new PostgresDialect({ pool }) });
}
