// US-003, critère 2 : les cas interdits de examples/queries.sql sont refusés par la base.
// Chaque cas part de l'état du jeu d'exemple (transaction annulée) et vérifie la raison du
// refus : une erreur pour une autre raison ne prouverait rien.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSeededDatabase,
  inRolledBackTransaction,
  openContext,
  type TestDatabase,
} from './helpers.ts';

let db: TestDatabase;
const attempt = (sql: string) => inRolledBackTransaction(db.url.app, sql);

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Langue non autorisée (R-LNG-02 à R-LNG-05)', () => {
  it('refuse un libellé texte en pular', async () => {
    await expect(
      attempt(`INSERT INTO menu_site_i18n (menu_id, langue_code, libelle) VALUES (1, 'pul', 'X')`),
    ).rejects.toThrow("Langue « pul » non autorisée pour l'usage texte");
  });

  it('refuse une voix en anglais', async () => {
    await expect(
      attempt(`INSERT INTO plante_voix (plante_id, langue_code, audio_id, enregistre_par)
               VALUES (3, 'en', 1, 1)`),
    ).rejects.toThrow("Langue « en » non autorisée pour l'usage voix");
  });

  it('accepte une voix en malinké (contrôle positif)', async () => {
    await expect(
      attempt(`INSERT INTO plante_voix (plante_id, langue_code, audio_id, enregistre_par)
               VALUES (3, 'mal', 1, 1)`),
    ).resolves.toBeUndefined();
  });
});

describe('Traitement incomplet', () => {
  it('refuse de certifier REC-2045, qui n’a qu’une section', async () => {
    await expect(
      attempt(`UPDATE recette SET statut = 'certifiee' WHERE code = 'REC-2045'`),
    ).rejects.toThrow('Traitement REC-2045 : sections obligatoires manquantes');
  });
});

describe('Acteur hors zone (R-CER-02)', () => {
  // DS-1041 (praticien de Labé) resoumis par son praticien : il passe à l'étape 2
  const resubmit = `${openContext('s.kourouma@exemple.gn')} SELECT dossier_transition(1, 'soumis', 6);`;
  const as = openContext;

  it('refuse la validation par le préfectoral de Kankan', async () => {
    // La fonction contrôle l'acteur elle-même, quel que soit le contexte ouvert
    await expect(
      attempt(`${resubmit} ${as('dg@sabou-sante.gn')} SELECT dossier_transition(1, 'valide', 5);`),
    ).rejects.toThrow("Acteur 5 non habilité pour l'étape 2 du dossier DS-1041");
  });

  it('dans son propre contexte, le préfectoral de Kankan ne voit même pas le dossier (US-011)', async () => {
    await expect(
      attempt(
        `${resubmit} ${as('prefectoral.kankan@sabou-sante.gn')} SELECT dossier_transition(1, 'valide', 5);`,
      ),
    ).rejects.toThrow('Dossier 1 introuvable');
  });

  it('laisse passer le préfectoral de Labé jusqu’au contrôle suivant (contrôle positif)', async () => {
    // Même rôle, bonne zone : l'habilitation passe, seule la visite terrain manque (R-CER-06)
    await expect(
      attempt(
        `${resubmit} ${as('prefectoral.labe@sabou-sante.gn')} SELECT dossier_transition(1, 'valide', 3);`,
      ),
    ).rejects.toThrow('visite terrain signée requise avant validation (R-CER-06)');
  });
});

describe('Rejet sans motif', () => {
  it('refuse un rejet de traitement sans motif, ou avec un motif vide', async () => {
    for (const motif of ['NULL', `''`, `'   '`]) {
      await expect(
        attempt(
          `${openContext('comite@sabou-sante.gn')} SELECT recette_transition(3, 'soumise', 4, ${motif});`,
        ),
      ).rejects.toThrow('Transition transmise → soumise : motif obligatoire');
    }
  });

  it('refuse un rejet de dossier avec un motif fait d’espaces', async () => {
    await expect(
      attempt(
        `${openContext('s.kourouma@exemple.gn')} SELECT dossier_transition(1, 'soumis', 6);
         ${openContext('prefectoral.labe@sabou-sante.gn')} SELECT dossier_transition(1, 'rejete', 3, '  ');`,
      ),
    ).rejects.toThrow('ck_motif_rejet');
  });

  it('accepte un rejet motivé (contrôle positif)', async () => {
    await expect(
      attempt(
        `${openContext('comite@sabou-sante.gn')} SELECT recette_transition(3, 'soumise', 4, 'Posologie à préciser');`,
      ),
    ).resolves.toBeUndefined();
  });
});
