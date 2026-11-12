import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { inject } from 'vitest';
import { migrationsDir, packageDir, runAtlas } from '../src/atlas.ts';
import { migrate, runSqlFile } from '../src/migrate.ts';

export const seedFile = join(packageDir, 'seed', 'dev.sql');
export const queriesFile = join(packageDir, 'examples', 'queries.sql');

export interface TestDatabase {
  name: string;
  // Adresses de la base pour chaque rôle, vues depuis les tests
  url: { postgres: string; migrator: string; app: string };
  migrate(dir?: string): Promise<string>;
}

// Base neuve et vide, propriété de sabou_migrator, avec PostGIS (installé par le
// super-utilisateur, comme à l'initialisation du serveur)
export async function createDatabase(): Promise<TestDatabase> {
  const { host, port, network, passwords } = inject('server');
  const name = `t_${randomBytes(6).toString('hex')}`;
  const url = (user: string, password: string) =>
    `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${name}`;

  const admin = new pg.Client({
    connectionString: `postgres://postgres:${encodeURIComponent(passwords.postgres)}@${host}:${port}/sabou`,
  });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} OWNER sabou_migrator`);
  await admin.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${name} TO sabou_app`);
  await admin.query(`GRANT CONNECT ON DATABASE ${name} TO sabou_sync`);
  await admin.end();
  await runSql(url('postgres', passwords.postgres), 'CREATE EXTENSION postgis WITH SCHEMA public');

  const migrator = url('sabou_migrator', passwords.migrator);
  return {
    name,
    url: {
      postgres: url('postgres', passwords.postgres),
      migrator,
      app: url('sabou_app', passwords.app),
    },
    migrate: (dir?: string) =>
      migrate({
        url: migrator,
        network,
        atlasUrl: `postgres://sabou_migrator:${encodeURIComponent(passwords.migrator)}@postgres:5432/${name}?sslmode=disable`,
        dir,
      }),
  };
}

// Base migrée et chargée avec le jeu d'exemple
export async function createSeededDatabase(): Promise<TestDatabase> {
  const db = await createDatabase();
  await db.migrate();
  await runSqlFile(db.url.migrator, seedFile);
  return db;
}

export async function runSql(url: string, sql: string): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

// Exécute des instructions dans une transaction toujours annulée : chaque cas part
// du même état (celui du jeu d'exemple)
export async function inRolledBackTransaction(url: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL search_path = sabou, public; ${sql}`);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

// Lignes de la dernière instruction, dans une transaction toujours annulée
export async function lastRows(url: string, sql: string): Promise<Record<string, unknown>[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const results = (await client.query(`SET LOCAL search_path = sabou, public; ${sql}`)) as
      pg.QueryResult | pg.QueryResult[];
    return (Array.isArray(results) ? results.at(-1)! : results).rows;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

// Ouvre, dans la transaction en cours, le contexte de zone d'un compte du jeu d'exemple
// (identifiant Keycloak fictif tiré de l'adresse, voir seed/dev.sql)
export const openContext = (email: string): string =>
  `SELECT sabou.contexte_ouvrir(md5('sabou:${email}')::uuid);`;

// Copie de travail du dossier des migrations, pour les modifier sans toucher au dépôt
export function copyMigrations(): { dir: string; rehash(): void; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'sabou-migrations-'));
  cpSync(migrationsDir, dir, { recursive: true });
  return {
    dir,
    rehash() {
      const result = runAtlas(['migrate', 'hash', '--dir', 'file:///migrations'], {
        dir,
        writable: true,
      });
      if (!result.ok) throw new Error(result.output);
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
