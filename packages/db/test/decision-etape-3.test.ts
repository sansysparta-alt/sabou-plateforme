// US-043 : l'admin régional consolide un dossier à l'étape 3. Exécuté sous le rôle de l'API
// (sabou_app), dans le contexte de chaque acteur, sur le jeu d'exemple ; chaque cas part du
// même état (transaction annulée). Seul l'admin régional de la région du praticien décide :
// ni la DG, ni le préfectoral, ni le Comité (décision du maître d'œuvre du 12 novembre 2026).
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

// DS-1041 (praticien de Labé) soumis, visite réalisée avec compte rendu signé, validé par le
// préfectoral de Labé : il attend la consolidation régionale (étape 3)
const atStep3 = `${openContext('s.kourouma@exemple.gn')}
  SELECT dossier_transition(1, 'soumis', contexte_utilisateur());
  ${openContext('prefectoral.labe@sabou-sante.gn')}
  SELECT visite_realiser(1, contexte_utilisateur(), vt.id, current_date, 'Lieu conforme.',
                         'favorable', repeat('b', 64))
    FROM visite_terrain vt WHERE vt.dossier_id = 1 AND vt.statut = 'planifiee';
  SELECT dossier_transition(1, 'valide', contexte_utilisateur());`;

const as = (email: string, decision: string, motif = 'NULL') =>
  `${openContext(email)}
   SELECT dossier_transition(1, '${decision}', contexte_utilisateur(), ${motif}) AS etape;`;
const regionalLabe = (decision: string, motif?: string) =>
  as('regional.labe@sabou-sante.gn', decision, motif);

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : dossier de ma région à l’étape 3, validation → étape 4', () => {
  it('fait passer le dossier à l’étape 4', async () => {
    const rows = await lastRows(`${atStep3} ${regionalLabe('valide')}
      SELECT etape_courante, statut FROM dossier_certification WHERE id = 1;`);
    expect(rows).toEqual([{ etape_courante: 4, statut: 'en_cours' }]);
  });

  it('trace la décision : historique, SMS au praticien en file, journal d’audit (R-CER-05)', async () => {
    const rows = await lastRows(`${atStep3} ${regionalLabe('valide')}
      SELECT (SELECT row(etape_depart, etape_arrivee, decision, u.email)::text
                FROM dossier_historique h JOIN utilisateur u ON u.id = h.acteur_id
               WHERE dossier_id = 1 ORDER BY h.id DESC LIMIT 1) AS historique,
             (SELECT row(canal, modele, objet_id)::text
                FROM notification ORDER BY id DESC LIMIT 1) AS notification,
             (SELECT row(action, objet_id, details->>'de', details->>'vers')::text
                FROM journal_audit ORDER BY id DESC LIMIT 1) AS audit;`);
    expect(rows).toEqual([
      {
        historique: '(3,4,valide,regional.labe@sabou-sante.gn)',
        notification: '(sms,dossier.valide,DS-1041)',
        audit: '(dossier.valide,DS-1041,3,4)',
      },
    ]);
  });
});

describe('Critère : rejet avec motif → retour à l’étape 2 ; motif obligatoire', () => {
  it('renvoie le dossier à l’étape 2, motif conservé dans l’historique', async () => {
    const rows = await lastRows(`${atStep3}
      ${regionalLabe('rejete', `'Compte rendu de visite incomplet'`)}
      SELECT d.etape_courante, h.etape_depart, h.motif
        FROM dossier_certification d
        JOIN dossier_historique h ON h.dossier_id = d.id
       WHERE d.id = 1 ORDER BY h.id DESC LIMIT 1;`);
    expect(rows).toEqual([
      { etape_courante: 2, etape_depart: 3, motif: 'Compte rendu de visite incomplet' },
    ]);
  });

  it.each(['NULL', `''`, `'   '`])('refuse un rejet avec le motif %s', async (motif) => {
    await expect(attempt(`${atStep3} ${regionalLabe('rejete', motif)}`)).rejects.toThrow(
      'ck_motif_rejet',
    );
  });

  it('le dossier renvoyé repasse par le préfectoral, puis revient en consolidation', async () => {
    const rows = await lastRows(`${atStep3} ${regionalLabe('rejete', `'Pièce manquante'`)}
      ${as('prefectoral.labe@sabou-sante.gn', 'valide')}`);
    expect(rows).toEqual([{ etape: 3 }]);
  });
});

describe('Seul l’admin régional de la région du praticien décide à l’étape 3', () => {
  it.each(['valide', 'rejete'])(
    'le régional de Kankan ne voit pas le dossier de Labé (%s)',
    async (decision) => {
      await expect(
        attempt(`${atStep3} ${as('regional.kankan@sabou-sante.gn', decision, `'Motif'`)}`),
      ).rejects.toThrow('Dossier 1 introuvable');
    },
  );

  it.each([
    ['la DG (niveau national)', 'dg@sabou-sante.gn'],
    ['le préfectoral de Labé', 'prefectoral.labe@sabou-sante.gn'],
    ['le Comité scientifique', 'comite@sabou-sante.gn'],
  ])('%s n’est pas habilité(e)', async (_who, email) => {
    await expect(attempt(`${atStep3} ${as(email, 'rejete', `'Motif'`)}`)).rejects.toThrow(
      "non habilité pour l'étape 3 du dossier DS-1041",
    );
  });
});

describe('Liste de consolidation', () => {
  it('montre au régional de Labé ses dossiers à l’étape 3', async () => {
    const rows = await lastRows(`${atStep3} ${openContext('regional.labe@sabou-sante.gn')}
      SELECT code FROM dossier_certification
       WHERE statut = 'en_cours' AND etape_courante = 3 ORDER BY code;`);
    expect(rows).toEqual([{ code: 'DS-1041' }]);
  });

  it('ne montre rien au régional de Kankan', async () => {
    const rows = await lastRows(`${atStep3} ${openContext('regional.kankan@sabou-sante.gn')}
      SELECT count(*)::int AS n FROM dossier_certification
       WHERE statut = 'en_cours' AND etape_courante = 3;`);
    expect(rows).toEqual([{ n: 0 }]);
  });
});
