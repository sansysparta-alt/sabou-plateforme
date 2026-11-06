// US-030 : journal de toutes les décisions et connexions, non modifiable (R-DON-02, R-ACC-05).
// Exécuté sous le rôle de l'API (sabou_app), sauf la contre-épreuve du propriétaire.
// Jeu d'exemple : dossier n° 1 en cours, soumis par son praticien (utilisateur n° 6).
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, openContext, runSql, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
let client: pg.Client;

beforeAll(async () => {
  db = await createSeededDatabase();
  client = new pg.Client({ connectionString: db.url.app, options: '-c search_path=sabou,public' });
  await client.connect();
});

afterEach(async () => {
  await client.query('ROLLBACK').catch(() => undefined);
});

afterAll(async () => {
  await client?.end();
});

const lastLines = async (n = 1) =>
  (await client.query(`SELECT * FROM journal_audit ORDER BY id DESC LIMIT ${n}`)).rows;

describe('Décision de workflow (critère 1)', () => {
  it('écrit qui, quoi, quand et IP dans la même transaction que la décision', async () => {
    await client.query('BEGIN');
    await client.query(`SELECT audit_contexte('197.149.10.24')`);
    await client.query(openContext('s.kourouma@exemple.gn'));
    await client.query(`SELECT dossier_transition(1, 'soumis', 6)`);
    const { rows } = await client.query(`
      SELECT utilisateur_id, action, objet_type, objet_id, host(ip) AS ip, source,
             created_at = now() AS heure_de_la_transaction,
             xmin::text = pg_current_xact_id()::xid::text AS meme_transaction
        FROM journal_audit ORDER BY id DESC LIMIT 1`);
    expect(rows[0]).toEqual({
      utilisateur_id: '6',
      action: 'dossier.soumis',
      objet_type: 'dossier',
      objet_id: expect.any(String),
      ip: '197.149.10.24',
      source: 'application',
      heure_de_la_transaction: true,
      meme_transaction: true,
    });
  });

  it('disparaît avec la décision quand la transaction est annulée', async () => {
    const before = (await lastLines())[0].id;
    await client.query('BEGIN');
    await client.query(`SELECT audit_contexte('197.149.10.24')`);
    await client.query(openContext('s.kourouma@exemple.gn'));
    await client.query(`SELECT dossier_transition(1, 'soumis', 6)`);
    await client.query('ROLLBACK');
    expect((await lastLines())[0].id).toBe(before);
    await client.query('BEGIN');
    await client.query(openContext('s.kourouma@exemple.gn'));
    const { rows } = await client.query(
      'SELECT etape_courante FROM dossier_certification WHERE id = 1',
    );
    await client.query('ROLLBACK');
    expect(rows[0].etape_courante).toBe(1);
  });

  it('n’écrit rien quand la décision est refusée', async () => {
    const before = (await lastLines())[0].id;
    await client.query('BEGIN');
    // Un agent préfectoral ne valide pas un dossier qui n'a pas été soumis
    await client.query(openContext('prefectoral.labe@sabou-sante.gn'));
    await expect(client.query(`SELECT dossier_transition(1, 'valide', 3)`)).rejects.toThrow();
    await client.query('ROLLBACK');
    expect((await lastLines())[0].id).toBe(before);
  });

  it('ne garde pas l’IP d’une transaction pour la suivante (pool de connexions)', async () => {
    await client.query('BEGIN');
    await client.query(`SELECT audit_contexte('197.149.10.24')`);
    await client.query('COMMIT');
    await client.query(`INSERT INTO journal_audit (action, objet_type) VALUES ('test', 'test')`);
    expect((await lastLines())[0].ip).toBeNull();
  });

  it('impose l’heure de la base : l’application ne choisit pas le « quand »', async () => {
    await client.query(
      `INSERT INTO journal_audit (action, objet_type, created_at) VALUES ('test', 'test', '2000-01-01')`,
    );
    const { rows } = await client.query(
      `SELECT created_at > now() - interval '1 minute' AS recent FROM journal_audit ORDER BY id DESC LIMIT 1`,
    );
    expect(rows[0].recent).toBe(true);
  });
});

describe('Modification ou suppression du journal (critère 2)', () => {
  for (const statement of [
    `UPDATE sabou.journal_audit SET action = 'x'`,
    'DELETE FROM sabou.journal_audit',
    'TRUNCATE sabou.journal_audit',
  ]) {
    it(`refusée à l’application : ${statement.split(' ')[0]}`, async () => {
      await expect(client.query(statement)).rejects.toThrow(
        'permission denied for table journal_audit',
      );
    });

    // Contre-épreuve : même le propriétaire de la table, qui a tous les droits, est arrêté
    it(`refusée au propriétaire de la table : ${statement.split(' ')[0]}`, async () => {
      await expect(runSql(db.url.migrator, statement)).rejects.toThrow(
        "Le journal d'audit est en ajout seul",
      );
    });
  }
});

describe('Événements de connexion relevés dans Keycloak', () => {
  const insert = `
    INSERT INTO journal_audit (source, ref_externe, survenu_le, action, objet_type, compte, ip)
    VALUES ('keycloak', 'evt-1', '2026-11-06T08:00:00Z', 'connexion.login_error', 'compte',
            'kc-sub-1', '197.149.10.24')
    ON CONFLICT (source, ref_externe) WHERE ref_externe IS NOT NULL DO NOTHING`;

  it('ne sont versés qu’une fois, même relevés deux fois', async () => {
    await client.query(insert);
    await client.query(insert);
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM journal_audit WHERE ref_externe = 'evt-1'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('ont une source par domaine : un même identifiant peut venir des deux domaines', async () => {
    await client.query(insert);
    await client.query(insert.replace("VALUES ('keycloak'", "VALUES ('keycloak-public'"));
    const { rows } = await client.query(
      `SELECT array_agg(source ORDER BY source) AS s FROM journal_audit WHERE ref_externe = 'evt-1'`,
    );
    expect(rows[0].s).toEqual(['keycloak', 'keycloak-public']);
  });

  it('portent toujours leur identifiant et leur heure dans Keycloak', async () => {
    await expect(
      client.query(
        `INSERT INTO journal_audit (source, action, objet_type) VALUES ('keycloak', 'x', 'compte')`,
      ),
    ).rejects.toThrow('ck_audit_keycloak');
    await expect(
      client.query(
        `INSERT INTO journal_audit (source, action, objet_type) VALUES ('keycloak-public', 'x', 'compte')`,
      ),
    ).rejects.toThrow('ck_audit_keycloak');
  });
});
