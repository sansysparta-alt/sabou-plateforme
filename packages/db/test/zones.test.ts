// Lot B (US-011) : cloisonnement par zone dans PostgreSQL (RLS), sous le rôle de l'API.
// Jeu d'exemple : PR-1041 et PR-1042 à Labé, PR-1043 à Siguiri (région de Siguiri depuis
// le découpage d'août 2026, US-023 ; auparavant région de Kankan),
// PR-1044 à Kindia, PR-1045 à Mamou ; un dossier DS-10xx par praticien.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
let app: pg.Client;
let owner: pg.Client;

beforeAll(async () => {
  db = await createSeededDatabase();
  app = new pg.Client({ connectionString: db.url.app, options: '-c search_path=sabou,public' });
  owner = new pg.Client({
    connectionString: db.url.migrator,
    options: '-c search_path=sabou,public',
  });
  await Promise.all([app.connect(), owner.connect()]);
});

afterAll(async () => {
  await Promise.all([app?.end(), owner?.end()]);
});

// Exécute une requête dans le contexte d'un compte du jeu d'exemple, transaction annulée
async function as<T extends pg.QueryResultRow>(
  email: string | null,
  query: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  await app.query('BEGIN');
  try {
    if (email) {
      await app.query(`SELECT contexte_ouvrir(md5('sabou:' || $1)::uuid)`, [email]);
    }
    return await app.query<T>(query, params);
  } finally {
    await app.query('ROLLBACK');
  }
}

const codes = async (email: string | null, table: 'praticien' | 'dossier_certification') =>
  (await as<{ code: string }>(email, `SELECT code FROM ${table} ORDER BY code`)).rows.map(
    (r) => r.code,
  );

const LABE = 'prefectoral.labe@sabou-sante.gn';
const KANKAN_REGION = 'regional.kankan@sabou-sante.gn';
const SIGUIRI_REGION = 'regional.siguiri@sabou-sante.gn';
const ALL_PRACTITIONERS = ['PR-1041', 'PR-1042', 'PR-1043', 'PR-1044', 'PR-1045'];

describe('Admin préfectoral de Labé (US-011, critère 1)', () => {
  it('ne voit que les praticiens de Labé', async () => {
    expect(await codes(LABE, 'praticien')).toEqual(['PR-1041', 'PR-1042']);
  });

  it('ne lit pas un praticien d’une autre zone, même désigné directement', async () => {
    const { rows } = await as(LABE, `SELECT * FROM praticien WHERE code = 'PR-1043'`);
    expect(rows).toEqual([]);
  });

  it('ne modifie pas un praticien d’une autre zone', async () => {
    const { rowCount } = await as(
      LABE,
      `UPDATE praticien SET annees_experience = 1 WHERE code = 'PR-1043'`,
    );
    expect(rowCount).toBe(0);
  });

  it('ne déplace pas un praticien de Labé hors de sa zone', async () => {
    await expect(
      as(LABE, `UPDATE praticien SET prefecture_id = 9 WHERE code = 'PR-1041'`),
    ).rejects.toThrow('row-level security');
  });

  it('ne voit ni les pièces ni l’historique d’un dossier d’une autre zone', async () => {
    const pieces = await as<{ dossier_id: string }>(
      LABE,
      'SELECT DISTINCT dossier_id FROM dossier_piece',
    );
    expect(pieces.rows.map((r) => Number(r.dossier_id)).sort()).toEqual([1, 2]);
    // Région de Siguiri : les pièces du seul DS-1043, jamais celles de Labé
    const other = await as<{ dossier_id: string }>(
      SIGUIRI_REGION,
      'SELECT DISTINCT dossier_id FROM dossier_piece',
    );
    expect(other.rows.map((r) => Number(r.dossier_id))).toEqual([3]);
  });
});

describe('Admin régional de Siguiri (US-011, critère 2)', () => {
  it('ne voit que les dossiers des préfectures de sa région', async () => {
    // Préfectures de la région de Siguiri : seul PR-1043 (Siguiri) a un dossier
    expect(await codes(SIGUIRI_REGION, 'dossier_certification')).toEqual(['DS-1043']);
  });

  it('voit les praticiens de toutes les préfectures de sa région, et d’elles seules', async () => {
    expect(await codes(SIGUIRI_REGION, 'praticien')).toEqual(['PR-1043']);
    expect(await codes('regional.labe@sabou-sante.gn', 'praticien')).toEqual([
      'PR-1041',
      'PR-1042',
    ]);
  });
});

describe('US-023 : découpage d’août 2026', () => {
  it('Siguiri a quitté la région de Kankan : son admin régional ne voit plus PR-1043', async () => {
    expect(await codes(KANKAN_REGION, 'praticien')).toEqual([]);
    expect(await codes(KANKAN_REGION, 'dossier_certification')).toEqual([]);
  });

  it('Siguiri et Beyla sont des régions, avec leurs préfectures et leur langue par défaut', async () => {
    const { rows } = await owner.query<{
      region: string;
      naturelle: string;
      langue: string;
      prefectures: string[];
    }>(
      `SELECT r.nom AS region, n.nom AS naturelle, n.langue_defaut_code AS langue,
              array_agg(p.nom ORDER BY p.nom) AS prefectures
         FROM region_admin r
         JOIN region_naturelle n ON n.id = r.region_naturelle_id
         JOIN prefecture p ON p.region_admin_id = r.id
        WHERE r.nom IN ('Siguiri', 'Beyla')
        GROUP BY r.nom, n.nom, n.langue_defaut_code
        ORDER BY r.nom`,
    );
    expect(rows).toEqual([
      {
        region: 'Beyla',
        naturelle: 'Guinée Forestière',
        langue: 'gue',
        prefectures: ['Beyla', 'Karala', 'Kouankan', 'Sinko'],
      },
      {
        region: 'Siguiri',
        naturelle: 'Haute Guinée',
        langue: 'mal',
        prefectures: ['Doko', 'Kintinia', 'Siguiri', 'Siguirini'],
      },
    ]);
  });

  it('les autres préfectures nouvelles sont dans leur région', async () => {
    const { rows } = await owner.query<{ prefecture: string; region: string }>(
      `SELECT p.nom AS prefecture, r.nom AS region
         FROM prefecture p JOIN region_admin r ON r.id = p.region_admin_id
        WHERE p.nom IN ('Kamsar', 'Timbo', 'Tokounou', 'Djalakoro', 'Sabadou-Baranama')
        ORDER BY p.nom`,
    );
    expect(rows).toEqual([
      { prefecture: 'Djalakoro', region: 'Kankan' },
      { prefecture: 'Kamsar', region: 'Boké' },
      { prefecture: 'Sabadou-Baranama', region: 'Kankan' },
      { prefecture: 'Timbo', region: 'Mamou' },
      { prefecture: 'Tokounou', region: 'Kankan' },
    ]);
  });
});

describe('Requête sans contexte de zone (US-011, critère 3)', () => {
  const tables = [
    'praticien',
    'dossier_certification',
    'dossier_piece',
    'visite_terrain',
    'dossier_historique',
    'saisie_terrain',
    'saisie_terrain_version',
  ];

  it.each(tables)('%s : aucune ligne pour le rôle de l’API', async (table) => {
    const { rows } = await as<{ n: number }>(null, `SELECT count(*)::int AS n FROM ${table}`);
    expect(rows[0]!.n).toBe(0);
  });

  it('contre-épreuve : les lignes existent bien pour le propriétaire des tables', async () => {
    const { rows } = await owner.query<{ n: number }>('SELECT count(*)::int AS n FROM praticien');
    expect(rows[0]!.n).toBe(5);
  });

  it('refuse toute écriture sans contexte', async () => {
    await expect(
      as(
        null,
        `INSERT INTO saisie_terrain (id, type, prefecture_id, auteur_id, contenu)
                VALUES (gen_random_uuid(), 'dossier', 4, 3, '{}')`,
      ),
    ).rejects.toThrow('row-level security');
  });

  it('le contexte ne survit pas à la transaction (pool de connexions)', async () => {
    await app.query('BEGIN');
    await app.query(`SELECT contexte_ouvrir(md5('sabou:dg@sabou-sante.gn')::uuid)`);
    await app.query('COMMIT');
    const { rows } = await app.query<{ n: number }>('SELECT count(*)::int AS n FROM praticien');
    expect(rows[0]!.n).toBe(0);
  });
});

describe('Autres profils (R-ACC-02)', () => {
  it('DG et Comité scientifique : zone nationale', async () => {
    expect(await codes('dg@sabou-sante.gn', 'praticien')).toEqual(ALL_PRACTITIONERS);
    expect(await codes('comite@sabou-sante.gn', 'praticien')).toEqual(ALL_PRACTITIONERS);
  });

  it('praticien : sa seule fiche et ses seuls dossiers', async () => {
    expect(await codes('s.kourouma@exemple.gn', 'praticien')).toEqual(['PR-1041']);
    expect(await codes('s.kourouma@exemple.gn', 'dossier_certification')).toEqual(['DS-1041']);
  });

  it('citoyen : rien', async () => {
    expect(await codes('aminata@exemple.gn', 'praticien')).toEqual([]);
  });

  it('refuse le contexte d’un compte suspendu ou inconnu, avec la même erreur', async () => {
    await owner.query(`UPDATE utilisateur SET statut = 'suspendu' WHERE id = 3`);
    try {
      await expect(codes(LABE, 'praticien')).rejects.toThrow('Aucun compte actif pour ce contexte');
      await expect(codes('inconnu@exemple.invalid', 'praticien')).rejects.toThrow(
        'Aucun compte actif pour ce contexte',
      );
    } finally {
      await owner.query(`UPDATE utilisateur SET statut = 'actif' WHERE id = 3`);
    }
  });
});

describe('Traitements qui dépassent une zone', () => {
  it('les notes d’un praticien sont recalculées après le témoignage d’un citoyen', async () => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT contexte_ouvrir(md5('sabou:mariam@exemple.gn')::uuid)`);
      // Annuaire public (vue du propriétaire) : le citoyen y lit la note du praticien
      const reviews = async () =>
        (
          await app.query<{ nb_avis: number }>(
            `SELECT nb_avis FROM v_annuaire_public
              WHERE id = (SELECT praticien_id FROM recette WHERE id = 1)`,
          )
        ).rows[0]!.nb_avis;
      const before = await reviews();
      await app.query(`INSERT INTO temoignage (auteur_id, recette_id, note, contenu, langue_code, statut)
                       VALUES (14, 1, 1, 'Essai', 'fr', 'publie')`);
      expect(await reviews()).toBe(before + 1);
    } finally {
      await app.query('ROLLBACK');
    }
  });

  it('la vérification publique d’un certificat fonctionne sans contexte', async () => {
    const { rows } = await as<{ verdict: string; titulaire: string }>(
      null,
      `SELECT verdict, titulaire FROM verifier_certificat('SAB-2026-PR1042-KX7')`,
    );
    expect(rows[0]).toMatchObject({ verdict: 'vert', titulaire: 'Mamadou Diallo' });
  });
});

// Règles de construction vérifiées à chaque pipeline : un récit qui ajoute une table à
// zone, une fonction SECURITY DEFINER ou une vue doit tenir ces règles.
describe('Garde-fous du schéma', () => {
  // Tables qui portent une zone sans être encore cloisonnées : chacune le sera avec son
  // récit. Retirer la ligne quand le RLS est activé (le test l'exige).
  const notYetPartitioned: Record<string, string> = {
    abonnement: 'US-141 (GOLD)',
    alerte_territoriale: 'US-102',
    attestation: 'US-143 (formation)',
    certificat: 'US-045 (lecture publique par verifier_certificat)',
    demande_plante: 'US-121',
    forum_discussion: 'US-122',
    litige: 'US-101',
    produit: 'US-142',
    signalement_sanitaire: 'US-100',
    // Référentiel public des sous-préfectures, pas une donnée de zone
    sous_prefecture: 'aucun : référentiel public',
    // Lu par contexte_ouvrir ; gestion réservée à la DG (US-012), garde de l'API
    utilisateur: 'aucun : comptes gérés par la seule DG',
  };

  it('toute table qui porte une zone est cloisonnée, sauf celles listées avec leur récit', async () => {
    const { rows } = await owner.query<{ table: string; rls: boolean }>(
      `SELECT DISTINCT c.relname AS table, c.relrowsecurity AS rls
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'sabou'
         JOIN pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped
        WHERE c.relkind = 'r'
          AND a.attname IN ('prefecture_id', 'praticien_id', 'dossier_id', 'saisie_id')
        ORDER BY 1`,
    );
    const missing = rows
      .filter((r) => !r.rls && !(r.table in notYetPartitioned))
      .map((r) => r.table);
    const stale = rows.filter((r) => r.rls && r.table in notYetPartitioned).map((r) => r.table);
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  it('toute fonction SECURITY DEFINER fixe son search_path (pg_temp en dernier) et n’est pas ouverte à tous', async () => {
    const { rows } = await owner.query<{ name: string; config: string[] | null; public: boolean }>(
      `SELECT p.proname AS name, p.proconfig AS config,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'sabou'
        WHERE p.prosecdef ORDER BY 1`,
    );
    expect(rows.map((r) => r.name)).toEqual([
      // US-064 : annotations du seul Comité, jamais modifiées (05 §2.54)
      'annotation_ajouter',
      // US-049 : échéances des certificats, toutes zones, réservée à l'API (05 §2.37)
      'certificats_echeances_traiter',
      'contexte_ouvrir',
      // US-052 : fiches maladies, même règle que les fiches plantes (05 §2.42)
      'maladie_creer',
      'maladie_modifier',
      // US-050 : fiches plantes écrites seulement par ces fonctions (rôle vérifié, journal
      // d'audit), l'API n'écrit plus en direct dans plante et plante_image (05 §2.40)
      'plante_creer',
      'plante_image_ajouter',
      'plante_image_modifier',
      'plante_image_retirer',
      'plante_modifier',
      // US-053 : noms locaux, réservés au référent de la langue (05 §2.44)
      'plante_nom_local_ajouter',
      'plante_nom_local_principal',
      'plante_nom_local_retirer',
      // US-054 : proposition d'une plante par un praticien, auteur enregistré (05 §2.66)
      'plante_proposer',
      // US-051 : validation par le seul Comité (05 §2.41)
      'plante_valider',
      // US-040d : lecture de la désignation pour la règle de praticien, sans récursion (05 §2.71)
      'praticien_verificateur_designe',
      // US-022 : un redécoupage déplace des lignes de toutes les zones, DG seule (05 §2.59)
      'redecoupage_apercu',
      'redecoupage_appliquer',
      'redecoupage_controler',
      'saisie_terrain_recevoir',
      // US-060 : le praticien n'écrit ses traitements que par le Studio (05 §2.50)
      // US-063 : contre-indications du brouillon, par le Studio
      'traitement_contre_indications_poser',
      'traitement_enregistrer',
      'traitement_soumettre',
      // US-047 : un traitement d'un praticien rejeté ne progresse plus, quelle que soit la zone
      // de l'acteur (05 §2.36)
      'trg_recette_praticien_rejete',
      'trg_temoignage_notes',
      'verifier_certificat',
      // US-041 : rappels de visite, toutes zones, réservée à l'API (05 §2.33)
      'visite_rappels_mettre_en_file',
      // US-070 : dépôt et file de traitement des voix (05 §2.43)
      'voix_deposer',
      'voix_depot_echouer',
      'voix_depot_etat',
      'voix_depot_terminer',
      'voix_depots_prendre',
      // US-071 : statuts de la voix des noms, droits par langue contrôlés en base (05 §2.47)
      'voix_nom_enregistrer',
      'voix_nom_statut',
    ]);
    const unsafe = rows.filter(
      (r) =>
        !r.config?.some((c) => /^search_path=.*pg_temp$/.test(c)) ||
        (r.public && r.name !== 'verifier_certificat'),
    );
    expect(unsafe.map((r) => r.name)).toEqual([]);
  });

  it('seules les vues publiques s’exécutent avec les droits du propriétaire', async () => {
    const { rows } = await owner.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'sabou'
        WHERE c.relkind = 'v'
          AND NOT coalesce('security_invoker=true' = ANY (c.reloptions), false)
        ORDER BY 1`,
    );
    expect(rows.map((r) => r.name)).toEqual([
      'v_annuaire_public',
      'v_couverture_langue',
      'v_temoignage_public',
    ]);
  });
});
