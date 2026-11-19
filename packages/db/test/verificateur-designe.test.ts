// US-040d : l'administrateur régional désigne l'agent qui vérifie un dossier terrain quand
// la préfecture n'a qu'un agent (décision du maître d'œuvre du 19/11, 05 §2.71).
// Exécuté sous le rôle de l'API (sabou_app), dans le contexte de chaque compte ; chaque cas
// part du même état (transaction annulée).
// Critère 1 : le régional désigne, pour un dossier terrain de sa région, un agent
//             préfectoral actif de sa région autre que l'auteur ; la désignation est journalisée.
// Critère 2 : l'agent désigné voit ce seul dossier (praticien, pièces, visites, historique)
//             et le vérifie à l'étape 2 ; il ne voit rien d'autre de cette préfecture.
// Critère 3 : une fois un agent désigné, lui seul vérifie le dossier ; l'auteur reste refusé.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSeededDatabase,
  inRolledBackTransaction,
  lastRows,
  openContext,
  type TestDatabase,
} from './helpers.ts';

let db: TestDatabase;
const attempt = (sql: string) =>
  inRolledBackTransaction(db.url.app, `SET LOCAL search_path = sabou, public; ${sql}`);
const rows = (sql: string) => lastRows(db.url.app, `SET LOCAL search_path = sabou, public; ${sql}`);

const AUTHOR = 'prefectoral.labe@sabou-sante.gn';
const REGIONAL = 'regional.labe@sabou-sante.gn';
const KEYCLOAK_ID = '51515151-5151-4051-8051-515151515151';
// Agent préfectoral d'une autre préfecture de la région de Labé (créé par chaque cas)
const OTHER_AGENT_ID = '71717171-7171-4071-8071-717171717171';
// Second agent de la préfecture de Labé
const SAME_PREF_AGENT_ID = '72727272-7272-4072-8072-727272727272';

const dossier = `(SELECT d.id FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id
                    JOIN utilisateur u ON u.id = p.utilisateur_id WHERE u.keycloak_id = '${KEYCLOAK_ID}')`;
const code = `(SELECT code FROM dossier_certification WHERE id = ${dossier})`;
const otherAgent = `(SELECT id FROM utilisateur WHERE keycloak_id = '${OTHER_AGENT_ID}')`;

const piece = (type: string) => `
  INSERT INTO dossier_piece (dossier_id, type, fichier_url, sha256, depose_par, type_mime, taille_octets)
  VALUES (${dossier}, '${type}', 'pieces/test/${type}', repeat('a', 64), contexte_utilisateur(),
          'image/jpeg', 1000);`;

const agents = `
  INSERT INTO utilisateur (email, telephone, prenom, nom, role_code, statut, keycloak_id, prefecture_id)
  VALUES ('prefectoral.voisin@exemple.test', '+224661230001', 'Oumar', 'Baldé', 'prefectoral', 'actif',
          '${OTHER_AGENT_ID}',
          (SELECT id FROM prefecture WHERE region_admin_id = 4 AND id <> 4 ORDER BY id LIMIT 1)),
         ('prefectoral.second@exemple.test', '+224661230002', 'Fatoumata', 'Bah', 'prefectoral', 'actif',
          '${SAME_PREF_AGENT_ID}', 4);`;

// Dossier terrain de Labé, soumis : il attend la vérification de l'étape 2
const atStep2 = `${agents} ${openContext(AUTHOR)}
  SELECT * FROM dossier_terrain_ouvrir('${KEYCLOAK_ID}', '+224661230003', 'Saliou', 'Diallo',
                                       1::smallint, NULL::smallint, 'pul', 15::smallint);
  ${piece('identite')} ${piece('photo')}
  SELECT dossier_transition(${dossier}, 'soumis', contexte_utilisateur());`;

const designate = (agent = otherAgent, account = REGIONAL) => `${openContext(account)}
  SELECT dossier_verificateur_designer(${code}, ${agent});`;

const asOther = `SELECT contexte_ouvrir('${OTHER_AGENT_ID}');`;
const decide = (decision: string) =>
  `SELECT dossier_transition(${dossier}, '${decision}', contexte_utilisateur(), 'motif du test');`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 1 : le régional désigne un agent de sa région, journalisé', () => {
  it('désignation enregistrée, datée et journalisée', async () => {
    const [row] = await rows(`${atStep2} ${designate()}
      SELECT d.verificateur_designe = ${otherAgent} AS designe, d.verificateur_designe_le IS NOT NULL AS date,
             (SELECT count(*)::int FROM journal_audit a
               WHERE a.action = 'dossier.verificateur_designe' AND a.objet_id = d.code
                 AND a.utilisateur_id = contexte_utilisateur()
                 AND (a.details->>'agent')::bigint = ${otherAgent}) AS journal
        FROM dossier_certification d WHERE d.id = ${dossier}`);
    expect(row).toEqual({ designe: true, date: true, journal: 1 });
  });

  it('refusée à tout autre profil, et au régional d’une autre région (dossier introuvable)', async () => {
    for (const account of [AUTHOR, 'dg@sabou-sante.gn', 's.kourouma@exemple.gn']) {
      await expect(
        attempt(`${atStep2} ${designate(otherAgent, account)}`),
        account,
      ).rejects.toThrow(/réservée à l'administrateur régional|introuvable/);
    }
    await expect(
      attempt(`${atStep2} ${designate(otherAgent, 'regional.kankan@sabou-sante.gn')}`),
    ).rejects.toThrow(/introuvable/);
  });

  it('l’auteur, un agent hors de la région, suspendu ou d’un autre rôle ne sont pas désignables', async () => {
    const candidates = [
      `(SELECT id FROM utilisateur WHERE email = '${AUTHOR}')`,
      `(SELECT id FROM utilisateur WHERE email = 'prefectoral.kankan@sabou-sante.gn')`,
      `(SELECT id FROM utilisateur WHERE email = 'regional.labe@sabou-sante.gn')`,
    ];
    for (const candidate of candidates) {
      await expect(attempt(`${atStep2} ${designate(candidate)}`), candidate).rejects.toThrow(
        /Agent non désignable/,
      );
    }
    await expect(
      attempt(`${atStep2} UPDATE utilisateur SET statut = 'suspendu' WHERE id = ${otherAgent};
               ${designate()}`),
    ).rejects.toThrow(/Agent non désignable/);
  });

  it('seulement pour un dossier terrain', async () => {
    // Dossier ouvert par un praticien lui-même (jeu d'exemple, région de Labé)
    await expect(
      attempt(`${agents} ${openContext(REGIONAL)}
        SELECT dossier_verificateur_designer(
          (SELECT d.code FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id
            JOIN prefecture pf ON pf.id = p.prefecture_id
           WHERE pf.region_admin_id = 4 AND d.cree_par IS NULL ORDER BY d.id LIMIT 1), ${otherAgent});`),
    ).rejects.toThrow(/dossiers terrain/);
  });

  it('la colonne ne s’écrit pas en direct, sauf par le régional et avec les mêmes contrôles', async () => {
    await expect(
      attempt(`${atStep2} UPDATE dossier_certification SET verificateur_designe = ${otherAgent}
                WHERE id = ${dossier};`),
    ).rejects.toThrow(/réservée à l'administrateur régional/);
  });
});

describe('Critère 2 : l’agent désigné voit ce seul dossier et le vérifie', () => {
  it('avant la désignation, l’agent d’une autre préfecture ne voit rien', async () => {
    const [row] = await rows(`${atStep2} ${asOther}
      SELECT (SELECT count(*)::int FROM dossier_certification WHERE id = ${dossier}) AS dossiers`);
    expect(row).toEqual({ dossiers: 0 });
  });

  it('après : praticien, dossier, pièces et historique ; rien d’autre de la préfecture', async () => {
    const [row] = await rows(`${atStep2} ${designate()} ${asOther}
      SELECT (SELECT count(*)::int FROM praticien WHERE prefecture_id = 4) AS praticiens,
             (SELECT count(*)::int FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id
               WHERE p.prefecture_id = 4) AS dossiers,
             (SELECT count(*)::int FROM dossier_piece WHERE dossier_id = ${dossier}) AS pieces,
             (SELECT count(*)::int FROM dossier_historique WHERE dossier_id = ${dossier}) AS historique`);
    expect(row).toEqual({ praticiens: 1, dossiers: 1, pieces: 2, historique: 1 });
  });

  it('il renvoie le dossier à l’étape 1', async () => {
    const [row] = await rows(`${atStep2} ${designate()} ${asOther} ${decide('rejete')}
      SELECT etape_courante FROM dossier_certification WHERE id = ${dossier}`);
    expect(row).toEqual({ etape_courante: 1 });
  });

  it('il est habilité à valider : seule la visite signée manque (R-CER-06)', async () => {
    await expect(
      attempt(`${atStep2} ${designate()} ${asOther} ${decide('valide')}`),
    ).rejects.toThrow(/visite terrain signée requise/);
  });

  it('il ne modifie pas la fiche du praticien', async () => {
    await expect(
      attempt(`${atStep2} ${designate()} ${asOther}
        UPDATE praticien SET annees_experience = 1
         WHERE id = (SELECT praticien_id FROM dossier_certification WHERE id = ${dossier});`),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('Critère 3 : une fois désigné, lui seul vérifie ; l’auteur reste refusé', () => {
  it('l’autre agent de la préfecture et l’auteur sont refusés', async () => {
    for (const actor of [`SELECT contexte_ouvrir('${SAME_PREF_AGENT_ID}');`, openContext(AUTHOR)]) {
      await expect(
        attempt(`${atStep2} ${designate()} ${actor} ${decide('rejete')}`),
      ).rejects.toThrow(/non habilité/);
    }
  });

  it('sans désignation, l’autre agent de la préfecture vérifie toujours (US-040c)', async () => {
    const [row] = await rows(`${atStep2} SELECT contexte_ouvrir('${SAME_PREF_AGENT_ID}');
      ${decide('rejete')}
      SELECT etape_courante FROM dossier_certification WHERE id = ${dossier}`);
    expect(row).toEqual({ etape_courante: 1 });
  });
});
