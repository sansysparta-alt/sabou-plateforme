// US-040c : dossier terrain créé par l'Admin Préfectoral pour un praticien sans smartphone.
// Exécuté sous le rôle de l'API (sabou_app), dans le contexte de chaque compte du jeu
// d'exemple ; chaque cas part du même état (transaction annulée).
// Critère 1 : identité, téléphone, spécialité, préfecture de l'agent, pièces ; le dossier
//             entre dans le circuit habituel.
// Critère 2 : le dossier mentionne qu'il a été créé par l'agent ; le praticien reçoit un SMS
//             (file de notifications ; journal d'audit : test de l'API).
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSeededDatabase,
  inRolledBackTransaction,
  lastRows,
  openContext,
  type TestDatabase,
} from './helpers.ts';

let db: TestDatabase;
const attempt = (sql: string) => inRolledBackTransaction(db.url.app, sql);
const rows = (sql: string) => lastRows(db.url.app, `SET LOCAL search_path = sabou, public; ${sql}`);

const LABE = 'prefectoral.labe@sabou-sante.gn';
const KANKAN = 'prefectoral.kankan@sabou-sante.gn';
const KEYCLOAK_ID = '50505050-5050-4050-8050-505050505050';

const open = (agent = LABE, phone = '+224661234567') => `${openContext(agent)}
  SELECT * FROM dossier_terrain_ouvrir('${KEYCLOAK_ID}', '${phone}', 'Mamadou', 'Barry',
                                       1::smallint, NULL::smallint, 'pul', 20::smallint);`;

const fieldDossier = `(SELECT d.id FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id
                         JOIN utilisateur u ON u.id = p.utilisateur_id
                        WHERE u.keycloak_id = '${KEYCLOAK_ID}')`;

const piece = (type: string, dossier = fieldDossier) => `
  INSERT INTO dossier_piece (dossier_id, type, fichier_url, sha256, depose_par, type_mime, taille_octets)
  VALUES (${dossier}, '${type}', 'pieces/test/${type}', repeat('a', 64), contexte_utilisateur(),
          'image/jpeg', 1000);`;

// Praticien de Labé qui ouvre lui-même sa fiche et son dossier (US-040a)
const PRACTITIONER_ID = '60606060-6060-4060-8060-606060606060';
const practitioner = `
  INSERT INTO utilisateur (telephone, prenom, nom, role_code, statut, keycloak_id)
  VALUES ('+224661234568', 'Aïssatou', 'Diallo', 'praticien', 'actif', '${PRACTITIONER_ID}');
  SELECT contexte_ouvrir('${PRACTITIONER_ID}');
  INSERT INTO praticien (utilisateur_id, specialite_id, prefecture_id, langue_principale, annees_experience)
  VALUES (contexte_utilisateur(), 1, 4, 'pul', 10);`;
const ownDossier = `${practitioner}
  INSERT INTO dossier_certification (praticien_id)
  SELECT id FROM praticien WHERE utilisateur_id = contexte_utilisateur();`;

const fieldCode = `(SELECT code FROM dossier_certification WHERE id = ${fieldDossier})`;

const submit = `SELECT dossier_transition(${fieldDossier}, 'soumis', contexte_utilisateur());`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère 1 : l’agent préfectoral crée le compte, la fiche et le dossier', () => {
  it('fiche dans la préfecture de l’agent, dossier initial à l’étape 1, créé par l’agent', async () => {
    const [row] = await rows(`${open()}
      SELECT u.role_code, u.telephone, u.prenom, u.nom, p.prefecture_id, p.specialite_id,
             d.etape_courante, d.type, d.statut, a.email AS auteur
        FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id
        JOIN utilisateur u ON u.id = p.utilisateur_id JOIN utilisateur a ON a.id = d.cree_par
       WHERE d.id = ${fieldDossier}`);
    expect(row).toEqual({
      role_code: 'praticien',
      telephone: '+224661234567',
      prenom: 'Mamadou',
      nom: 'Barry',
      prefecture_id: 4,
      specialite_id: 1,
      etape_courante: 1,
      type: 'initial',
      statut: 'en_cours',
      auteur: LABE,
    });
  });

  it('refusé à tout autre profil que le préfectoral', async () => {
    for (const account of [
      'dg@sabou-sante.gn',
      'regional.kindia@sabou-sante.gn',
      's.kourouma@exemple.gn',
    ]) {
      await expect(attempt(open(account)), account).rejects.toThrow(
        "Dossier terrain réservé à l'agent préfectoral",
      );
    }
  });

  it('refuse un numéro qui a déjà un compte du domaine public', async () => {
    const [{ telephone }] = (await rows(`SELECT telephone FROM utilisateur
      WHERE role_code = 'praticien' ORDER BY id LIMIT 1`)) as { telephone: string }[];
    await expect(attempt(open(LABE, telephone))).rejects.toThrow('ux_utilisateur_telephone_public');
  });

  it('l’agent dépose les pièces et soumet : le dossier passe à l’étape 2 de sa préfecture', async () => {
    const [row] = await rows(`${open()} ${piece('identite')} ${piece('photo')} ${submit}
      SELECT etape_courante FROM dossier_certification WHERE id = ${fieldDossier}`);
    expect(row).toEqual({ etape_courante: 2 });
  });

  it('la soumission exige les pièces obligatoires', async () => {
    await expect(attempt(`${open()} ${piece('identite')} ${submit}`)).rejects.toThrow(/photo/);
  });

  it('suite du circuit : l’agent de la préfecture vérifie à l’étape 2 comme tout dossier', async () => {
    const [row] = await rows(`${open()} ${piece('identite')} ${piece('photo')} ${submit}
      SELECT count(*)::int AS dossiers FROM dossier_certification
       WHERE id = ${fieldDossier} AND etape_courante = 2 AND cree_par IS NOT NULL`);
    expect(row).toEqual({ dossiers: 1 });
  });
});

describe('Seul l’agent auteur agit sur le dossier terrain à l’étape 1', () => {
  it('un autre préfectoral ne voit ni ne touche le dossier (autre préfecture)', async () => {
    await expect(
      attempt(`${open()} ${piece('identite')} ${piece('photo')}
               ${openContext(KANKAN)} ${submit}`),
    ).rejects.toThrow();
    const [row] = await rows(`${open()} ${openContext(KANKAN)}
      SELECT count(*)::int AS visibles FROM dossier_certification WHERE cree_par IS NOT NULL`);
    expect(row).toEqual({ visibles: 0 });
  });

  it('l’agent ne dépose pas de pièce dans le dossier qu’un praticien a ouvert lui-même', async () => {
    const own = `(SELECT d.id FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id
                   JOIN utilisateur u ON u.id = p.utilisateur_id
                  WHERE u.keycloak_id = '${PRACTITIONER_ID}')`;
    await expect(
      attempt(`${ownDossier} ${openContext(LABE)} ${piece('identite', own)}`),
    ).rejects.toThrow('seul l');
  });

  it('l’auteur d’un dossier terrain ne se modifie pas', async () => {
    await expect(
      attempt(`${open()}
        UPDATE dossier_certification SET cree_par = NULL WHERE id = ${fieldDossier};`),
    ).rejects.toThrow("L'auteur d'un dossier terrain ne change pas");
  });

  it('l’agent ne dépose pas le compte rendu de visite à l’étape 1', async () => {
    await expect(attempt(`${open()} ${piece('compte_rendu')}`)).rejects.toThrow('seul l');
  });

  it('un dossier « créé par l’agent » ne se forge pas : ni par un praticien, ni pour un autre agent', async () => {
    await expect(
      attempt(`${practitioner}
        INSERT INTO dossier_certification (praticien_id, cree_par)
        SELECT id, (SELECT id FROM utilisateur WHERE email = '${LABE}')
          FROM praticien WHERE utilisateur_id = contexte_utilisateur();`),
    ).rejects.toThrow('Un dossier terrain est créé par l');
    await expect(
      attempt(`${openContext(LABE)}
        INSERT INTO dossier_certification (praticien_id, cree_par)
        SELECT p.id, (SELECT id FROM utilisateur WHERE email = '${KANKAN}')
          FROM praticien p WHERE p.prefecture_id = 4 LIMIT 1;`),
    ).rejects.toThrow('Un dossier terrain est créé par l');
  });
});

describe('Critère 2 : mention de l’agent et SMS au praticien', () => {
  it('le SMS d’invitation est mis en file pour le praticien, à la création', async () => {
    const [row] = await rows(`${open()}
      SELECT n.canal, n.modele, n.objet_type, u.telephone
        FROM notification n JOIN utilisateur u ON u.id = n.destinataire_id
       WHERE n.objet_id = ${fieldCode} AND n.modele = 'dossier.terrain_cree'`);
    expect(row).toEqual({
      canal: 'sms',
      modele: 'dossier.terrain_cree',
      objet_type: 'dossier',
      telephone: '+224661234567',
    });
  });

  it('la soumission par l’agent est historisée à son nom et prévient le praticien', async () => {
    const [row] = await rows(`${open()} ${piece('identite')} ${piece('photo')} ${submit}
      SELECT a.email AS acteur,
             (SELECT count(*)::int FROM notification n
               WHERE n.objet_id = ${fieldCode} AND n.modele = 'dossier.soumis') AS sms
        FROM dossier_historique h JOIN utilisateur a ON a.id = h.acteur_id
       WHERE h.dossier_id = ${fieldDossier} ORDER BY h.id DESC LIMIT 1`);
    expect(row).toEqual({ acteur: LABE, sms: 1 });
  });
});
