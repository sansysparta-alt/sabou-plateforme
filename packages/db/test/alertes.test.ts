// US-102 : alertes territoriales (UC-44, R-MOD-04 ; décisions du maître d'œuvre du
// 19 novembre 2026, 05 §2.89). Exécuté sous le rôle de l'API (sabou_app) ; chaque cas part
// du même état (transaction annulée).
// Critère 1 : alertes « hausse de pathologie », « désert thérapeutique », « dossier bloqué ».
// Critère 2 : accusé de réception et relance.
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const DG = 'dg@sabou-sante.gn';
const REGIONAL = 'regional.labe@sabou-sante.gn';
const PREFECTORAL = 'prefectoral.labe@sabou-sante.gn';
const KANKAN = 'prefectoral.kankan@sabou-sante.gn';
const run = (sql: string) => lastRows(db.url.app, sql);

// DS-1041 (Labé) soumis : étape 2 ; vu 20 jours plus tard, il est bloqué
const submitted = `${openContext('s.kourouma@exemple.gn')}
  SELECT dossier_transition(1, 'soumis', contexte_utilisateur());`;
const detect = (days = 20) =>
  `SELECT alertes_detecter(now() + interval '${days} days') AS nouvelles;`;
const blocked = `${submitted} ${detect()}`;
const ALERT = `(SELECT a.id FROM alerte_territoriale a JOIN dossier_certification d
                 ON d.id = a.dossier_id WHERE d.code = 'DS-1041' AND a.statut <> 'close')`;
const as = (email: string, sql: string) => `${openContext(email)} ${sql}`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 1 : alertes automatiques et déclarées', () => {
  it('dossier bloqué plus de 15 jours : une alerte, une seule', async () => {
    const rows = await run(`${blocked} ${detect()} ${openContext(DG)}
      SELECT a.type, a.statut, a.description LIKE 'DS-1041 : étape 2 depuis le %' AS texte,
             (SELECT count(*)::int FROM alerte_territoriale x WHERE x.dossier_id = a.dossier_id) AS n
        FROM alerte_territoriale a WHERE a.id = ${ALERT};`);
    expect(rows).toEqual([{ type: 'dossier_bloque', statut: 'nouvelle', texte: true, n: 1 }]);
  });

  it('le dossier a avancé : l’alerte se close d’elle-même', async () => {
    const rows = await run(`${blocked} ${detect(0)} ${openContext(DG)}
      SELECT a.statut, a.close_motif FROM alerte_territoriale a JOIN dossier_certification d
          ON d.id = a.dossier_id WHERE d.code = 'DS-1041';`);
    expect(rows).toEqual([{ statut: 'close', close_motif: 'Résolue : le dossier a avancé.' }]);
  });

  it('désert thérapeutique : préfectures actives sans praticien certifié, jamais Labé', async () => {
    const rows = await run(`${detect(0)} ${detect(0)} ${openContext(DG)}
      SELECT count(*) FILTER (WHERE prefecture_id = 4)::int AS labe,
             count(*)::int > 0 AS deserts,
             count(*) = count(DISTINCT prefecture_id) AS une_par_prefecture
        FROM alerte_territoriale WHERE type = 'desert_therapeutique' AND statut <> 'close';`);
    expect(rows).toEqual([{ labe: 0, deserts: true, une_par_prefecture: true }]);
  });

  it('hausse de pathologie : déclarée par le préfectoral pour sa préfecture, ou par la DG', async () => {
    const declare = (email: string, prefecture: number) =>
      as(
        email,
        `SELECT alerte_declarer(${prefecture}::smallint, 'MA-001', 'Cas de paludisme en hausse.') AS id;`,
      );
    const rows = await run(`${declare(PREFECTORAL, 4)}
      SELECT type, region_admin_id, maladie_id IS NOT NULL AS maladie FROM alerte_territoriale
       WHERE description = 'Cas de paludisme en hausse.';`);
    expect(rows).toEqual([{ type: 'hausse_pathologie', region_admin_id: 4, maladie: true }]);
    expect(await run(`${declare(DG, 7)} SELECT 1 AS ok;`)).toEqual([{ ok: 1 }]);
    await expect(run(declare(PREFECTORAL, 7))).rejects.toThrow(/réservée au préfectoral/);
    await expect(run(declare(REGIONAL, 4))).rejects.toThrow(/réservée au préfectoral/);
  });
});

describe('Cloisonnement', () => {
  it('DG : tout ; régional : sa région ; préfectoral : sa préfecture ; Comité : rien', async () => {
    const regions = (email: string) =>
      as(
        email,
        `
      SELECT count(*)::int AS n, count(*) FILTER (WHERE region_admin_id <> 4)::int AS ailleurs,
             count(*) FILTER (WHERE prefecture_id IS DISTINCT FROM 4)::int AS autre_prefecture
        FROM alerte_territoriale;`,
      );
    const [dg] = await run(`${detect(0)} ${regions(DG)}`);
    const [regional] = await run(`${detect(0)} ${regions(REGIONAL)}`);
    const [prefectoral] = await run(`${detect(0)} ${regions(PREFECTORAL)}`);
    expect(dg!.ailleurs).toBeGreaterThan(0);
    expect(regional!.ailleurs).toBe(0);
    expect(regional!.n).toBeGreaterThan(0);
    expect(prefectoral!.autre_prefecture).toBe(0);
    expect(await run(`${detect(0)} ${regions('comite@sabou-sante.gn')}`)).toEqual([
      { n: 0, ailleurs: 0, autre_prefecture: 0 },
    ]);
    expect(
      await run(
        `${blocked} ${as(KANKAN, `SELECT count(*)::int AS n FROM alerte_territoriale WHERE id = ${ALERT};`)}`,
      ),
    ).toEqual([{ n: 0 }]);
  });
});

describe('Critère 2 : accusé de réception et relance', () => {
  it('accusé de réception par le responsable ; une seule fois', async () => {
    const accuse = as(PREFECTORAL, `SELECT alerte_accuser(${ALERT});`);
    const rows = await run(`${blocked} ${accuse}
      SELECT statut, accusee_le IS NOT NULL AS le, accusee_par IS NOT NULL AS par
        FROM alerte_territoriale WHERE id = ${ALERT};`);
    expect(rows).toEqual([{ statut: 'accusee', le: true, par: true }]);
    await expect(run(`${blocked} ${accuse} ${accuse}`)).rejects.toThrow(/déjà donné/);
  });

  it('relance du régional : alerte relancée, responsables prévenus dans l’application et par e-mail', async () => {
    const rows =
      await run(`${blocked} ${as(REGIONAL, `SELECT alerte_relancer(${ALERT}) AS prevenus;`)}
      SELECT a.statut, a.relances,
             (SELECT array_agg(n.canal ORDER BY n.canal) FROM notification n
               JOIN utilisateur u ON u.id = n.destinataire_id
              WHERE n.modele = 'alerte.relance' AND n.objet_id = a.id::text
                AND u.email = '${PREFECTORAL}') AS canaux
        FROM alerte_territoriale a WHERE a.id = ${ALERT};`);
    expect(rows).toEqual([{ statut: 'relancee', relances: 1, canaux: ['application', 'email'] }]);
  });

  it('une relance par jour au plus ; le préfectoral ne relance pas', async () => {
    const relance = as(REGIONAL, `SELECT alerte_relancer(${ALERT});`);
    await expect(run(`${blocked} ${relance} ${relance}`)).rejects.toThrow(/moins d'un jour/);
    await expect(
      run(`${blocked} ${as(PREFECTORAL, `SELECT alerte_relancer(${ALERT});`)}`),
    ).rejects.toThrow(/réservée au régional/);
  });

  it('les e-mails de relance restent en file : la relève des SMS ne les prend pas', async () => {
    const rows = await run(`${blocked} ${as(REGIONAL, `SELECT alerte_relancer(${ALERT});`)}
      SELECT count(*)::int AS pris FROM notification_sms_prendre(100, interval '2 minutes')
       WHERE modele = 'alerte.relance';`);
    expect(rows).toEqual([{ pris: 0 }]);
  });

  it('clôture motivée ; ensuite, plus aucune action', async () => {
    const close = as(REGIONAL, `SELECT alerte_clore(${ALERT}, 'Dossier repris par l''agent.');`);
    const id = `(SELECT a.id FROM alerte_territoriale a JOIN dossier_certification d
                  ON d.id = a.dossier_id WHERE d.code = 'DS-1041')`;
    const rows = await run(`${blocked} ${close}
      SELECT statut, close_motif FROM alerte_territoriale WHERE id = ${id};`);
    expect(rows).toEqual([{ statut: 'close', close_motif: "Dossier repris par l'agent." }]);
    await expect(
      run(`${blocked} ${close} ${as(PREFECTORAL, `SELECT alerte_accuser(${id});`)}`),
    ).rejects.toThrow(/close : aucune action/);
  });
});
