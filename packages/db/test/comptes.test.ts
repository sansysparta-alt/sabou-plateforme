// Lot A (US-012, US-013) : comptes liés à Keycloak, zone exigée par le rôle, invitations.
// Exécuté sous le rôle de l'API (sabou_app), sur le jeu d'exemple.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, type TestDatabase } from './helpers.ts';

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

// Compte invité (sans compte Keycloak) ; erreur PostgreSQL renvoyée telle quelle
async function invite(fields: {
  role: string;
  region?: number | null;
  prefecture?: number | null;
  statut?: string;
  keycloakId?: string | null;
}): Promise<string> {
  const email = `essai-${randomBytes(4).toString('hex')}@exemple.invalid`;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO utilisateur (email, prenom, nom, role_code, region_admin_id, prefecture_id, statut, keycloak_id)
     VALUES ($1, 'Essai', 'Compte', $2, $3, $4, $5, $6) RETURNING id`,
    [
      email,
      fields.role,
      fields.region ?? null,
      fields.prefecture ?? null,
      fields.statut ?? 'invite',
      fields.keycloakId ?? null,
    ],
  );
  return rows[0]!.id;
}

const constraintOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'accepté',
    (error: { constraint?: string }) => error.constraint ?? String(error),
  );

describe('Zone exigée par le rôle (US-012, critère 2 ; R-ACC-02)', () => {
  it('refuse un rôle régional sans région', async () => {
    expect(await constraintOf(invite({ role: 'regional' }))).toBe('ck_zone_role');
  });

  it('refuse un rôle préfectoral sans préfecture', async () => {
    expect(await constraintOf(invite({ role: 'prefectoral' }))).toBe('ck_zone_role');
  });

  it('refuse deux zones à la fois et une zone pour un rôle national', async () => {
    expect(await constraintOf(invite({ role: 'prefectoral', prefecture: 4, region: 4 }))).toBe(
      'ck_zone_role',
    );
    expect(await constraintOf(invite({ role: 'dg', region: 3 }))).toBe('ck_zone_role');
    expect(await constraintOf(invite({ role: 'scientifique', prefecture: 4 }))).toBe(
      'ck_zone_role',
    );
  });

  it('accepte chaque rôle d’administration avec sa zone', async () => {
    await client.query('BEGIN');
    for (const fields of [
      { role: 'dg' },
      { role: 'scientifique' },
      { role: 'regional', region: 3 },
      { role: 'prefectoral', prefecture: 4 },
    ]) {
      expect(await constraintOf(invite(fields))).toBe('accepté');
    }
  });
});

describe('Lien avec Keycloak', () => {
  it('n’a plus aucune colonne de mot de passe ni de double facteur', async () => {
    const { rows } = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'sabou' AND table_name = 'utilisateur'
          AND (column_name LIKE '%mot_de_passe%' OR column_name LIKE 'mfa%')`,
    );
    expect(rows).toEqual([]);
  });

  it('exige un compte Keycloak hors invitation, et aucun pendant l’invitation', async () => {
    expect(await constraintOf(invite({ role: 'dg', statut: 'actif' }))).toBe('ck_compte_keycloak');
    expect(
      await constraintOf(invite({ role: 'dg', statut: 'invite', keycloakId: crypto.randomUUID() })),
    ).toBe('ck_compte_keycloak');
  });

  it('refuse deux utilisateurs pour un même compte Keycloak', async () => {
    const { rows } = await client.query<{ keycloak_id: string }>(
      'SELECT keycloak_id FROM utilisateur WHERE id = 1',
    );
    expect(
      await constraintOf(invite({ role: 'dg', statut: 'actif', keycloakId: rows[0]!.keycloak_id })),
    ).toBe('utilisateur_keycloak_id_key');
  });
});

describe('Invitation', () => {
  it('ne garde qu’une empreinte de 32 octets, unique', async () => {
    await client.query('BEGIN');
    const id = await invite({ role: 'dg' });
    const add = (digest: Buffer) =>
      client.query(
        `INSERT INTO invitation (utilisateur_id, jeton_empreinte, expire_le, cree_par)
         VALUES ($1, $2, now() + interval '72 hours', 1)`,
        [id, digest],
      );
    const digest = randomBytes(32);
    await add(digest);
    await client.query('SAVEPOINT s');
    expect(await constraintOf(add(digest))).toBe('invitation_jeton_empreinte_key');
    await client.query('ROLLBACK TO SAVEPOINT s');
    expect(await constraintOf(add(randomBytes(16)))).toBe('invitation_jeton_empreinte_check');
  });
});
