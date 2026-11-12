// US-042 : l'admin préfectoral valide ou rejette un dossier à l'étape 2. Exécuté sous le rôle
// de l'API (sabou_app), dans le contexte de chaque acteur, sur le jeu d'exemple ; chaque cas
// part du même état (transaction annulée). Les messages vérifiés ici sont ceux que l'API
// traduit en réponses (apps/api/src/certification/certification.repository.ts).
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSeededDatabase,
  inRolledBackTransaction,
  openContext,
  type TestDatabase,
} from './helpers.ts';

let db: TestDatabase;
const attempt = (sql: string) => inRolledBackTransaction(db.url.app, sql);

// Lignes de la dernière instruction, dans une transaction toujours annulée
async function lastRows(sql: string): Promise<Record<string, unknown>[]> {
  const client = new pg.Client({ connectionString: db.url.app });
  await client.connect();
  try {
    await client.query('BEGIN');
    const results = (await client.query(`SET LOCAL search_path = sabou, public; ${sql}`)) as
      pg.QueryResult | pg.QueryResult[];
    return (Array.isArray(results) ? results.at(-1)! : results).rows;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

// DS-1041 (praticien de Labé, pièces complètes) soumis par son praticien : il passe à
// l'étape 2. Sa visite du jeu d'exemple est seulement planifiée.
const submitted = `${openContext('s.kourouma@exemple.gn')}
  SELECT dossier_transition(1, 'soumis', contexte_utilisateur());`;

// Visite réalisée par l'admin préfectoral de Labé, avec son compte rendu signé (R-CER-06).
// Saisie directe : l'écran des visites arrive avec US-041.
const visitDone = `${openContext('prefectoral.labe@sabou-sante.gn')}
  WITH cr AS (
    INSERT INTO dossier_piece (dossier_id, type, fichier_url, sha256, depose_par)
    VALUES (1, 'compte_rendu_visite', 'pieces/test/visite.pdf', repeat('b', 64), contexte_utilisateur())
    RETURNING id)
  UPDATE visite_terrain SET statut = 'realisee', realisee_le = now(),
         compte_rendu_piece_id = (SELECT id FROM cr)
   WHERE dossier_id = 1;`;

const as = (email: string, decision: string, motif = 'NULL') =>
  `${openContext(email)}
   SELECT dossier_transition(1, '${decision}', contexte_utilisateur(), ${motif}) AS etape;`;
const prefectoralLabe = (decision: string, motif?: string) =>
  as('prefectoral.labe@sabou-sante.gn', decision, motif);

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 1 : visite réalisée avec compte rendu, validation → étape 3', () => {
  it('fait passer le dossier à l’étape 3', async () => {
    const rows = await lastRows(`${submitted} ${visitDone} ${prefectoralLabe('valide')}
      SELECT etape_courante, statut FROM dossier_certification WHERE id = 1;`);
    expect(rows).toEqual([{ etape_courante: 3, statut: 'en_cours' }]);
  });

  it('trace la décision : historique, SMS au praticien en file, journal d’audit (R-CER-05)', async () => {
    const rows = await lastRows(`${submitted} ${visitDone} ${prefectoralLabe('valide')}
      SELECT (SELECT row(etape_depart, etape_arrivee, decision, acteur_id)::text
                FROM dossier_historique WHERE dossier_id = 1 ORDER BY id DESC LIMIT 1) AS historique,
             (SELECT row(destinataire_id, canal, modele, objet_id)::text
                FROM notification ORDER BY id DESC LIMIT 1) AS notification,
             (SELECT row(utilisateur_id, action, objet_id, details->>'de', details->>'vers')::text
                FROM journal_audit ORDER BY id DESC LIMIT 1) AS audit;`);
    expect(rows).toEqual([
      {
        historique: '(2,3,valide,3)',
        notification: '(6,sms,dossier.valide,DS-1041)',
        audit: '(3,dossier.valide,DS-1041,2,3)',
      },
    ]);
  });
});

describe('Critère 2 : dossier initial sans visite réalisée, validation refusée', () => {
  it('refuse quand la visite est seulement planifiée', async () => {
    await expect(attempt(`${submitted} ${prefectoralLabe('valide')}`)).rejects.toThrow(
      'visite terrain signée requise avant validation (R-CER-06)',
    );
  });

  it('refuse quand la visite a été annulée', async () => {
    await expect(
      attempt(`${submitted} ${openContext('prefectoral.labe@sabou-sante.gn')}
        UPDATE visite_terrain SET statut = 'annulee' WHERE dossier_id = 1;
        ${prefectoralLabe('valide')}`),
    ).rejects.toThrow('visite terrain signée requise avant validation (R-CER-06)');
  });

  it('refuse une visite marquée réalisée sans compte rendu signé', async () => {
    await expect(
      attempt(`${submitted} ${openContext('prefectoral.labe@sabou-sante.gn')}
        UPDATE visite_terrain SET statut = 'realisee', realisee_le = now() WHERE dossier_id = 1;`),
    ).rejects.toThrow('ck_visite_realisee');
  });
});

describe('Critère 3 : rejet sans motif refusé ; avec motif, retour à l’étape 1', () => {
  it.each(['NULL', `''`, `'   '`])('refuse un rejet avec le motif %s', async (motif) => {
    await expect(attempt(`${submitted} ${prefectoralLabe('rejete', motif)}`)).rejects.toThrow(
      'ck_motif_rejet',
    );
  });

  it('renvoie le dossier motivé à l’étape 1, motif conservé (même sans visite)', async () => {
    const rows = await lastRows(`${submitted}
      ${prefectoralLabe('rejete', `'Adresse du lieu de pratique introuvable'`)}
      SELECT d.etape_courante, h.motif
        FROM dossier_certification d
        JOIN dossier_historique h ON h.dossier_id = d.id
       WHERE d.id = 1 ORDER BY h.id DESC LIMIT 1;`);
    expect(rows).toEqual([{ etape_courante: 1, motif: 'Adresse du lieu de pratique introuvable' }]);
  });

  it('rend le dossier de nouveau modifiable par le praticien, puis soumissible', async () => {
    await expect(
      attempt(`${submitted} ${prefectoralLabe('rejete', `'Photo floue'`)}
        ${openContext('s.kourouma@exemple.gn')}
        INSERT INTO dossier_piece (dossier_id, type, fichier_url, sha256, depose_par, type_mime, taille_octets)
        VALUES (1, 'photo', 'pieces/test/photo-2.jpg', repeat('c', 64), contexte_utilisateur(), 'image/jpeg', 1000);
        SELECT dossier_transition(1, 'soumis', contexte_utilisateur());`),
    ).resolves.toBeUndefined();
  });
});

describe('Critère 4 : dossier d’une autre préfecture, décision refusée', () => {
  it.each(['valide', 'rejete'])(
    'le préfectoral de Kankan ne voit pas le dossier de Labé (%s)',
    async (decision) => {
      await expect(
        attempt(`${submitted} ${visitDone}
          ${as('prefectoral.kankan@sabou-sante.gn', decision, `'Motif'`)}`),
      ).rejects.toThrow('Dossier 1 introuvable');
    },
  );

  it('l’admin régional de Labé voit le dossier mais n’est pas responsable de l’étape 2', async () => {
    await expect(
      attempt(`${submitted} ${visitDone} ${as('regional.labe@sabou-sante.gn', 'valide')}`),
    ).rejects.toThrow("non habilité pour l'étape 2 du dossier DS-1041");
  });

  it('la DG ne décide pas non plus à la place du préfectoral', async () => {
    await expect(
      attempt(`${submitted} ${visitDone} ${as('dg@sabou-sante.gn', 'rejete', `'Motif'`)}`),
    ).rejects.toThrow("non habilité pour l'étape 2 du dossier DS-1041");
  });
});

describe('Liste de vérification terrain', () => {
  it('montre au préfectoral de Labé ses dossiers à l’étape 2, avec l’état de la visite', async () => {
    const rows = await lastRows(`${submitted} ${openContext('prefectoral.labe@sabou-sante.gn')}
      SELECT d.code, EXISTS (SELECT 1 FROM visite_terrain vt
                              WHERE vt.dossier_id = d.id AND vt.statut = 'realisee') AS realisee
        FROM dossier_certification d
       WHERE d.statut = 'en_cours' AND d.etape_courante = 2 ORDER BY d.code;`);
    expect(rows).toEqual([{ code: 'DS-1041', realisee: false }]);
  });

  it('ne montre rien au préfectoral de Kankan', async () => {
    const rows = await lastRows(`${submitted} ${openContext('prefectoral.kankan@sabou-sante.gn')}
      SELECT count(*)::int AS n FROM dossier_certification
       WHERE statut = 'en_cours' AND etape_courante = 2;`);
    expect(rows).toEqual([{ n: 0 }]);
  });
});
