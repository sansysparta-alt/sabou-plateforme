// Lot D (US-014) : comptes citoyens, identifiés par leur numéro de mobile guinéen.
// Exécuté sous le rôle de l'API (sabou_app), sur le jeu d'exemple.
import { randomInt, randomUUID } from 'node:crypto';
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

const newPhone = () => `+2246${String(randomInt(0, 1e8)).padStart(8, '0')}`;

// Compte citoyen tel que l'inscription le crée : prénom et numéro, ni nom ni e-mail
function citizen(fields: {
  phone?: string | null;
  email?: string | null;
  role?: string;
  region?: number | null;
}): Promise<unknown> {
  return client.query(
    `INSERT INTO utilisateur (telephone, email, prenom, nom, role_code, region_admin_id, statut, keycloak_id)
     VALUES ($1, $2, 'Aïssatou', NULL, $3, $4, 'actif', $5)`,
    [
      fields.phone === undefined ? newPhone() : fields.phone,
      fields.email ?? null,
      fields.role ?? 'citoyen',
      fields.region ?? null,
      randomUUID(),
    ],
  );
}

const constraintOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'accepté',
    (error: { constraint?: string }) => error.constraint ?? String(error),
  );

describe('Compte citoyen (US-014)', () => {
  it('accepte un citoyen avec un numéro et un prénom, sans nom ni e-mail', async () => {
    expect(await constraintOf(citizen({}))).toBe('accepté');
  });

  it('refuse un citoyen sans numéro, ou avec un numéro non guinéen ou non mobile', async () => {
    for (const phone of [null, '621234567', '+33612345678', '+224301234567', '+2246212345']) {
      expect(await constraintOf(citizen({ phone }))).toBe('ck_citoyen');
    }
  });

  it('refuse une zone pour un citoyen', async () => {
    expect(await constraintOf(citizen({ region: 3 }))).toBe('ck_citoyen');
  });

  it('refuse un second compte citoyen sur le même numéro', async () => {
    const phone = newPhone();
    await client.query('BEGIN');
    expect(await constraintOf(citizen({ phone }))).toBe('accepté');
    expect(await constraintOf(citizen({ phone }))).toBe('ux_utilisateur_telephone_public');
  });

  it('exige toujours e-mail et nom pour les autres rôles', async () => {
    expect(await constraintOf(citizen({ role: 'dg' }))).toBe('ck_identite_role');
  });

  it('a donné un numéro valide à chaque citoyen existant', async () => {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM utilisateur
        WHERE role_code = 'citoyen' AND telephone !~ '^\\+2246[0-9]{8}$'`,
    );
    expect(rows[0]!.n).toBe('0');
  });
});
