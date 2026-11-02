// US-003, critères 1 et 3 : migrations sur base vide avec arrêt sur erreur ;
// une migration déjà appliquée puis modifiée est détectée et refusée.
import { appendFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrationsDir } from '../src/atlas.ts';
import { copyMigrations, createDatabase, runSql } from './helpers.ts';

const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
const firstMigration = migrationFiles[0];
const firstVersion = firstMigration.split('_')[0];

async function revisions(url: string) {
  const { rows } = await runSql(
    url,
    `SELECT version, error FROM atlas_schema_revisions.atlas_schema_revisions ORDER BY version`,
  );
  return rows as { version: string; error: string | null }[];
}

describe('Migrations sur une base vide', () => {
  it('réussissent toutes, sans erreur', async () => {
    const db = await createDatabase();
    await db.migrate();

    const applied = await revisions(db.url.migrator);
    expect(applied.map((r) => r.version)).toEqual(migrationFiles.map((f) => f.split('_')[0]));
    expect(applied.every((r) => !r.error)).toBe(true);
    // Une seconde exécution ne fait rien et ne casse rien
    expect(await db.migrate()).toContain('No migration files to execute');
  });

  it("s'arrêtent à la première erreur, sans rien laisser de la migration fautive", async () => {
    const copy = copyMigrations();
    try {
      writeFileSync(
        join(copy.dir, '20991231000000_fautive.sql'),
        'CREATE TABLE sabou.avant_erreur (id int);\nSELECT 1 / 0;\nCREATE TABLE sabou.apres_erreur (id int);\n',
      );
      copy.rehash();
      const db = await createDatabase();

      await expect(db.migrate(copy.dir)).rejects.toThrow(/division by zero/);
      const { rows } = await runSql(
        db.url.migrator,
        `SELECT to_regclass('sabou.avant_erreur') AS avant, to_regclass('sabou.apres_erreur') AS apres,
                to_regclass('sabou.langue') AS schema_initial`,
      );
      // Migration fautive annulée en entier ; les précédentes restent appliquées
      expect(rows[0]).toEqual({ avant: null, apres: null, schema_initial: 'sabou.langue' });
    } finally {
      copy.cleanup();
    }
  });
});

describe('Migration déjà appliquée puis modifiée', () => {
  let copy: ReturnType<typeof copyMigrations>;
  afterEach(() => copy.cleanup());

  async function appliedThenEdited() {
    copy = copyMigrations();
    const db = await createDatabase();
    await db.migrate(copy.dir);
    appendFileSync(join(copy.dir, firstMigration), '\n-- modification après application\n');
    return db;
  }

  it('est refusée par Atlas tant que atlas.sum n’est pas recalculé', async () => {
    const db = await appliedThenEdited();
    await expect(db.migrate(copy.dir)).rejects.toThrow(/checksum mismatch/);
  });

  it('est refusée par le contrôle des empreintes même après « atlas migrate hash »', async () => {
    const db = await appliedThenEdited();
    copy.rehash();
    await expect(db.migrate(copy.dir)).rejects.toThrow(
      `${firstVersion} : modifiée après son application`,
    );
  });

  it('est refusée si elle a été retirée du dossier', async () => {
    copy = copyMigrations();
    const db = await createDatabase();
    await db.migrate(copy.dir);
    rmSync(join(copy.dir, migrationFiles.at(-1)!));
    copy.rehash();
    await expect(db.migrate(copy.dir)).rejects.toThrow('appliquée mais absente du dossier');
  });
});
