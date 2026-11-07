// US-040a : le praticien crée sa fiche et son dossier, dépose ses pièces et soumet.
// Exécuté sous le rôle de l'API (sabou_app), dans le contexte du praticien, sur le jeu
// d'exemple ; chaque cas part du même état (transaction annulée).
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
      | pg.QueryResult
      | pg.QueryResult[];
    return (Array.isArray(results) ? results.at(-1)! : results).rows;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

const KEYCLOAK_ID = '40404040-4040-4040-8040-404040404040';

// Compte praticien tel que l'inscription le crée : numéro, prénom, nom ; ni e-mail ni zone
const newPractitionerAccount = (phone = '+224661234567') => `
  INSERT INTO utilisateur (telephone, prenom, nom, role_code, statut, keycloak_id)
  VALUES ('${phone}', 'Mariama', 'Soumah', 'praticien', 'actif', '${KEYCLOAK_ID}');
  SELECT contexte_ouvrir('${KEYCLOAK_ID}');`;

// Fiche et dossier ouverts par le praticien lui-même
const withDossier = `${newPractitionerAccount()}
  INSERT INTO praticien (utilisateur_id, specialite_id, prefecture_id, langue_principale, annees_experience)
  VALUES (contexte_utilisateur(), 1, 4, 'pul', 10);
  INSERT INTO dossier_certification (praticien_id)
  SELECT id FROM praticien WHERE utilisateur_id = contexte_utilisateur();`;

const piece = (type: string) => `
  INSERT INTO dossier_piece (dossier_id, type, fichier_url, sha256, depose_par, type_mime, taille_octets)
  SELECT d.id, '${type}', 'pieces/test/${type}', repeat('a', 64), contexte_utilisateur(), 'image/jpeg', 1000
    FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id
   WHERE p.utilisateur_id = contexte_utilisateur();`;

const submit = `
  SELECT dossier_transition(d.id, 'soumis', contexte_utilisateur())
    FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id
   WHERE p.utilisateur_id = contexte_utilisateur();`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Compte praticien', () => {
  it('accepte un praticien sans e-mail, avec son nom et son mobile', async () => {
    await expect(attempt(newPractitionerAccount())).resolves.toBeUndefined();
  });

  it('exige le nom du praticien (porté par le certificat)', async () => {
    await expect(
      attempt(`INSERT INTO utilisateur (telephone, prenom, role_code, statut, keycloak_id)
               VALUES ('+224661234567', 'Mariama', 'praticien', 'actif', '${KEYCLOAK_ID}')`),
    ).rejects.toThrow('ck_praticien');
  });

  it('refuse une zone d’administration pour un praticien', async () => {
    await expect(
      attempt(`INSERT INTO utilisateur (telephone, prenom, nom, role_code, prefecture_id, statut, keycloak_id)
               VALUES ('+224661234567', 'Mariama', 'Soumah', 'praticien', 4, 'actif', '${KEYCLOAK_ID}')`),
    ).rejects.toThrow('ck_praticien');
  });

  it('refuse un numéro déjà porté par un citoyen (un compte par numéro)', async () => {
    // +224620000011 : Aminata, citoyenne du jeu d'exemple
    await expect(attempt(newPractitionerAccount('+224620000011'))).rejects.toThrow(
      'ux_utilisateur_telephone_public',
    );
  });
});

describe('Fiche et dossier ouverts par le praticien', () => {
  it('attribue les codes et ouvre le dossier à l’étape 1', async () => {
    const rows = await lastRows(`${withDossier}
       SELECT p.code AS praticien, p.statut, d.code AS dossier, d.etape_courante
         FROM praticien p JOIN dossier_certification d ON d.praticien_id = p.id
        WHERE p.utilisateur_id = contexte_utilisateur()`);
    expect(rows[0]).toMatchObject({ statut: 'en_attente', etape_courante: 1 });
    expect(rows[0].praticien).toMatch(/^PR-\d{4,}$/);
    expect(rows[0].dossier).toMatch(/^DS-\d{4,}$/);
  });

  it('refuse une fiche créée « certifiée » par le praticien', async () => {
    await expect(
      attempt(`${newPractitionerAccount()}
        INSERT INTO praticien (utilisateur_id, specialite_id, prefecture_id, langue_principale, statut)
        VALUES (contexte_utilisateur(), 1, 4, 'pul', 'certifie')`),
    ).rejects.toThrow('Une nouvelle fiche de praticien est « en attente »');
  });

  it('refuse que le praticien change le statut de sa fiche', async () => {
    await expect(
      attempt(`${withDossier}
        UPDATE praticien SET statut = 'certifie' WHERE utilisateur_id = contexte_utilisateur()`),
    ).rejects.toThrow('Le praticien ne modifie pas le code, le statut');
  });

  it('laisse le praticien corriger sa localité (contrôle positif)', async () => {
    await expect(
      attempt(`${withDossier}
        UPDATE praticien SET prefecture_id = 3 WHERE utilisateur_id = contexte_utilisateur()`),
    ).resolves.toBeUndefined();
  });

  it('fige la fiche une fois le dossier soumis (pas de changement de zone en cours d’examen)', async () => {
    await expect(
      attempt(`${withDossier} ${piece('identite')} ${piece('photo')} ${submit}
        UPDATE praticien SET prefecture_id = 7 WHERE utilisateur_id = contexte_utilisateur()`),
    ).rejects.toThrow("Fiche non modifiable pendant l'examen du dossier");
  });

  it('refuse un dossier ouvert directement à l’étape 3', async () => {
    await expect(
      attempt(`${newPractitionerAccount()}
        INSERT INTO praticien (utilisateur_id, specialite_id, prefecture_id, langue_principale)
        VALUES (contexte_utilisateur(), 1, 4, 'pul');
        INSERT INTO dossier_certification (praticien_id, etape_courante)
        SELECT id, 3 FROM praticien WHERE utilisateur_id = contexte_utilisateur()`),
    ).rejects.toThrow("Le praticien ouvre un dossier initial, à l'étape 1");
  });
});

describe('Pièces et soumission (critères 1 et 2 de US-040)', () => {
  it('soumet un dossier complet : il passe à l’étape 2', async () => {
    const rows = await lastRows(`${withDossier} ${piece('identite')} ${piece('photo')} ${submit}
       SELECT d.etape_courante FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id
        WHERE p.utilisateur_id = contexte_utilisateur()`);
    expect(rows[0]).toEqual({ etape_courante: 2 });
  });

  it('bloque la soumission sans photo, en nommant la pièce manquante', async () => {
    await expect(attempt(`${withDossier} ${piece('identite')} ${submit}`)).rejects.toThrow(
      'Pièces obligatoires manquantes : photo',
    );
  });

  it('liste toutes les pièces obligatoires manquantes, dans l’ordre', async () => {
    const rows = await lastRows(`${withDossier} ${piece('justificatif')}
       SELECT dossier_pieces_manquantes(d.id) AS manquantes
         FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id
        WHERE p.utilisateur_id = contexte_utilisateur()`);
    expect(rows[0]).toEqual({ manquantes: ['identite', 'photo'] });
  });

  it('refuse le dépôt d’un compte rendu de visite par le praticien', async () => {
    await expect(attempt(`${withDossier} ${piece('compte_rendu_visite')}`)).rejects.toThrow(
      'Pièce non modifiable par le praticien à ce stade',
    );
  });

  it('refuse un dépôt de pièce après la soumission', async () => {
    await expect(
      attempt(`${withDossier} ${piece('identite')} ${piece('photo')} ${submit} ${piece('justificatif')}`),
    ).rejects.toThrow('Pièce non modifiable par le praticien à ce stade');
  });

  it('refuse le retrait d’une pièce après la soumission', async () => {
    await expect(
      attempt(`${withDossier} ${piece('identite')} ${piece('photo')} ${submit}
        DELETE FROM dossier_piece`),
    ).rejects.toThrow('Pièce non modifiable par le praticien à ce stade');
  });
});

describe('Rejet définitif de moins de 12 mois (critère 3 de US-040, R-CER-04)', () => {
  it('refuse un nouveau dossier ouvert par le praticien', async () => {
    // La DG rejette définitivement son dossier, puis le praticien en ouvre un autre
    await expect(
      attempt(`${withDossier}
        ${openContext('dg@sabou-sante.gn')}
        SELECT dossier_transition(d.id, 'rejet_definitif', 1, 'Fraude documentaire')
          FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id
         WHERE p.code >= 'PR-2';
        SELECT contexte_ouvrir('${KEYCLOAK_ID}');
        INSERT INTO dossier_certification (praticien_id)
        SELECT id FROM praticien WHERE utilisateur_id = contexte_utilisateur()`),
    ).rejects.toThrow('nouveau dossier impossible moins de 12 mois après un rejet définitif');
  });
});
