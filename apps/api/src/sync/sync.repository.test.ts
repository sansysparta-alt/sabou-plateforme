import { randomUUID } from 'node:crypto';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import { describe, expect, it } from 'vitest';
import type { Database } from '../database/database';
import { PgSyncRepository } from './sync.repository';
import type { UploadOperation } from './sync.schema';

// Base simulée : journalise chaque requête ; la fonction de réception lève une erreur
// métier (P0001) ou technique pour les identifiants choisis. La règle elle-même est
// prouvée sur un vrai PostgreSQL (packages/db/test/saisie-conflit.test.ts).
function fakeDatabase(failures: Map<string, string>) {
  const log: string[] = [];
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      log.push(query.sql.trim().split(/\s+/).slice(0, 3).join(' '));
      const id = query.parameters[0];
      if (
        query.sql.includes('saisie_terrain_recevoir') &&
        typeof id === 'string' &&
        failures.has(id)
      ) {
        throw Object.assign(new Error('refus'), { code: failures.get(id) });
      }
      return { rows: [{ result: 'creee' }] as R[] };
    },
    // eslint-disable-next-line require-yield
    async *streamQuery() {
      throw new Error('non utilisé');
    },
  };
  const driver: Driver = {
    init: async () => undefined,
    acquireConnection: async () => connection,
    beginTransaction: async () => void log.push('BEGIN'),
    commitTransaction: async () => void log.push('COMMIT'),
    rollbackTransaction: async () => void log.push('ROLLBACK'),
    releaseConnection: async () => undefined,
    destroy: async () => undefined,
  };
  const db: Database = new Kysely({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, log };
}

const op = (kind: UploadOperation['op'] = 'PUT'): UploadOperation => ({
  op: kind,
  table: 'saisie_terrain',
  id: randomUUID(),
  type: 'dossier',
  contenu: { praticien: 'A' },
  version_base: null,
});

describe('PgSyncRepository (US-004)', () => {
  it('un refus métier n’annule que son opération : les autres sont enregistrées', async () => {
    const [ok1, refused, ok2] = [op(), op(), op()];
    const { db, log } = fakeDatabase(new Map([[refused.id, 'P0001']]));
    const results = await new PgSyncRepository(db).receive(3, [ok1, refused, ok2]);

    expect(results).toEqual([
      { id: ok1.id, result: 'creee' },
      { id: refused.id, result: 'refusee' },
      { id: ok2.id, result: 'creee' },
    ]);
    expect(log).toContain('ROLLBACK TO SAVEPOINT');
    expect(log.at(-1)).toBe('COMMIT');
  });

  it('une panne technique annule tout le lot : le téléphone le renverra en entier', async () => {
    const [ok, broken] = [op(), op()];
    const { db, log } = fakeDatabase(new Map([[broken.id, '57P01']]));
    await expect(new PgSyncRepository(db).receive(3, [ok, broken])).rejects.toThrow('refus');
    expect(log.at(-1)).toBe('ROLLBACK');
    expect(log).not.toContain('COMMIT');
  });

  it('refuse une suppression sans toucher à la base', async () => {
    const { db, log } = fakeDatabase(new Map());
    const deletion = op('DELETE');
    expect(await new PgSyncRepository(db).receive(3, [deletion])).toEqual([
      { id: deletion.id, result: 'refusee' },
    ]);
    expect(log.filter((q) => q.includes('saisie_terrain_recevoir'))).toEqual([]);
  });
});
