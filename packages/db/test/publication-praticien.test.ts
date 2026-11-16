// US-046 : à l'étape 6, la publication du praticien est automatique (UC-70, R-CER-01,
// R-REC-08, R-REC-11). Elle s'exécute dans la transaction de l'approbation par la DG.
// Exécuté sous le rôle de l'API (sabou_app), dans le contexte de chaque acteur, sur le jeu
// d'exemple ; chaque cas part du même état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSeededDatabase,
  inRolledBackTransaction,
  lastRows as rowsAt,
  openContext,
  type TestDatabase,
} from './helpers.ts';

let db: TestDatabase;
// Rôle de l'API ; les traitements d'essai sont préparés par le super-utilisateur (owner), le
// praticien et l'API n'écrivant pas le contenu d'un traitement en direct (US-060)
const attempt = (sql: string) =>
  inRolledBackTransaction(db.url.postgres, `SET LOCAL ROLE sabou_app; ${sql}`);
const lastRows = (sql: string) => rowsAt(db.url.postgres, `SET LOCAL ROLE sabou_app; ${sql}`);
const owner = (sql: string) => `RESET ROLE; ${sql} SET LOCAL ROLE sabou_app;`;

const DG = 'dg@sabou-sante.gn';

// Traitements joints au dossier DS-1041 (PR-1041, formule gratuite), expertisés à l'étape 4 :
// plante validée (Néré), sections obligatoires et cycle renseignés. Un traitement non joint
// et un traitement joint mais encore « transmis » servent de témoins.
const joinRecipes = (count: number, praticien = '1', dossier = '1') =>
  owner(`
  INSERT INTO recette (code, praticien_id, maladie_id, titre_fr, cycle_duree_jours,
                       cycle_prises_par_jour, dossier_id)
  SELECT 'REC-90' || lpad(g::text, 2, '0'), ${praticien}, 1, 'Essai ' || g, 3, 2, ${dossier}
    FROM generate_series(1, ${count}) g
  UNION ALL SELECT 'REC-9090', ${praticien}, 1, 'Non joint', 3, 2, NULL
  UNION ALL SELECT 'REC-9091', ${praticien}, 1, 'Encore à l''expertise', 3, 2, ${dossier};
  INSERT INTO recette_plante (recette_id, plante_id, ordre, partie_utilisee)
  SELECT id, 3, 1, 'gousses' FROM recette WHERE code LIKE 'REC-90%';
  INSERT INTO recette_section (recette_id, type_code, texte_fr)
  SELECT r.id, t.code, 'Essai' FROM recette r CROSS JOIN section_type t
   WHERE r.code LIKE 'REC-90%' AND t.obligatoire;
  UPDATE recette SET statut = 'expertisee' WHERE code LIKE 'REC-90%' AND code <> 'REC-9091';
  UPDATE recette SET statut = 'transmise' WHERE code = 'REC-9091';`);

// DS-1041 suit les étapes 1 à 4 puis la DG approuve avec un certificat de forme valide
const approved = `${openContext('s.kourouma@exemple.gn')}
  SELECT dossier_transition(1, 'soumis', contexte_utilisateur());
  ${openContext('prefectoral.labe@sabou-sante.gn')}
  SELECT visite_realiser(1, contexte_utilisateur(), vt.id, current_date, 'Lieu conforme.',
                         'favorable', repeat('b', 64))
    FROM visite_terrain vt WHERE vt.dossier_id = 1 AND vt.statut = 'planifiee';
  SELECT dossier_transition(1, 'valide', contexte_utilisateur());
  ${openContext('regional.labe@sabou-sante.gn')}
  SELECT dossier_transition(1, 'valide', contexte_utilisateur());
  ${openContext('comite@sabou-sante.gn')}
  SELECT dossier_transition(1, 'valide', contexte_utilisateur());
  ${openContext(DG)}
  SELECT certificat_emettre(1, contexte_utilisateur(), p.numero, p.emis_le, p.expire_le,
                            '${'d'.repeat(64)}', 'c2lnbmF0dXJl', 'dg-0a1b2c3d',
                            'uJK0ULaCKFo8CWZMA56e05Df5nq8-N-px4dnGxsiI4w', 'SB1:EXEMPLE')
    FROM certificat_preparer(1, contexte_utilisateur()) p;`;

const recipes = `SELECT code, statut FROM recette WHERE code LIKE 'REC-90%' ORDER BY code;`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : certificat actif ⇒ praticien « certifié », traitements expertisés joints « certifiés »', () => {
  it('le praticien passe « certifié » et le dossier « approuvé », à l’étape 6', async () => {
    const rows = await lastRows(`${joinRecipes(2)} ${approved}
      SELECT p.statut AS praticien, d.statut AS dossier, d.etape_courante AS etape,
             d.cloture_le IS NOT NULL AS clos, c.statut AS certificat
        FROM praticien p JOIN dossier_certification d ON d.praticien_id = p.id
        JOIN certificat c ON c.dossier_id = d.id WHERE d.id = 1;`);
    expect(rows).toEqual([
      { praticien: 'certifie', dossier: 'approuve', etape: 6, clos: true, certificat: 'actif' },
    ]);
  });

  it('seuls les traitements expertisés joints au dossier passent « certifiés »', async () => {
    const rows = await lastRows(`${joinRecipes(2)} ${approved} ${recipes}`);
    expect(rows).toEqual([
      { code: 'REC-9001', statut: 'certifiee' },
      { code: 'REC-9002', statut: 'certifiee' },
      { code: 'REC-9090', statut: 'expertisee' },
      { code: 'REC-9091', statut: 'transmise' },
    ]);
  });

  it('le praticien apparaît dans l’annuaire : certifié avec un certificat actif (R-CER-08)', async () => {
    const rows = await lastRows(`${joinRecipes(1)} ${approved}
      SELECT count(*)::int AS visibles FROM praticien p
        JOIN certificat c ON c.praticien_id = p.id
       WHERE p.code = 'PR-1041' AND p.statut = 'certifie'
         AND c.statut = 'actif' AND c.expire_le >= current_date;`);
    expect(rows).toEqual([{ visibles: 1 }]);
  });

  it('trace la publication : historique, un seul SMS, journal d’audit (R-CER-05)', async () => {
    const rows = await lastRows(`${joinRecipes(1)} ${approved}
      SELECT (SELECT string_agg(row(etape_depart, etape_arrivee, decision)::text, ',' ORDER BY id)
                FROM dossier_historique WHERE dossier_id = 1 AND etape_arrivee = 6) AS historique,
             (SELECT string_agg(modele, ',' ORDER BY id) FROM notification
                WHERE objet_id = 'DS-1041' AND (parametres->>'etape')::int = 6) AS sms,
             (SELECT string_agg(action || ' ' || objet_id || ' ' || (details->>'automatique'),
                                ',' ORDER BY id) FROM journal_audit
                WHERE action IN ('dossier.publie', 'recette.certifiee')
                  AND (objet_id = 'DS-1041' OR objet_id LIKE 'REC-90%')) AS audit,
             (SELECT string_agg(row(statut_depart, statut_arrivee)::text || ' ' || u.email, ',')
                FROM recette_historique h JOIN recette r ON r.id = h.recette_id
                JOIN utilisateur u ON u.id = h.acteur_id
               WHERE r.code = 'REC-9001') AS recette;`);
    expect(rows).toEqual([
      {
        historique: '(5,6,valide),(6,6,publie)',
        sms: 'dossier.publie',
        // Demande du maître d'œuvre (13 novembre 2026) : publication marquée automatique
        audit: 'recette.certifiee REC-9001 true,dossier.publie DS-1041 true',
        recette: `(expertisee,certifiee) ${DG}`,
      },
    ]);
  });
});

describe('Un traitement qui ne peut pas être certifié attend, sans bloquer la publication', () => {
  it('formule gratuite : 3 traitements certifiés, le 4e reste « expertisé » (R-REC-11)', async () => {
    const rows = await lastRows(`${joinRecipes(4)} ${approved}
      SELECT r.code, r.statut, r.attente_raison,
             (SELECT j.details->>'raison' || ' : ' || (j.details->>'motif')
                                  FROM journal_audit j
                                 WHERE j.action = 'recette.certification_differee'
                                   AND j.objet_id = r.code) AS motif
        FROM recette r WHERE r.code BETWEEN 'REC-9001' AND 'REC-9004' ORDER BY r.code;`);
    expect(rows).toEqual([
      { code: 'REC-9001', statut: 'certifiee', attente_raison: null, motif: null },
      { code: 'REC-9002', statut: 'certifiee', attente_raison: null, motif: null },
      { code: 'REC-9003', statut: 'certifiee', attente_raison: null, motif: null },
      {
        code: 'REC-9004',
        statut: 'expertisee',
        attente_raison: 'quota',
        motif:
          'quota : Traitement REC-9004 : la formule gratuite est limitée à 3 traitements certifiés',
      },
    ]);
  });

  it('la raison de l’attente, lue par le Studio, s’efface au passage en GOLD (US-060, US-141)', async () => {
    const rows = await lastRows(`${joinRecipes(4)} ${approved}
      INSERT INTO abonnement (praticien_id, formule, debut, montant_gnf)
      VALUES (1, 'gold', current_date, 15000);
      UPDATE recette SET statut = 'certifiee' WHERE code = 'REC-9004';
      SELECT statut, attente_raison FROM recette WHERE code = 'REC-9004';`);
    expect(rows).toEqual([{ statut: 'certifiee', attente_raison: null }]);
  });

  it('une raison d’attente sur un traitement qui n’est pas « expertisé » : refusée', async () => {
    await expect(
      attempt(
        owner(`UPDATE recette SET attente_raison = 'quota'
                WHERE id = (SELECT min(id) FROM recette WHERE statut <> 'expertisee');`),
      ),
    ).rejects.toThrow(/ck_recette_attente_expertisee/);
  });

  it('règle de choix : les 3 plus anciens par création, quel que soit leur code (§2.35)', async () => {
    // REC-9000 est créé après REC-9001 à 9003 : c'est lui qui attend
    const rows = await lastRows(`${joinRecipes(3)} RESET ROLE;
      INSERT INTO recette (code, praticien_id, maladie_id, titre_fr, cycle_duree_jours,
                           cycle_prises_par_jour, dossier_id)
      VALUES ('REC-9000', 1, 1, 'Créé en dernier', 3, 2, 1);
      INSERT INTO recette_plante (recette_id, plante_id, ordre, partie_utilisee)
      SELECT id, 3, 1, 'gousses' FROM recette WHERE code = 'REC-9000';
      INSERT INTO recette_section (recette_id, type_code, texte_fr)
      SELECT r.id, t.code, 'Essai' FROM recette r CROSS JOIN section_type t
       WHERE r.code = 'REC-9000' AND t.obligatoire;
      UPDATE recette SET statut = 'expertisee' WHERE code = 'REC-9000';
      SET LOCAL ROLE sabou_app;
      ${approved}
      SELECT string_agg(code, ',' ORDER BY code) AS attente FROM recette
       WHERE code BETWEEN 'REC-9000' AND 'REC-9003' AND statut = 'expertisee';`);
    expect(rows).toEqual([{ attente: 'REC-9000' }]);
  });

  it('règle de choix : le quota compte les traitements déjà certifiés (renouvellement)', async () => {
    // PR-1044 (formule gratuite) a déjà REC-2044 certifié : 2 places pour 3 traitements joints
    const renewal = `(SELECT id FROM dossier_certification WHERE praticien_id = 4 AND statut = 'en_cours')`;
    const rows = await lastRows(`${openContext(DG)}
      INSERT INTO dossier_certification (praticien_id, type, visite_requise, etape_courante)
      VALUES (4, 'renouvellement', false, 5);
      ${joinRecipes(3, '4', renewal)}
      SELECT certificat_emettre(${renewal}, contexte_utilisateur(), p.numero, p.emis_le,
                                p.expire_le, '${'d'.repeat(64)}', 'c2lnbmF0dXJl', 'dg-0a1b2c3d',
                                'uJK0ULaCKFo8CWZMA56e05Df5nq8-N-px4dnGxsiI4w', 'SB1:EXEMPLE')
        FROM certificat_preparer(${renewal}, contexte_utilisateur()) p;
      SELECT string_agg(code || ' ' || statut, ',' ORDER BY code) AS traitements FROM recette
       WHERE code BETWEEN 'REC-9001' AND 'REC-9003';`);
    expect(rows).toEqual([
      { traitements: 'REC-9001 certifiee,REC-9002 certifiee,REC-9003 expertisee' },
    ]);
  });

  it('le praticien est informé par SMS : nombre et raison (quota)', async () => {
    const rows = await lastRows(`${joinRecipes(4)} ${approved}
      SELECT modele, parametres FROM notification
       WHERE objet_id = 'DS-1041' AND (parametres->>'etape')::int = 6 ORDER BY id;`);
    expect(rows).toEqual([
      { modele: 'dossier.publie', parametres: { etape: 6 } },
      { modele: 'dossier.traitements_en_attente', parametres: { etape: 6, quota: 1, contenu: 0 } },
    ]);
  });

  it('plante non validée par le Comité : ce traitement attend, les autres sont certifiés (R-REC-06)', async () => {
    const rows = await lastRows(`${joinRecipes(2)}
      ${owner(`UPDATE recette_plante SET plante_id = 5
       WHERE recette_id = (SELECT id FROM recette WHERE code = 'REC-9001');`)}
      ${approved}
      SELECT (SELECT statut FROM praticien WHERE id = 1) AS praticien,
             (SELECT string_agg(code || ' ' || statut, ',' ORDER BY code) FROM recette
               WHERE code IN ('REC-9001', 'REC-9002')) AS traitements,
             (SELECT details->>'raison' FROM journal_audit
               WHERE action = 'recette.certification_differee' AND objet_id = 'REC-9001') AS raison,
             (SELECT attente_raison FROM recette WHERE code = 'REC-9001') AS attente,
             (SELECT parametres FROM notification
               WHERE modele = 'dossier.traitements_en_attente' AND objet_id = 'DS-1041') AS sms;`);
    expect(rows).toEqual([
      {
        praticien: 'certifie',
        traitements: 'REC-9001 expertisee,REC-9002 certifiee',
        raison: 'contenu',
        attente: 'contenu',
        sms: { etape: 6, quota: 0, contenu: 1 },
      },
    ]);
  });

  it('dossier sans traitement joint : le praticien est publié', async () => {
    const rows = await lastRows(`${approved} SELECT statut FROM praticien WHERE id = 1;`);
    expect(rows).toEqual([{ statut: 'certifie' }]);
  });
});

describe('La publication ne se déclenche pas hors de l’étape 6', () => {
  it('publier un dossier encore à l’étape 1 : refusé', async () => {
    await expect(
      attempt(`${openContext(DG)} SELECT dossier_transition(1, 'publie', contexte_utilisateur());`),
    ).rejects.toThrow(/non habilité|impossible/);
  });

  it('un dossier déjà publié ne se publie pas deux fois', async () => {
    await expect(
      attempt(`${approved} SELECT dossier_transition(1, 'publie', contexte_utilisateur());`),
    ).rejects.toThrow(/clos \(approuve\)/);
  });
});
