// US-052 : gérer les fiches maladies (UC-05, R-MAL-01, R-RCH-01). Jeu d'exemple : MA-001
// Paludisme (dénominations Malaria, Fièvre palustre, Swamp fever) à MA-005 Diabète. Chaque
// cas part du même état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const DG = 'dg@sabou-sante.gn';
const COMMITTEE = 'comite@sabou-sante.gn';
const as = (email: string, sql: string) => lastRows(db.url.app, `${openContext(email)} ${sql}`);
const den = (...items: [string, string][]) =>
  `'${JSON.stringify(items.map(([langue, denomination]) => ({ langue, denomination }))).replace(/'/g, "''")}'::jsonb`;
const create = (nomFr: string, denominations = den()) =>
  `SELECT * FROM maladie_creer('${nomFr.replace(/'/g, "''")}', 'Typhoid fever',
     'Fièvre prolongée, maux de ventre.', NULL, ${denominations});`;
const denominationsOf = (code: string) =>
  `SELECT d.langue_code AS langue, d.denomination FROM maladie_denomination d
     JOIN maladie m ON m.id = d.maladie_id WHERE m.code = '${code}' ORDER BY 1, 2;`;
const seen = (code: string) => `(SELECT updated_at FROM maladie WHERE code = '${code}')`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : nom français unique, nom anglais, dénominations, symptômes', () => {
  it('la DG crée une fiche, avec ses dénominations, tracée au journal', async () => {
    const rows = await as(
      DG,
      `${create('Fièvre typhoïde', den(['fr', 'Typhoïde'], ['en', 'Typhoid']))}
       SELECT m.code, m.nom_en, m.symptomes_fr, j.details
         FROM maladie m JOIN journal_audit j ON j.objet_id = m.code AND j.action = 'maladie.creee'
        WHERE m.nom_fr = 'Fièvre typhoïde';`,
    );
    expect(rows).toEqual([
      {
        code: 'MA-006',
        nom_en: 'Typhoid fever',
        symptomes_fr: 'Fièvre prolongée, maux de ventre.',
        details: { nomFr: 'Fièvre typhoïde', denominations: 2 },
      },
    ]);
  });

  it('nom français déjà pris, à la casse et aux accents près : refusé', async () => {
    await expect(as(COMMITTEE, create(' PALUDÍSME '))).rejects.toThrow(
      'Nom français déjà utilisé par la fiche MA-001',
    );
  });

  it('nom français vide refusé ; nom anglais et symptômes facultatifs', async () => {
    await expect(as(DG, create('  '))).rejects.toThrow('ck_maladie_nom_fr');
    const rows = await as(
      DG,
      `SELECT nom_en, symptomes_fr FROM maladie_creer('Gale', NULL, NULL, NULL, NULL);`,
    );
    expect(rows).toEqual([{ nom_en: null, symptomes_fr: null }]);
  });

  it('dénominations en français ou en anglais seulement : aucun texte en langue nationale', async () => {
    await expect(as(DG, create('Gale', den(['mal', 'Kaba'])))).rejects.toThrow();
  });

  it('dénominations en double ignorées, à la casse et aux accents près', async () => {
    const rows = await as(
      DG,
      `${create('Fièvre typhoïde', den(['fr', 'Typhoïde'], ['fr', 'typhoide'], ['en', 'Typhoid']))}
       ${denominationsOf('MA-006')}`,
    );
    expect(rows).toHaveLength(2);
  });

  it('modifier : dénominations remplacées, changements tracés ; fiche changée entre-temps refusée', async () => {
    const rows = await as(
      COMMITTEE,
      `SELECT maladie_modifier('MA-002', ${seen('MA-002')}, 'Hypertension', 'High blood pressure',
         'Souvent sans symptôme.', NULL, ${den(['fr', 'Tension'], ['fr', 'Haute tension'])});
       SELECT details FROM journal_audit WHERE action = 'maladie.modifiee' AND objet_id = 'MA-002';`,
    );
    expect(rows[0]!.details).toMatchObject({
      nomEn: ['Hypertension', 'High blood pressure'],
      symptomes: true,
      denominations: [
        [{ langue: 'fr', denomination: 'Tension' }],
        [
          { langue: 'fr', denomination: 'Haute tension' },
          { langue: 'fr', denomination: 'Tension' },
        ],
      ],
    });
    await expect(
      as(
        COMMITTEE,
        `SELECT maladie_modifier('MA-002', now() - interval '1 day', 'Hypertension',
         NULL, NULL, NULL, '[]');`,
      ),
    ).rejects.toThrow('MA-002 modifiée entre-temps');
  });

  it('les autres profils ne gèrent pas les fiches ; l’API n’écrit pas en direct', async () => {
    await expect(as('prefectoral.labe@sabou-sante.gn', create('Gale'))).rejects.toThrow(
      'réservées à la DG et au Comité scientifique',
    );
    await expect(as(DG, `UPDATE maladie SET nom_fr = 'X' WHERE code = 'MA-001';`)).rejects.toThrow(
      'permission denied',
    );
    await expect(as(DG, `DELETE FROM maladie_denomination;`)).rejects.toThrow('permission denied');
  });
});

describe('Critère : les dénominations sont trouvées par la recherche sans accents', () => {
  const search = (term: string) =>
    `SELECT DISTINCT maladie_code FROM rechercher_maladie('${term}') ORDER BY 1;`;

  it('« fievre palustre », sans accent, trouve le paludisme par sa dénomination', async () => {
    expect(await as(DG, search('fievre palustre'))).toEqual([{ maladie_code: 'MA-001' }]);
  });

  it('une dénomination ajoutée est aussitôt trouvée, accents ou pas', async () => {
    const rows = await as(
      DG,
      `${create('Fièvre typhoïde', den(['fr', 'Fièvre entérique']))}
       ${search('fievre enterique')}`,
    );
    // Recherche tolérante aux fautes : d'autres fièvres peuvent remonter aussi
    expect(rows).toContainEqual({ maladie_code: 'MA-006' });
  });
});
