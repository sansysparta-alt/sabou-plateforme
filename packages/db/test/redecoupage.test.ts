// US-022 : redécoupage administratif depuis l'écran Référentiels (migration
// 20261117130000_redecoupage). Chaque cas s'exécute sous le rôle de l'API, dans une
// transaction annulée. Jeu d'exemple : Labé (4) porte PR-1041 (sous-préfecture Popodara)
// et PR-1042 (Hafia, certificat actif) ; Kindia (3) a un admin régional, Labé aussi.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
let app: pg.Client;

beforeAll(async () => {
  db = await createSeededDatabase();
  app = new pg.Client({ connectionString: db.url.app, options: '-c search_path=sabou,public' });
  await app.connect();
});

afterAll(async () => {
  await app?.end();
});

const DG = 1;
const LABE = 4;
const KINDIA_REGION = 3;
const KANKAN = 7;
const MAMOU = 5;
const HAFIA = 2;

type Query = <T extends pg.QueryResultRow>(sql: string, params?: unknown[]) => Promise<T[]>;

// Transaction annulée ; as(email) ouvre le contexte d'un compte du jeu d'exemple
async function rolledBack(
  work: (q: Query, as: (email: string) => Promise<void>) => Promise<void>,
): Promise<void> {
  await app.query('BEGIN');
  try {
    const q: Query = async (sql, params = []) => (await app.query(sql, params)).rows;
    await work(q, async (email) => {
      await app.query(`SELECT contexte_ouvrir(md5('sabou:' || $1)::uuid)`, [email]);
    });
  } finally {
    await app.query('ROLLBACK');
  }
}

const apply = (q: Query, operation: string, object: number, target: number, actor = DG) =>
  q<{ r: Preview }>('SELECT redecoupage_appliquer($1, $2, $3, $4) AS r', [
    operation,
    object,
    target,
    actor,
  ]).then((rows) => rows[0]!.r);

const preview = (q: Query, operation: string, object: number, target: number) =>
  q<{ r: Preview }>('SELECT redecoupage_apercu($1, $2, $3, $4) AS r', [
    operation,
    object,
    target,
    DG,
  ]).then((rows) => rows[0]!.r);

interface Preview {
  praticiens: number;
  dossiers: number;
  sousPrefectures: number;
  administrateurs: { email: string; effet: string }[];
}

const practitioners = async (q: Query) =>
  (await q<{ code: string }>('SELECT code FROM praticien ORDER BY code')).map((r) => r.code);

// Code SQLSTATE et contrainte d'une instruction refusée (point de sauvegarde)
async function refusal(q: Query, sql: string, params: unknown[] = []) {
  await q('SAVEPOINT s');
  try {
    await q(sql, params);
    return null;
  } catch (error) {
    const { code, constraint } = error as { code: string; constraint?: string };
    return { code, constraint };
  } finally {
    await q('ROLLBACK TO SAVEPOINT s');
  }
}

describe('US-022 : rattacher une préfecture à une autre région', () => {
  it('l’ancien admin régional ne voit plus ses praticiens, le nouveau les voit', async () => {
    await rolledBack(async (q, as) => {
      await apply(q, 'rattacher_prefecture', LABE, KINDIA_REGION);
      await as('regional.labe@sabou-sante.gn');
      expect(await practitioners(q)).toEqual([]);
      await as('regional.kindia@sabou-sante.gn');
      expect(await practitioners(q)).toEqual(['PR-1041', 'PR-1042', 'PR-1044']);
      // L'admin préfectoral garde sa préfecture
      await as('prefectoral.labe@sabou-sante.gn');
      expect(await practitioners(q)).toEqual(['PR-1041', 'PR-1042']);
    });
  });

  it('l’aperçu annonce ce qui bouge sans rien modifier', async () => {
    await rolledBack(async (q) => {
      const p = await preview(q, 'rattacher_prefecture', LABE, KINDIA_REGION);
      expect(p).toMatchObject({ praticiens: 2, dossiers: 2 });
      expect(p.administrateurs.map((a) => [a.email, a.effet])).toEqual([
        ['regional.kindia@sabou-sante.gn', 'gagne'],
        ['regional.labe@sabou-sante.gn', 'perd'],
      ]);
      const [row] = await q<{ region: number }>(
        'SELECT region_admin_id AS region FROM prefecture WHERE id = $1',
        [LABE],
      );
      expect(row!.region).toBe(4);
    });
  });
});

describe('US-022 : rattacher une sous-préfecture à une autre préfecture (découpage)', () => {
  it('ses praticiens et leurs dossiers suivent', async () => {
    await rolledBack(async (q, as) => {
      const p = await apply(q, 'rattacher_sous_prefecture', HAFIA, KANKAN);
      expect(p).toMatchObject({ praticiens: 1, dossiers: 1 });
      await as('prefectoral.kankan@sabou-sante.gn');
      expect(await practitioners(q)).toEqual(['PR-1042']);
      expect(
        (await q<{ code: string }>('SELECT code FROM dossier_certification')).map((r) => r.code),
      ).toEqual(['DS-1042']);
      await as('prefectoral.labe@sabou-sante.gn');
      expect(await practitioners(q)).toEqual(['PR-1041']);
    });
  });
});

describe('US-022 : fusionner deux préfectures', () => {
  it('les praticiens de l’ancienne figurent dans la conservée, l’ancienne reste en base, inactive', async () => {
    await rolledBack(async (q, as) => {
      const p = await apply(q, 'fusionner_prefectures', LABE, MAMOU);
      expect(p).toMatchObject({ praticiens: 2, sousPrefectures: 2 });
      expect(p.administrateurs.map((a) => [a.email, a.effet])).toEqual([
        ['regional.labe@sabou-sante.gn', 'perd'],
        ['prefectoral.labe@sabou-sante.gn', 'suspendu'],
      ]);
      await as('dg@sabou-sante.gn');
      expect(
        (
          await q<{ code: string }>(
            'SELECT code FROM praticien WHERE prefecture_id = $1 ORDER BY code',
            [MAMOU],
          )
        ).map((r) => r.code),
      ).toEqual(['PR-1041', 'PR-1042', 'PR-1045']);
      const [labe] = await q<{ active: boolean }>('SELECT active FROM prefecture WHERE id = $1', [
        LABE,
      ]);
      expect(labe!.active).toBe(false);
      const subs = await q<{ nom: string }>(
        'SELECT nom FROM sous_prefecture WHERE prefecture_id = $1 ORDER BY nom',
        [MAMOU],
      );
      expect(subs.map((s) => s.nom)).toEqual(['Hafia', 'Popodara']);
    });
  });

  it('les comptes préfectoraux de l’ancienne sont suspendus jusqu’à réaffectation', async () => {
    await rolledBack(async (q) => {
      await apply(q, 'fusionner_prefectures', LABE, MAMOU);
      const [account] = await q<{ statut: string; prefecture_id: number }>(
        `SELECT statut, prefecture_id FROM utilisateur WHERE email = 'prefectoral.labe@sabou-sante.gn'`,
      );
      expect(account).toEqual({ statut: 'suspendu', prefecture_id: LABE });
      // Un compte suspendu n'ouvre plus de contexte
      expect(
        await refusal(
          q,
          `SELECT contexte_ouvrir(md5('sabou:prefectoral.labe@sabou-sante.gn')::uuid)`,
        ),
      ).toMatchObject({ code: '42501' });
      // Réaffectation vers une préfecture active : acceptée
      await q(`UPDATE utilisateur SET prefecture_id = $1 WHERE id = 3`, [MAMOU]);
    });
  });

  it('plus aucun rattachement nouveau vers la préfecture inactive', async () => {
    await rolledBack(async (q, as) => {
      await apply(q, 'fusionner_prefectures', LABE, MAMOU);
      await as('dg@sabou-sante.gn');
      expect(
        await refusal(q, `UPDATE praticien SET prefecture_id = $1 WHERE code = 'PR-1044'`, [LABE]),
      ).toEqual({ code: '23514', constraint: 'ck_territoire_actif' });
      expect(
        await refusal(q, 'SELECT redecoupage_appliquer($1, $2, $3, $4)', [
          'rattacher_sous_prefecture',
          3,
          LABE,
          DG,
        ]),
      ).toEqual({ code: '23514', constraint: 'ck_territoire_actif' });
    });
  });
});

describe('US-022 : les certificats gardent leur territoire d’origine', () => {
  it('reprise : chaque certificat existant porte la préfecture et la région de son praticien', async () => {
    await rolledBack(async (q, as) => {
      await as('dg@sabou-sante.gn');
      const rows = await q<{ ecart: number }>(
        `SELECT count(*)::int AS ecart
           FROM certificat c JOIN praticien p ON p.id = c.praticien_id
           JOIN prefecture pf ON pf.id = p.prefecture_id
          WHERE c.prefecture_origine_id <> p.prefecture_id OR c.region_origine_id <> pf.region_admin_id`,
      );
      expect(rows[0]!.ecart).toBe(0);
    });
  });

  it('après une fusion, le certificat de PR-1042 reste à Labé, et son origine ne se modifie pas', async () => {
    await rolledBack(async (q, as) => {
      await apply(q, 'fusionner_prefectures', LABE, MAMOU);
      await as('dg@sabou-sante.gn');
      const [cert] = await q<{ origine: number }>(
        `SELECT c.prefecture_origine_id AS origine FROM certificat c
           JOIN praticien p ON p.id = c.praticien_id
          WHERE p.code = 'PR-1042' AND c.statut = 'actif'`,
      );
      expect(cert!.origine).toBe(LABE);
      expect(await refusal(q, `UPDATE certificat SET prefecture_origine_id = $1`, [MAMOU])).toEqual(
        { code: '23514', constraint: 'ck_certificat_origine' },
      );
    });
  });
});

describe('US-022 : refus', () => {
  it.each([
    ['un compte autre que la DG', ['rattacher_prefecture', LABE, KINDIA_REGION, 2], '42501'],
    ['un rattachement qui ne change rien', ['rattacher_prefecture', LABE, 4, DG], '23514'],
    ['une préfecture fusionnée avec elle-même', ['fusionner_prefectures', LABE, LABE, DG], '23514'],
    ['un territoire inconnu', ['rattacher_prefecture', 999, KINDIA_REGION, DG], 'P0002'],
    ['une opération inconnue', ['supprimer', LABE, KINDIA_REGION, DG], '22023'],
  ])('%s', async (_label, params, code) => {
    await rolledBack(async (q) => {
      expect(
        await refusal(q, 'SELECT redecoupage_appliquer($1, $2, $3, $4)', params),
      ).toMatchObject({ code });
      expect(await refusal(q, 'SELECT redecoupage_apercu($1, $2, $3, $4)', params)).toMatchObject({
        code,
      });
    });
  });
});
