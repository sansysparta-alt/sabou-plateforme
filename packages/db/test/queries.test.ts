// Le jeu d'exemple et toutes les requêtes d'exemple passent sur la base migrée ;
// le rôle de l'API a exactement les droits prévus (moindre privilège).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, queriesFile, runSql, type TestDatabase } from './helpers.ts';
import { runSqlFile } from '../src/migrate.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Requêtes d’exemple', () => {
  it('passent toutes sans erreur (recherche, workflows, CRUD, analytiques)', async () => {
    await expect(runSqlFile(db.url.app, queriesFile)).resolves.toBeUndefined();
  });
});

describe('Droits du rôle de l’API (sabou_app)', () => {
  it('lit et écrit les données', async () => {
    const { rows } = await runSql(db.url.app, 'SELECT count(*)::int AS n FROM sabou.langue');
    expect(rows[0].n).toBe(6);
  });

  it('ne modifie jamais la structure', async () => {
    await expect(runSql(db.url.app, 'CREATE TABLE sabou.intrus (id int)')).rejects.toThrow(
      'permission denied for schema sabou',
    );
    await expect(runSql(db.url.app, 'DROP TABLE sabou.langue')).rejects.toThrow(
      'must be owner of table langue',
    );
  });

  it('ajoute au journal d’audit sans pouvoir le modifier ni le vider (R-DON-02)', async () => {
    await runSql(
      db.url.app,
      `INSERT INTO sabou.journal_audit (action, objet_type) VALUES ('test', 'test')`,
    );
    for (const sql of [
      `UPDATE sabou.journal_audit SET action = 'x'`,
      'DELETE FROM sabou.journal_audit',
      'TRUNCATE sabou.journal_audit',
    ]) {
      await expect(runSql(db.url.app, sql)).rejects.toThrow(
        'permission denied for table journal_audit',
      );
    }
  });
});
