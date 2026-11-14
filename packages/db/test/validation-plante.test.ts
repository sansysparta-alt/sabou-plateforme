// US-051 : valider une fiche plante (UC-52, R-PLA-05). Jeu d'exemple : PL-001 à PL-004
// validées, PL-005 (Neem) en revue ; REC-2041 associe PL-001 et PL-002. Chaque cas part du
// même état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const COMMITTEE = 'comite@sabou-sante.gn';
const as = (email: string, sql: string) => lastRows(db.url.app, `${openContext(email)} ${sql}`);
const asOwner = (sql: string) => lastRows(db.url.migrator, `SET LOCAL search_path = sabou; ${sql}`);
const seen = (code: string) => `(SELECT updated_at FROM plante WHERE code = '${code}')`;
const validate = (code: string) => `SELECT * FROM plante_valider('${code}', ${seen(code)});`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : la validation enregistre le valideur et la date', () => {
  it('le Comité valide une fiche en revue : statut, valideur, date, journal', async () => {
    const rows = await as(
      COMMITTEE,
      `${validate('PL-005')}
       SELECT p.statut, u.email AS valideur, p.valide_le > now() - interval '1 minute' AS date_du_jour,
              j.action, j.utilisateur_id = u.id AS journal_du_valideur
         FROM plante p JOIN utilisateur u ON u.id = p.valide_par
         JOIN journal_audit j ON j.objet_id = p.code AND j.action = 'plante.validee'
        WHERE p.code = 'PL-005';`,
    );
    expect(rows).toEqual([
      {
        statut: 'validee',
        valideur: COMMITTEE,
        date_du_jour: true,
        action: 'plante.validee',
        journal_du_valideur: true,
      },
    ]);
  });

  it('seul le Comité valide : la DG non, les autres profils non plus', async () => {
    await expect(as('dg@sabou-sante.gn', validate('PL-005'))).rejects.toThrow(
      'réservée au Comité scientifique',
    );
    await expect(as('regional.kindia@sabou-sante.gn', validate('PL-005'))).rejects.toThrow(
      'réservées à la DG et au Comité scientifique',
    );
  });

  it('une fiche déjà validée, ou changée depuis sa lecture, n’est pas validée', async () => {
    await expect(as(COMMITTEE, validate('PL-001'))).rejects.toThrow('PL-001 déjà validée');
    await expect(
      as(COMMITTEE, `SELECT plante_valider('PL-005', now() - interval '1 day');`),
    ).rejects.toThrow('PL-005 modifiée entre-temps');
  });

  it('une fiche validée garde sa validation si seuls ses noms français ou anglais changent', async () => {
    const rows = await as(
      'dg@sabou-sante.gn',
      `SELECT statut, valide_par FROM plante_modifier('PL-001', ${seen('PL-001')},
         'Khaya senegalensis', 'Meliaceae', 'Caïlcédrat du Sénégal', 'Senegal mahogany');`,
    );
    expect(rows).toEqual([{ statut: 'validee', valide_par: '4' }]);
  });

  it('identité botanique changée : la fiche repasse en revue, le journal le dit', async () => {
    const rows = await as(
      'dg@sabou-sante.gn',
      `SELECT statut, valide_par, valide_le FROM plante_modifier('PL-001', ${seen('PL-001')},
         'Khaya grandifoliola', 'Meliaceae', 'Caïlcédrat');
       SELECT p.statut, p.valide_par, p.valide_le, j.details->'retourEnRevue' AS retour
         FROM plante p JOIN journal_audit j ON j.objet_id = p.code AND j.action = 'plante.modifiee'
        WHERE p.code = 'PL-001';`,
    );
    expect(rows).toEqual([{ statut: 'en_revue', valide_par: null, valide_le: null, retour: true }]);
  });

  it('à la casse et aux accents près, l’identité ne change pas', async () => {
    const rows = await as(
      COMMITTEE,
      `SELECT statut FROM plante_modifier('PL-001', ${seen('PL-001')},
         'khaya SENEGALENSIS', 'meliaceae', 'Caïlcédrat');`,
    );
    expect(rows).toEqual([{ statut: 'validee' }]);
  });

  it('l’API ne valide pas en écrivant le statut en direct', async () => {
    await expect(
      as(COMMITTEE, `UPDATE plante SET statut = 'validee' WHERE code = 'PL-005';`),
    ).rejects.toThrow('permission denied');
  });
});

describe('Critère : une plante « en revue » ne peut pas entrer dans un traitement certifié', () => {
  const certifyWithNeem = `
    INSERT INTO recette_plante (recette_id, plante_id, ordre, partie_utilisee)
    VALUES (1, (SELECT id FROM plante WHERE code = 'PL-005'), 3, 'feuilles');
    UPDATE recette SET statut = 'certifiee' WHERE code = 'REC-2041';`;

  it('certifier un traitement qui contient une plante en revue est refusé', async () => {
    await expect(asOwner(certifyWithNeem)).rejects.toThrow(
      'toutes les plantes doivent être validées par le Comité',
    );
  });

  it('une fois la plante validée, ce refus ne s’applique plus', async () => {
    const validated = `UPDATE plante SET statut = 'validee', valide_par = 4, valide_le = now()
                        WHERE code = 'PL-005';`;
    // Les autres conditions de la certification (sections, praticien certifié) restent
    // vérifiées : seule l'absence du refus « plante en revue » est attendue ici
    const outcome = await asOwner(`${validated} ${certifyWithNeem}`).then(
      () => 'certifié',
      (error: Error) => error.message,
    );
    expect(outcome).not.toContain('toutes les plantes doivent être validées');
  });
});
