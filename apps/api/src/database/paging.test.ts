// Pagination des listes cloisonnées (US-011, US-019b) contre un vrai PostgreSQL : la requête
// unique (total, page, jointure externe) ne se simule pas fidèlement.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zoneListQuerySchema, type ZoneListQuery } from '@sabou/types';
import { createDatabase, type Database } from './database';
import { zonePage } from './paging';
import type { ZoneTrx } from './zone';

// Même image que l'environnement local (empreinte lue dans infra/local/compose.yaml)
function composeImage(name: string): string {
  const compose = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'infra', 'local', 'compose.yaml'),
    'utf8',
  );
  const match = new RegExp(`image: (${name}@sha256:[0-9a-f]{64})`).exec(compose);
  if (!match) throw new Error(`Image ${name} introuvable dans infra/local/compose.yaml`);
  return match[1]!;
}

let container: StartedTestContainer;
let db: Database;

// 23 dossiers, dont 3 clos : la liste n'en garde que 20, de DS-1001 à DS-1020
beforeAll(async () => {
  container = await new GenericContainer(composeImage('postgis/postgis'))
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'sabou' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  db = createDatabase(
    `postgres://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/sabou`,
  );
  await sql`CREATE SCHEMA sabou`.execute(db);
  // Même normalisation que la base (schéma initial)
  await sql`CREATE EXTENSION unaccent`.execute(db);
  await sql`CREATE FUNCTION sabou.f_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE AS
            $$ SELECT lower(public.unaccent('public.unaccent', t)) $$`.execute(db);
  await sql`CREATE TABLE sabou.dossier (code text PRIMARY KEY, ouvert boolean NOT NULL,
                                        "praticienNom" text NOT NULL)`.execute(db);
  await sql`INSERT INTO sabou.dossier
            SELECT 'DS-' || (1000 + n), n <= 20,
                   CASE WHEN n IN (3, 14) THEN 'Mariama Soumah' WHEN n = 7 THEN '100% Kéïta'
                        ELSE 'Sékou Kourouma' END
              FROM generate_series(23, 1, -1) n`.execute(db);
}, 180_000);

afterAll(async () => {
  await db?.destroy();
  await container?.stop();
});

const OPEN = sql`SELECT code, ouvert, "praticienNom" FROM sabou.dossier WHERE ouvert`;

function read(query: Partial<Record<keyof ZoneListQuery, string>>) {
  const parsed = zoneListQuerySchema.parse(query);
  return db
    .transaction()
    .execute((trx) =>
      zonePage<{ code: string }>(trx as unknown as ZoneTrx, OPEN, parsed, ['praticienNom']),
    );
}

const codes = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `DS-${from + i}`);

describe('Page par numéro (decalage)', () => {
  it('renvoie la page demandée, triée par code, avec le total de la liste entière', async () => {
    const page = await read({ limite: '10', decalage: '10' });
    expect(page.elements.map((e) => e.code)).toEqual(codes(1011, 1020));
    expect(page.total).toBe(20);
    expect(page.suivant).toBeNull();
  });

  it('signale la page suivante quand il en reste', async () => {
    const page = await read({ limite: '10', decalage: '0' });
    expect(page.elements.map((e) => e.code)).toEqual(codes(1001, 1010));
    expect(page.suivant).toBe('DS-1010');
    expect(page.total).toBe(20);
  });

  it('au-delà de la fin : page vide, total conservé', async () => {
    const page = await read({ limite: '10', decalage: '40' });
    expect(page).toEqual({ elements: [], suivant: null, total: 20 });
  });

  it('garde toutes les colonnes de la liste, avec leur type', async () => {
    const page = await read({ limite: '1' });
    expect(page.elements).toEqual([
      { code: 'DS-1001', ouvert: true, praticienNom: 'Sékou Kourouma' },
    ]);
  });
});

describe('Page par curseur (apres)', () => {
  it('reprend après le code donné ; le total reste celui de la liste entière', async () => {
    const page = await read({ limite: '5', apres: 'DS-1017' });
    expect(page.elements.map((e) => e.code)).toEqual(codes(1018, 1020));
    expect(page).toMatchObject({ suivant: null, total: 20 });
  });
});

describe('Recherche (q)', () => {
  it('dans le nom, sans accents ni majuscules ; le total compte les lignes trouvées', async () => {
    const page = await read({ q: 'MARIAMA soumah' });
    expect(page.elements.map((e) => e.code)).toEqual(['DS-1003', 'DS-1014']);
    expect(page.total).toBe(2);
    expect((await read({ q: 'kourouma', limite: '10' })).total).toBe(17);
  });

  it('dans le code', async () => {
    const page = await read({ q: 'ds-1017' });
    expect(page).toMatchObject({ elements: [{ code: 'DS-1017' }], total: 1 });
  });

  it('les caractères spéciaux de LIKE sont cherchés tels quels', async () => {
    expect((await read({ q: '100%' })).elements.map((e) => e.code)).toEqual(['DS-1007']);
    expect((await read({ q: '%' })).total).toBe(1);
    expect((await read({ q: '_' })).total).toBe(0);
  });

  it('une tentative d’injection reste un simple texte cherché', async () => {
    expect((await read({ q: "' OR 1=1 --" })).total).toBe(0);
  });
});

describe('Liste vide', () => {
  it('aucun élément, total nul', async () => {
    const parsed = zoneListQuerySchema.parse({});
    const page = await db
      .transaction()
      .execute((trx) =>
        zonePage(
          trx as unknown as ZoneTrx,
          sql`SELECT code FROM sabou.dossier WHERE false`,
          parsed,
        ),
      );
    expect(page).toEqual({ elements: [], suivant: null, total: 0 });
  });
});

describe('Paramètres', () => {
  it.each([
    [{ apres: 'DS-1001', decalage: '10' }],
    [{ decalage: '-1' }],
    [{ decalage: '1.5' }],
    [{ decalage: '100001' }],
    [{ decalage: '0 OR 1=1' }],
    [{ q: '' }],
    [{ q: '   ' }],
    [{ q: 'x'.repeat(101) }],
  ])('refuse %j', (query) => {
    expect(zoneListQuerySchema.safeParse(query).success).toBe(false);
  });
});
