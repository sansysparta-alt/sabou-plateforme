// US-064 : annoter un traitement ou une plante (UC-51, R-MOD-10). Chaque cas part du même état
// (transaction annulée). Jeu d'exemple : une annotation favorable sur REC-2041, une réserve sur PL-005.
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const COMMITTEE = 'comite@sabou-sante.gn';
const DG = 'dg@sabou-sante.gn';
const as = (email: string, sql: string) => lastRows(db.url.app, `${openContext(email)} ${sql}`);
const annotate = (type: string, code: string, avis: string, contenu = 'Posologie à préciser.') =>
  `SELECT objet_type, avis, contenu, created_at IS NOT NULL AS date
     FROM annotation_ajouter('${type}', '${code}', ${avis === 'NULL' ? 'NULL' : `'${avis}'`}, '${contenu}');`;
const history = (code: string) => `
  SELECT a.avis, a.contenu FROM annotation_comite a
   WHERE a.objet_type = 'recette' AND a.objet_id = (SELECT id FROM recette WHERE code = '${code}')
   ORDER BY a.created_at, a.id;`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : annotation datée avec avis (favorable, réserve, défavorable)', () => {
  it('le Comité annote un traitement et une plante ; date et journal d’audit', async () => {
    expect(await as(COMMITTEE, annotate('recette', 'REC-2043', 'reserve'))).toEqual([
      { objet_type: 'recette', avis: 'reserve', contenu: 'Posologie à préciser.', date: true },
    ]);
    const rows = await as(
      COMMITTEE,
      `${annotate('plante', 'PL-005', 'defavorable', 'Confusion possible avec une espèce toxique.')}
       SELECT action, objet_type, objet_id, details FROM journal_audit
        WHERE action = 'annotation.ajoutee';`,
    );
    expect(rows).toEqual([
      {
        action: 'annotation.ajoutee',
        objet_type: 'plante',
        objet_id: 'PL-005',
        details: { avis: 'defavorable' },
      },
    ]);
  });

  it('sans avis, avis inconnu ou texte vide : refusé', async () => {
    await expect(as(COMMITTEE, annotate('recette', 'REC-2043', 'NULL'))).rejects.toThrow(
      /ck_annotation_avis/,
    );
    await expect(as(COMMITTEE, annotate('recette', 'REC-2043', 'mitige'))).rejects.toThrow();
    await expect(as(COMMITTEE, annotate('recette', 'REC-2043', 'favorable', '  '))).rejects.toThrow(
      /ck_annotation_contenu/,
    );
  });

  it('objet inconnu : refusé', async () => {
    await expect(as(COMMITTEE, annotate('recette', 'REC-9999', 'favorable'))).rejects.toThrow(
      'Objet recette REC-9999 introuvable',
    );
    await expect(as(COMMITTEE, annotate('maladie', 'MA-001', 'favorable'))).rejects.toThrow(
      'introuvable',
    );
  });

  it('seul le Comité annote : DG, régional, praticien refusés', async () => {
    for (const email of [DG, 'regional.labe@sabou-sante.gn', 'm.diallo@exemple.gn']) {
      await expect(as(email, annotate('recette', 'REC-2043', 'favorable'))).rejects.toThrow(
        'Les annotations sont réservées au Comité scientifique',
      );
    }
  });
});

describe('Critère : historique consultable par la DG', () => {
  it('la DG lit l’historique des annotations, dans l’ordre', async () => {
    const rows = await lastRows(
      db.url.app,
      `${openContext(COMMITTEE)} ${annotate('recette', 'REC-2041', 'reserve', 'Amertume forte.')}
       ${openContext(DG)} ${history('REC-2041')}`,
    );
    expect(rows.map((r) => r.avis)).toEqual(['favorable', 'reserve']);
  });

  it('les autres profils ne voient aucune annotation', async () => {
    for (const email of [
      'regional.labe@sabou-sante.gn',
      'm.diallo@exemple.gn',
      'aminata@exemple.gn',
    ]) {
      expect(await as(email, `SELECT count(*)::int AS n FROM annotation_comite;`)).toEqual([
        { n: 0 },
      ]);
    }
  });

  it('une annotation ne se modifie ni ne s’efface', async () => {
    for (const sql of [
      `UPDATE annotation_comite SET avis = 'favorable';`,
      `DELETE FROM annotation_comite;`,
      `INSERT INTO annotation_comite (objet_type, objet_id, auteur_id, contenu, avis)
       VALUES ('recette', 1, 4, 'Direct', 'favorable');`,
    ]) {
      await expect(as(COMMITTEE, sql)).rejects.toThrow(/permission denied/);
    }
  });
});
