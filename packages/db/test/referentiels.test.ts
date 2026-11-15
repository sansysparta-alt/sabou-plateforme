// Lot C (US-020, US-021) : référentiel initial et règles des langues et spécialités.
// Exécuté sous le rôle de l'API (sabou_app), sur le jeu d'exemple ; chaque cas est annulé.
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, createSeededDatabase, runSql, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
let client: pg.Client;

beforeAll(async () => {
  db = await createSeededDatabase();
  client = new pg.Client({ connectionString: db.url.app, options: '-c search_path=sabou,public' });
  await client.connect();
});

beforeEach(async () => {
  await client.query('BEGIN');
});

afterEach(async () => {
  await client.query('ROLLBACK').catch(() => undefined);
});

afterAll(async () => {
  await client?.end();
});

// Erreur PostgreSQL attendue (code SQLSTATE), sans interrompre la transaction du cas
async function rejects(sql: string, params: unknown[] = []): Promise<string> {
  await client.query('SAVEPOINT essai');
  try {
    await client.query(sql, params);
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT essai');
    return (error as { code: string }).code;
  }
  throw new Error(`Instruction acceptée : ${sql}`);
}

// Transaction du rôle propriétaire, annulée à la fin : depuis US-071, l'application n'écrit
// plus directement dans les tables de voix ; le contrôle de la langue (trigger) s'y vérifie
async function asOwner(run: (owner: pg.Client) => Promise<void>): Promise<void> {
  const owner = new pg.Client({
    connectionString: db.url.migrator,
    options: '-c search_path=sabou,public',
  });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    await run(owner);
  } finally {
    await owner.query('ROLLBACK').catch(() => undefined);
    await owner.end();
  }
}

// Code d'erreur PostgreSQL d'une requête du rôle propriétaire ('' si elle passe)
async function ownerRejects(owner: pg.Client, sql: string): Promise<string> {
  await owner.query('SAVEPOINT essai');
  try {
    await owner.query(sql);
    return '';
  } catch (error) {
    await owner.query('ROLLBACK TO SAVEPOINT essai');
    return (error as { code?: string }).code ?? '?';
  }
}

// Une voix existante du jeu d'exemple, déplacée vers une autre langue
const moveVoice = (code: string) =>
  `UPDATE plante_voix SET langue_code = '${code}'
    WHERE (plante_id, langue_code) = (SELECT plante_id, langue_code FROM plante_voix
                                       ORDER BY 1, 2 LIMIT 1)`;

describe('Référentiel initial (migration, sans jeu d’exemple)', () => {
  it('une base seulement migrée contient rôles, langues, 8 régions, 34 zones préfectorales et 8 spécialités', async () => {
    const empty = await createDatabase();
    await empty.migrate();
    const { rows } = await runSql(
      empty.url.migrator,
      `SELECT (SELECT count(*) FROM sabou.role)::int AS roles,
              (SELECT count(*) FROM sabou.langue)::int AS langues,
              (SELECT count(*) FROM sabou.region_naturelle)::int AS naturelles,
              (SELECT count(*) FROM sabou.region_admin)::int AS regions,
              (SELECT count(*) FROM sabou.prefecture)::int AS prefectures,
              (SELECT count(*) FROM sabou.specialite)::int AS specialites`,
    );
    expect(rows[0]).toEqual({
      roles: 6,
      langues: 6,
      naturelles: 4,
      regions: 8,
      prefectures: 34,
      specialites: 8,
    });
  });
});

describe('US-020 : langues et territoires', () => {
  it('l’anglais n’a pas de voix : une voix en anglais est refusée', async () => {
    await asOwner(async (owner) => {
      expect(await ownerRejects(owner, moveVoice('en'))).toBe('P0001');
    });
  });

  it('Conakry est en Basse Guinée, soussou par défaut', async () => {
    const { rows } = await client.query(
      `SELECT n.nom, n.langue_defaut_code AS langue
         FROM region_admin r JOIN region_naturelle n ON n.id = r.region_naturelle_id
        WHERE r.nom = 'Conakry'`,
    );
    expect(rows).toEqual([{ nom: 'Basse Guinée', langue: 'sou' }]);
  });

  it('une langue nationale ajoutée puis activée sert aux voix, sans modifier le code', async () => {
    await asOwner(async (owner) => {
      await owner.query(
        `INSERT INTO langue (code, iso639_3, nom_fr, type, texte, voix, active, ordre)
         VALUES ('kis', 'kss', 'Kissi', 'nationale', false, true, false, 7)`,
      );
      expect(await ownerRejects(owner, moveVoice('kis'))).toBe('P0001');
      await owner.query(`UPDATE langue SET active = true WHERE code = 'kis'`);
      const { rowCount } = await owner.query(moveVoice('kis'));
      expect(rowCount).toBe(1);
    });
  });

  it('une langue nationale n’a jamais d’usage texte (R-LNG-02)', async () => {
    expect(
      await rejects(
        `INSERT INTO langue (code, nom_fr, type, texte, voix) VALUES ('kis', 'Kissi', 'nationale', true, true)`,
      ),
    ).toBe('23514');
  });

  it('l’usage d’une langue est fixé à sa création', async () => {
    expect(await rejects(`UPDATE langue SET voix = true WHERE code = 'en'`)).toBe('23514');
  });

  it('le français et la langue par défaut d’une région ne peuvent pas être désactivés', async () => {
    expect(await rejects(`UPDATE langue SET active = false WHERE code = 'fr'`)).toBe('23514');
    expect(await rejects(`UPDATE langue SET active = false WHERE code = 'sou'`)).toBe('23514');
  });

  it('une langue désactivée ne peut plus être choisie, les lignes qui la portent restent modifiables', async () => {
    await client.query(
      `UPDATE utilisateur SET langue_ecoute = 'gue' WHERE email = 'aminata@exemple.gn'`,
    );
    await client.query(`UPDATE region_naturelle SET langue_defaut_code = 'sou' WHERE code = 'GF'`);
    await client.query(`UPDATE langue SET active = false WHERE code = 'gue'`);
    expect(
      await rejects(`UPDATE utilisateur SET langue_ecoute = 'gue' WHERE email = 'sory@exemple.gn'`),
    ).toBe('P0001');
    const { rowCount } = await client.query(
      `UPDATE utilisateur SET prenom = 'Aminata' WHERE email = 'aminata@exemple.gn'`,
    );
    expect(rowCount).toBe(1);
  });
});

describe('US-021 : spécialités', () => {
  it('les 8 spécialités du cahier des charges sont présentes, en français et en anglais', async () => {
    const { rows } = await client.query(
      `SELECT libelle_fr, libelle_en FROM specialite WHERE active ORDER BY id`,
    );
    expect(rows.map((r) => r.libelle_fr)).toEqual([
      'Phytothérapie',
      'Pédiatrie',
      'Os et fractures',
      'Nutrition',
      'Gynécologie et santé maternelle',
      'Santé mentale',
      'Maladies de la peau',
      'Morsures et envenimations',
    ]);
    expect(rows.every((r) => r.libelle_en)).toBe(true);
  });

  // La table praticien est cloisonnée (lot B) : ce cas s'exécute sous son propriétaire,
  // le déclencheur étant le même pour tous les rôles.
  it('une spécialité désactivée n’est plus attribuable ; les fiches qui la portent restent modifiables', async () => {
    await client.query('ROLLBACK');
    await client.end();
    client = new pg.Client({
      connectionString: db.url.migrator,
      options: '-c search_path=sabou,public',
    });
    await client.connect();
    await client.query('BEGIN');
    await client.query(`UPDATE specialite SET active = false WHERE code = 'phytotherapie'`);
    expect(
      await rejects(
        `UPDATE praticien SET specialite_id = (SELECT id FROM specialite WHERE code = 'phytotherapie')
          WHERE specialite_id <> (SELECT id FROM specialite WHERE code = 'phytotherapie')`,
      ),
    ).toBe('23514');
    const { rowCount } = await client.query(
      `UPDATE praticien SET annees_experience = annees_experience + 1
        WHERE specialite_id = (SELECT id FROM specialite WHERE code = 'phytotherapie')`,
    );
    expect(rowCount).toBeGreaterThan(0);
  });
});
