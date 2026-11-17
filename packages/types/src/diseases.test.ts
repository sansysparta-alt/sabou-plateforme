import { describe, expect, it } from 'vitest';
import { diseaseFieldsSchema, diseaseUpdateSchema } from './diseases.js';

// US-052 : saisie d'une fiche maladie, contrôlée avant d'atteindre la base
const disease = {
  nomFr: ' Fièvre typhoïde ',
  nomEn: '',
  symptomesFr: 'Fièvre prolongée.',
  denominations: [{ langue: 'fr', denomination: ' Typhoïde ' }],
};

describe('fiche maladie', () => {
  it('retire les espaces ; textes facultatifs vides ou absents deviennent null', () => {
    expect(diseaseFieldsSchema.parse(disease)).toEqual({
      nomFr: 'Fièvre typhoïde',
      nomEn: null,
      symptomesFr: 'Fièvre prolongée.',
      symptomesEn: null,
      denominations: [{ langue: 'fr', denomination: 'Typhoïde' }],
    });
  });

  it.each([
    ['sans nom français', { nomFr: ' ' }, 'Nom français : champ obligatoire.'],
    [
      'une dénomination en langue nationale',
      { denominations: [{ langue: 'mal', denomination: 'Kaba' }] },
      'langue française ou anglaise',
    ],
    ['une dénomination vide', { denominations: [{ langue: 'fr', denomination: ' ' }] }, 'vide'],
    [
      'plus de 30 dénominations',
      {
        denominations: Array.from({ length: 31 }, (_, i) => ({
          langue: 'fr',
          denomination: `D${i}`,
        })),
      },
      '30 dénominations au plus',
    ],
    ['des symptômes trop longs', { symptomesFr: 'a'.repeat(2001) }, '2000 caractères'],
  ])('refuse %s', (_case, change, message) => {
    const result = diseaseFieldsSchema.safeParse({ ...disease, ...change });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(message);
  });

  it('modification : exige la date de dernière lecture', () => {
    expect(diseaseUpdateSchema.safeParse(disease).success).toBe(false);
  });
});
