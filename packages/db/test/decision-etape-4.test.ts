// US-044 : un membre du Comité scientifique expertise un dossier à l'étape 4. Exécuté sous le
// rôle de l'API (sabou_app), dans le contexte de chaque acteur, sur le jeu d'exemple ; chaque
// cas part du même état (transaction annulée). Le Comité est national : il voit les dossiers
// de toutes les régions ; lui seul décide à l'étape 4 (R-CER-01, R-CER-02).
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSeededDatabase,
  inRolledBackTransaction,
  lastRows as rowsAt,
  openContext,
  type TestDatabase,
} from './helpers.ts';

let db: TestDatabase;
const attempt = (sql: string) => inRolledBackTransaction(db.url.app, sql);
const lastRows = (sql: string) => rowsAt(db.url.app, sql);

// DS-1041 (praticien de Labé) soumis, vérifié sur le terrain après une visite réalisée, puis
// consolidé par le régional de Labé : il attend l'expertise du Comité (étape 4)
const atStep4 = `${openContext('s.kourouma@exemple.gn')}
  SELECT dossier_transition(1, 'soumis', contexte_utilisateur());
  ${openContext('prefectoral.labe@sabou-sante.gn')}
  WITH cr AS (
    INSERT INTO dossier_piece (dossier_id, type, fichier_url, sha256, depose_par)
    VALUES (1, 'compte_rendu_visite', 'pieces/test/visite.pdf', repeat('b', 64), contexte_utilisateur())
    RETURNING id)
  UPDATE visite_terrain SET statut = 'realisee', realisee_le = now(),
         compte_rendu_piece_id = (SELECT id FROM cr)
   WHERE dossier_id = 1;
  SELECT dossier_transition(1, 'valide', contexte_utilisateur());
  ${openContext('regional.labe@sabou-sante.gn')}
  SELECT dossier_transition(1, 'valide', contexte_utilisateur());`;

const as = (email: string, decision: string, motif = 'NULL') =>
  `${openContext(email)}
   SELECT dossier_transition(1, '${decision}', contexte_utilisateur(), ${motif}) AS etape;`;
const committee = (decision: string, motif?: string) =>
  as('comite@sabou-sante.gn', decision, motif);

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : dossier à l’étape 4, validation → étape 5', () => {
  it('fait passer le dossier à l’étape 5 (approbation de la DG)', async () => {
    const rows = await lastRows(`${atStep4} ${committee('valide')}
      SELECT etape_courante, statut FROM dossier_certification WHERE id = 1;`);
    expect(rows).toEqual([{ etape_courante: 5, statut: 'en_cours' }]);
  });

  it('trace la décision : historique, SMS au praticien en file, journal d’audit (R-CER-05)', async () => {
    const rows = await lastRows(`${atStep4} ${committee('valide')}
      SELECT (SELECT row(etape_depart, etape_arrivee, decision, u.email)::text
                FROM dossier_historique h JOIN utilisateur u ON u.id = h.acteur_id
               WHERE dossier_id = 1 ORDER BY h.id DESC LIMIT 1) AS historique,
             (SELECT row(canal, modele, objet_id)::text
                FROM notification ORDER BY id DESC LIMIT 1) AS notification,
             (SELECT row(action, objet_id, details->>'de', details->>'vers')::text
                FROM journal_audit ORDER BY id DESC LIMIT 1) AS audit;`);
    expect(rows).toEqual([
      {
        historique: '(4,5,valide,comite@sabou-sante.gn)',
        notification: '(sms,dossier.valide,DS-1041)',
        audit: '(dossier.valide,DS-1041,4,5)',
      },
    ]);
  });
});

describe('Critère : rejet avec motif → retour à l’étape 3 ; motif obligatoire', () => {
  it('renvoie le dossier à l’étape 3, motif conservé dans l’historique', async () => {
    const rows = await lastRows(`${atStep4}
      ${committee('rejete', `'Pratique à préciser : dosage des décoctions'`)}
      SELECT d.etape_courante, h.etape_depart, h.motif
        FROM dossier_certification d
        JOIN dossier_historique h ON h.dossier_id = d.id
       WHERE d.id = 1 ORDER BY h.id DESC LIMIT 1;`);
    expect(rows).toEqual([
      { etape_courante: 3, etape_depart: 4, motif: 'Pratique à préciser : dosage des décoctions' },
    ]);
  });

  it.each(['NULL', `''`, `'   '`])('refuse un rejet avec le motif %s', async (motif) => {
    await expect(attempt(`${atStep4} ${committee('rejete', motif)}`)).rejects.toThrow(
      'ck_motif_rejet',
    );
  });

  it('le dossier renvoyé repasse par le régional, puis revient en expertise', async () => {
    const rows = await lastRows(`${atStep4} ${committee('rejete', `'Avis à compléter'`)}
      ${as('regional.labe@sabou-sante.gn', 'valide')}`);
    expect(rows).toEqual([{ etape: 4 }]);
  });
});

describe('Seul le Comité scientifique décide à l’étape 4', () => {
  it.each([
    ['la DG', 'dg@sabou-sante.gn'],
    ['le régional de Labé', 'regional.labe@sabou-sante.gn'],
    ['le préfectoral de Labé', 'prefectoral.labe@sabou-sante.gn'],
  ])('%s n’est pas habilité(e)', async (_who, email) => {
    await expect(attempt(`${atStep4} ${as(email, 'rejete', `'Motif'`)}`)).rejects.toThrow(
      "non habilité pour l'étape 4 du dossier DS-1041",
    );
  });

  it('le régional de Kankan ne voit pas le dossier de Labé', async () => {
    await expect(
      attempt(`${atStep4} ${as('regional.kankan@sabou-sante.gn', 'rejete', `'Motif'`)}`),
    ).rejects.toThrow('Dossier 1 introuvable');
  });
});

describe('Liste d’expertise', () => {
  it('montre au Comité, national, les dossiers à l’étape 4 de toutes les régions', async () => {
    const rows = await lastRows(`${atStep4} ${openContext('comite@sabou-sante.gn')}
      SELECT code FROM dossier_certification
       WHERE statut = 'en_cours' AND etape_courante = 4 ORDER BY code;`);
    expect(rows).toEqual([{ code: 'DS-1041' }]);
  });
});
