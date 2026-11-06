// US-004, critères 2 et 3 : réception d'un dossier saisi hors réseau et règle de conflit
// R-DON-04 (validée le 3 novembre 2026), exécutées sous le rôle de l'API (sabou_app).
// Agents du jeu d'exemple : n° 3 et n° 5 préfectoraux (Labé, Kankan), n° 6 praticien.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
let client: pg.Client;

beforeAll(async () => {
  db = await createSeededDatabase();
  // Comme l'API : schéma sabou en tête du search_path (les déclencheurs en dépendent)
  client = new pg.Client({ connectionString: db.url.app, options: '-c search_path=sabou,public' });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
});

async function receive(
  id: string,
  agent: number,
  contenu: object,
  versionBase: number | null = null,
) {
  const { rows } = await client.query<{ result: string }>(
    'SELECT sabou.saisie_terrain_recevoir($1, $2, $3, $4, $5) AS result',
    [id, 'dossier', agent, JSON.stringify(contenu), versionBase],
  );
  return rows[0]!.result;
}

async function row(id: string) {
  const { rows } = await client.query('SELECT * FROM sabou.saisie_terrain WHERE id = $1', [id]);
  return rows[0];
}

async function notices(id: string) {
  const { rows } = await client.query(
    'SELECT destinataire_id::int, motif, copie_id FROM sabou.saisie_terrain_avis WHERE saisie_id = $1',
    [id],
  );
  return rows;
}

describe('Réception d’un dossier saisi hors réseau (US-004, critère 2)', () => {
  it('crée le dossier dans la zone de l’agent, lue en base et non chez le téléphone', async () => {
    const id = randomUUID();
    expect(await receive(id, 3, { praticien: 'Sékou Kourouma' })).toBe('creee');
    expect(await row(id)).toMatchObject({
      prefecture_id: 4,
      auteur_id: '3',
      version: 1,
      statut: 'brouillon',
    });
  });

  it('un envoi répété après une coupure ne crée ni doublon ni nouvelle version', async () => {
    const id = randomUUID();
    await receive(id, 3, { praticien: 'A' });
    expect(await receive(id, 3, { praticien: 'A' }, 1)).toBe('identique');
    expect(await row(id)).toMatchObject({ version: 1 });
    const { rows } = await client.query(
      'SELECT count(*)::int AS n FROM sabou.saisie_terrain WHERE id = $1',
      [id],
    );
    expect(rows[0].n).toBe(1);
  });

  it('une modification sans conflit remplace le contenu et augmente la version', async () => {
    const id = randomUUID();
    await receive(id, 3, { praticien: 'A' });
    expect(await receive(id, 3, { praticien: 'A', notes: 'visite faite' }, 1)).toBe('modifiee');
    expect(await row(id)).toMatchObject({
      version: 2,
      contenu: { praticien: 'A', notes: 'visite faite' },
    });
    expect(await notices(id)).toEqual([]);
  });

  it('refuse un agent qui n’est pas préfectoral', async () => {
    await expect(receive(randomUUID(), 6, { praticien: 'A' })).rejects.toThrow(
      'saisie de terrain réservée aux agents préfectoraux actifs',
    );
  });

  it('refuse de modifier un dossier d’une autre zone, même avec son identifiant', async () => {
    const id = randomUUID();
    await receive(id, 5, { praticien: 'Kankan' });
    await expect(receive(id, 3, { praticien: 'pris par Labé' }, 1)).rejects.toThrow(
      'hors de la zone',
    );
    expect(await row(id)).toMatchObject({ contenu: { praticien: 'Kankan' }, version: 1 });
  });
});

describe('Conflit au niveau du dossier entier (R-DON-04)', () => {
  it('2) version du serveur validée : elle prime, la saisie devient une copie en brouillon visible de l’agent', async () => {
    const id = randomUUID();
    await receive(id, 3, { praticien: 'A' });
    await client.query(`UPDATE sabou.saisie_terrain SET statut = 'valide' WHERE id = $1`, [id]);

    expect(await receive(id, 3, { praticien: 'A modifié hors réseau' }, 1)).toBe('copie_brouillon');
    expect(await row(id)).toMatchObject({
      statut: 'valide',
      contenu: { praticien: 'A' },
      version: 1,
    });
    const { rows: copies } = await client.query(
      'SELECT * FROM sabou.saisie_terrain WHERE origine_id = $1',
      [id],
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({
      statut: 'brouillon',
      prefecture_id: 4,
      auteur_id: '3',
      contenu: { praticien: 'A modifié hors réseau' },
    });
    // 4) l'agent est informé, avec un lien vers sa copie
    expect(await notices(id)).toEqual([
      { destinataire_id: 3, motif: 'version_validee', copie_id: copies[0].id },
    ]);

    // Renvoi de la même saisie (coupure) : pas de seconde copie
    expect(await receive(id, 3, { praticien: 'A modifié hors réseau' }, 1)).toBe('identique');
    expect(await notices(id)).toHaveLength(1);
  });

  it('3) deux brouillons : la dernière arrivée sur le serveur l’emporte, l’autre est gardée dans l’historique', async () => {
    const id = randomUUID();
    await receive(id, 3, { praticien: 'A' });
    const otherAgent = await secondLabeAgent();

    // Les deux agents partent de la version 1 ; l'un arrive, puis l'autre
    expect(await receive(id, 3, { praticien: 'version de l’agent 3' }, 1)).toBe('modifiee');
    expect(await receive(id, otherAgent, { praticien: 'version de l’autre agent' }, 1)).toBe(
      'remplacee',
    );

    expect(await row(id)).toMatchObject({
      version: 3,
      contenu: { praticien: 'version de l’autre agent' },
    });
    const { rows: history } = await client.query(
      'SELECT version, contenu, auteur_id::int FROM sabou.saisie_terrain_version WHERE saisie_id = $1 ORDER BY version',
      [id],
    );
    expect(history).toEqual([
      { version: 1, contenu: { praticien: 'A' }, auteur_id: 3 },
      { version: 2, contenu: { praticien: 'version de l’agent 3' }, auteur_id: 3 },
    ]);
    // 4) l'agent dont la version n'a pas été retenue est informé
    expect(await notices(id)).toEqual([
      { destinataire_id: 3, motif: 'version_plus_recente', copie_id: null },
    ]);
  });

  it('3) l’heure du téléphone n’entre pas en compte : seul l’ordre d’arrivée décide', async () => {
    const id = randomUUID();
    await receive(id, 3, { praticien: 'A', saisi_le: '2030-01-01T00:00:00Z' });
    const otherAgent = await secondLabeAgent();
    // Saisie annoncée comme plus ancienne, mais arrivée en dernier : elle l'emporte
    expect(
      await receive(id, otherAgent, { praticien: 'B', saisi_le: '2020-01-01T00:00:00Z' }, null),
    ).toBe('remplacee');
    expect(await row(id)).toMatchObject({ contenu: { praticien: 'B' } });
  });
});

let labeAgent: number | undefined;
// Second agent préfectoral de Labé, créé une fois (le jeu d'exemple n'en a qu'un par zone)
async function secondLabeAgent(): Promise<number> {
  if (labeAgent) return labeAgent;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO sabou.utilisateur (email, prenom, nom, role_code, prefecture_id, keycloak_id)
     VALUES ('prefectoral2.labe@sabou-sante.gn', 'Mariama', 'Diallo', 'prefectoral', 4, gen_random_uuid())
     RETURNING id`,
  );
  labeAgent = Number(rows[0]!.id);
  return labeAgent;
}
