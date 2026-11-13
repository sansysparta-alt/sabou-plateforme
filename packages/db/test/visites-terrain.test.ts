// US-041 : l'admin préfectoral planifie et réalise les visites terrain (UC-30, R-MOD-02).
// Exécuté sous le rôle de l'API (sabou_app), dans le contexte de chaque acteur, sur le jeu
// d'exemple ; chaque cas part du même état (transaction annulée). Les messages vérifiés ici
// sont ceux que l'API traduit en réponses (apps/api/src/visits/visits.repository.ts).
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

const LABE = 'prefectoral.labe@sabou-sante.gn';
const HASH = `'${'c'.repeat(64)}'`;

// DS-1041 (praticien de Labé) soumis : il passe à l'étape 2. Sa visite du jeu d'exemple est
// planifiée dans 3 jours (visite n° 2).
const submitted = `${openContext('s.kourouma@exemple.gn')}
  SELECT dossier_transition(1, 'soumis', contexte_utilisateur());`;

const plan = (email: string, when: string) => `${openContext(email)}
  SELECT visite_planifier(1, contexte_utilisateur(), ${when}) AS visite;`;

const realize = (
  email: string,
  { date = 'current_date', constats = `'Lieu conforme.'`, avis = `'favorable'`, hash = HASH } = {},
) => `${openContext(email)}
  SELECT visite_realiser(1, contexte_utilisateur(), 2, ${date}, ${constats}, ${avis}, ${hash}) AS visite;`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 1 : la veille de la visite, un rappel part au praticien', () => {
  // Heure de Conakry, la veille de la visite planifiée
  const eve = (time: string) =>
    `((SELECT (prevue_le AT TIME ZONE 'Africa/Conakry')::date - 1 FROM visite_terrain WHERE id = 2)
       + time '${time}') AT TIME ZONE 'Africa/Conakry'`;
  // Mise en file, comme l'API, sans contexte de zone : la fonction voit toutes les zones
  const remind = (at: string) => `SELECT visite_rappels_mettre_en_file(${at}) AS nombre;`;

  it('rien avant 8 h la veille', async () => {
    const rows = await lastRows(`${submitted} ${remind(eve('07:59'))}`);
    expect(rows).toEqual([{ nombre: 0 }]);
  });

  it('à partir de 8 h la veille : un SMS au praticien, une seule fois', async () => {
    const rows = await lastRows(`${submitted}
      ${remind(eve('08:00'))} ${remind(eve('12:00'))}
      SELECT row(destinataire_id, canal, modele, objet_type, objet_id)::text AS sms,
             parametres->>'prevueLe' = (SELECT to_char(prevue_le AT TIME ZONE 'Africa/Conakry',
                                        'YYYY-MM-DD"T"HH24:MI') FROM visite_terrain WHERE id = 2) AS date,
             (SELECT rappel_envoye_le IS NOT NULL FROM visite_terrain WHERE id = 2) AS marque,
             (SELECT count(*)::int FROM notification WHERE modele = 'visite.rappel') AS total
        FROM notification WHERE modele = 'visite.rappel';`);
    expect(rows).toEqual([
      { sms: '(6,sms,visite.rappel,dossier,DS-1041)', date: true, marque: true, total: 1 },
    ]);
  });

  it('une visite planifiée moins d’un jour à l’avance reçoit son rappel aussitôt', async () => {
    const rows = await lastRows(`${submitted} ${plan(LABE, "now() + interval '3 hours'")}
      ${remind('now()')}`);
    expect(rows).toEqual([{ nombre: 1 }]);
  });

  it('replanifier remet le rappel à zéro : le praticien est prévenu de la nouvelle date', async () => {
    const rows = await lastRows(`${submitted} ${remind(eve('09:00'))}
      ${plan(LABE, "now() + interval '10 days'")}
      SELECT rappel_envoye_le, (SELECT count(*)::int FROM visite_terrain WHERE dossier_id = 1) AS visites
        FROM visite_terrain WHERE id = 2;`);
    expect(rows).toEqual([{ rappel_envoye_le: null, visites: 1 }]);
  });

  it('aucun rappel pour une visite déjà réalisée, annulée ou passée', async () => {
    const realized = await lastRows(`${submitted} ${realize(LABE)} ${remind(eve('09:00'))}`);
    expect(realized).toEqual([{ nombre: 0 }]);
    const cancelled = await lastRows(`${submitted}
      UPDATE visite_terrain SET statut = 'annulee' WHERE id = 2; ${remind(eve('09:00'))}`);
    expect(cancelled).toEqual([{ nombre: 0 }]);
    const past = await lastRows(`${submitted}
      ${remind(`(SELECT prevue_le + interval '1 minute' FROM visite_terrain WHERE id = 2)`)}`);
    expect(past).toEqual([{ nombre: 0 }]);
  });

  it('la mise en file est réservée à l’API', async () => {
    const rows = await rowsAt(
      db.url.postgres,
      `SELECT has_function_privilege('public', 'sabou.visite_rappels_mettre_en_file(timestamptz)', 'EXECUTE') AS public,
              has_function_privilege('sabou_app', 'sabou.visite_rappels_mettre_en_file(timestamptz)', 'EXECUTE') AS api;`,
    );
    expect(rows).toEqual([{ public: false, api: true }]);
  });
});

describe('Critère 2 : une visite réalisée exige un compte rendu signé', () => {
  it('enregistre le compte rendu, son empreinte, son auteur et l’heure de signature', async () => {
    const rows = await lastRows(`${submitted} ${realize(LABE)}
      SELECT statut, constats, avis, empreinte_sha3 = ${HASH} AS empreinte, signe_par,
             signe_le IS NOT NULL AS signe, realisee_le IS NOT NULL AS realisee
        FROM visite_terrain WHERE id = 2;`);
    expect(rows).toEqual([
      {
        statut: 'realisee',
        constats: 'Lieu conforme.',
        avis: 'favorable',
        empreinte: true,
        signe_par: '3',
        signe: true,
        realisee: true,
      },
    ]);
  });

  it('trace la signature au journal d’audit, avec l’empreinte', async () => {
    const rows = await lastRows(`${submitted} ${realize(LABE)}
      SELECT utilisateur_id, action, objet_id, details->>'avis' AS avis,
             details->>'empreinte_sha3' = ${HASH} AS empreinte
        FROM journal_audit ORDER BY id DESC LIMIT 1;`);
    expect(rows).toEqual([
      {
        utilisateur_id: '3',
        action: 'visite.realisee',
        objet_id: 'DS-1041',
        avis: 'favorable',
        empreinte: true,
      },
    ]);
  });

  it.each([
    ['sans constats', { constats: 'NULL' }, 'ck_visite_realisee'],
    ['avec des constats vides', { constats: `'   '` }, 'visite_terrain_constats_check'],
    ['sans avis', { avis: 'NULL' }, 'ck_visite_realisee'],
    ['avec un avis inconnu', { avis: `'excellent'` }, 'visite_terrain_avis_check'],
    ['sans empreinte', { hash: 'NULL' }, 'ck_visite_realisee'],
    ['avec une empreinte mal formée', { hash: `'abc'` }, 'visite_terrain_empreinte_sha3_check'],
  ])('refuse un compte rendu %s', async (_, input, error) => {
    await expect(attempt(`${submitted} ${realize(LABE, input)}`)).rejects.toThrow(error);
  });

  it('refuse une date de visite future ou antérieure à la soumission', async () => {
    await expect(
      attempt(`${submitted} ${realize(LABE, { date: 'current_date + 1' })}`),
    ).rejects.toThrow('date de visite entre la soumission et aujourd');
    await expect(
      attempt(`${submitted} ${realize(LABE, { date: 'current_date - 1' })}`),
    ).rejects.toThrow('date de visite entre la soumission et aujourd');
  });

  it('refuse d’enregistrer une visite qui n’est pas planifiée', async () => {
    await expect(
      attempt(
        `${submitted} UPDATE visite_terrain SET statut = 'annulee' WHERE id = 2; ${realize(LABE)}`,
      ),
    ).rejects.toThrow('aucune visite planifiée à enregistrer');
  });

  it('fige le compte rendu signé, même pour le propriétaire des tables', async () => {
    await expect(
      attempt(
        `${submitted} ${realize(LABE)} UPDATE visite_terrain SET constats = 'Autre texte' WHERE id = 2;`,
      ),
    ).rejects.toThrow('compte rendu figé');
    await expect(
      inRolledBackTransaction(
        db.url.migrator,
        `UPDATE visite_terrain SET avis = 'defavorable' WHERE id = 1;`,
      ),
    ).rejects.toThrow('compte rendu figé');
  });

  const photo = `SELECT visite_photo_joindre(1, contexte_utilisateur(), 2, 'pieces/test/fiche.jpg',
                   repeat('d', 64), 'image/jpeg', 1000) AS piece;`;

  it('joint la photo facultative de la fiche papier, une seule fois, et la trace', async () => {
    const rows = await lastRows(`${submitted} ${realize(LABE)} ${photo}
      SELECT (SELECT type FROM dossier_piece WHERE id = vt.compte_rendu_piece_id) AS type,
             (SELECT action FROM journal_audit ORDER BY id DESC LIMIT 1) AS audit
        FROM visite_terrain vt WHERE vt.id = 2;`);
    expect(rows).toEqual([{ type: 'compte_rendu_visite', audit: 'visite.photo' }]);
    await expect(attempt(`${submitted} ${realize(LABE)} ${photo} ${photo}`)).rejects.toThrow(
      'photo possible une seule fois',
    );
    await expect(attempt(`${submitted} ${openContext(LABE)} ${photo}`)).rejects.toThrow(
      'photo possible une seule fois',
    );
  });

  it('le trigger accepte seulement l’ajout de la photo, sans toucher au texte', async () => {
    const rows = await lastRows(`${submitted} ${realize(LABE)}
      WITH p AS (INSERT INTO dossier_piece (dossier_id, type, fichier_url, sha256, depose_par)
                 VALUES (1, 'compte_rendu_visite', 'pieces/test/fiche.jpg', repeat('d', 64), 3) RETURNING id)
      UPDATE visite_terrain SET compte_rendu_piece_id = (SELECT id FROM p) WHERE id = 2
      RETURNING compte_rendu_piece_id IS NOT NULL AS photo;`);
    expect(rows).toEqual([{ photo: true }]);
    await expect(
      attempt(`${submitted} ${realize(LABE)} UPDATE visite_terrain SET compte_rendu_piece_id = 3 WHERE id = 2;
        UPDATE visite_terrain SET compte_rendu_piece_id = 4 WHERE id = 2;`),
    ).rejects.toThrow('compte rendu figé');
  });

  it('une fois la visite enregistrée, le dossier peut être validé (US-042)', async () => {
    const rows = await lastRows(`${submitted} ${realize(LABE)}
      SELECT dossier_transition(1, 'valide', contexte_utilisateur()) AS etape;`);
    expect(rows).toEqual([{ etape: 3 }]);
  });
});

describe('Planification', () => {
  it('replanifie la visite existante au lieu d’en créer une seconde, et trace la date', async () => {
    const rows = await lastRows(`${submitted} ${openContext(LABE)}
      SELECT visite_planifier(1, contexte_utilisateur(), now() + interval '5 days') AS visite;
      SELECT (SELECT id::int FROM visite_terrain WHERE dossier_id = 1 AND statut = 'planifiee') AS visite,
             (SELECT count(*)::int FROM visite_terrain WHERE dossier_id = 1 AND statut = 'planifiee') AS planifiees,
             (SELECT action FROM journal_audit ORDER BY id DESC LIMIT 1) AS audit;`);
    expect(rows).toEqual([{ visite: 2, planifiees: 1, audit: 'visite.planifiee' }]);
  });

  it('crée une visite quand aucune n’est planifiée', async () => {
    const rows =
      await lastRows(`${submitted} UPDATE visite_terrain SET statut = 'annulee' WHERE id = 2;
      ${plan(LABE, "now() + interval '2 days'")}
      SELECT count(*)::int AS planifiees FROM visite_terrain WHERE dossier_id = 1 AND statut = 'planifiee';`);
    expect(rows).toEqual([{ planifiees: 1 }]);
  });

  it.each(["now() - interval '1 hour'", "now() + interval '91 days'", 'NULL'])(
    'refuse la date %s',
    async (when) => {
      await expect(attempt(`${submitted} ${plan(LABE, when)}`)).rejects.toThrow(
        'date de visite hors des 90 prochains jours',
      );
    },
  );
});

describe('Habilitation : la visite est l’affaire du préfectoral de la préfecture', () => {
  it.each(['regional.labe@sabou-sante.gn', 'dg@sabou-sante.gn'])(
    '%s voit le dossier mais ne peut ni planifier ni enregistrer',
    async (email) => {
      await expect(
        attempt(`${submitted} ${plan(email, "now() + interval '2 days'")}`),
      ).rejects.toThrow('non habilité pour les visites');
      await expect(attempt(`${submitted} ${realize(email)}`)).rejects.toThrow(
        'non habilité pour les visites',
      );
    },
  );

  it('le préfectoral d’une autre préfecture ne voit pas le dossier', async () => {
    await expect(
      attempt(
        `${submitted} ${plan('prefectoral.kankan@sabou-sante.gn', "now() + interval '2 days'")}`,
      ),
    ).rejects.toThrow('Dossier 1 introuvable');
  });

  it('refuse hors de l’étape 2', async () => {
    await expect(attempt(plan(LABE, "now() + interval '2 days'"))).rejects.toThrow(
      'visite possible seulement à l’étape 2'.replace('’', "'"),
    );
  });
});
