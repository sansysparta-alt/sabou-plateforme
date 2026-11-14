import { describe, expect, it } from 'vitest';
import {
  plantCodeSchema,
  plantFieldsSchema,
  plantImageFieldsSchema,
  plantUpdateSchema,
} from './plants.js';

// US-050 : saisie d'une fiche plante, contrôlée avant d'atteindre la base
const plant = {
  nomScientifique: '  Combretum micranthum ',
  famille: 'Combretaceae',
  nomFr: 'Kinkéliba',
  nomEn: '',
};

describe('fiche plante', () => {
  it('retire les espaces autour ; nom anglais vide ou absent devient null', () => {
    expect(plantFieldsSchema.parse(plant)).toEqual({
      nomScientifique: 'Combretum micranthum',
      famille: 'Combretaceae',
      nomFr: 'Kinkéliba',
      nomEn: null,
    });
    const withoutEnglish = {
      nomScientifique: plant.nomScientifique,
      famille: plant.famille,
      nomFr: plant.nomFr,
    };
    expect(plantFieldsSchema.parse(withoutEnglish).nomEn).toBeNull();
    expect(plantFieldsSchema.parse({ ...plant, nomEn: ' Kinkeliba ' }).nomEn).toBe('Kinkeliba');
  });

  it.each([
    ['sans nom français', { nomFr: '   ' }, 'Nom français : champ obligatoire.'],
    ['sans famille', { famille: '' }, 'Famille : champ obligatoire.'],
    [
      'sans nom scientifique',
      { nomScientifique: undefined },
      'Nom scientifique : champ obligatoire.',
    ],
    ['un nom scientifique trop long', { nomScientifique: 'a'.repeat(151) }, '150 caractères'],
    ['un champ inconnu', { statut: 'validee' }, 'Unrecognized key'],
  ])('refuse %s', (_case, change, message) => {
    const result = plantFieldsSchema.safeParse({ ...plant, ...change });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(message);
  });

  it('modification : exige la date de dernière modification vue à l’écran', () => {
    expect(plantUpdateSchema.safeParse(plant).success).toBe(false);
    expect(
      plantUpdateSchema.parse({ ...plant, vueLe: '2026-11-15T10:00:00.123+00:00' }).vueLe,
    ).toBe('2026-11-15T10:00:00.123+00:00');
  });

  it('code de fiche : PL- suivi de chiffres seulement', () => {
    expect(plantCodeSchema.safeParse('PL-001').success).toBe(true);
    expect(plantCodeSchema.safeParse("PL-001' OR 1=1").success).toBe(false);
  });
});

describe('photo d’une fiche', () => {
  const image = { alt: ' Feuilles séchées ', type: 'feuille', principale: true };

  it('texte alternatif obligatoire, anglais facultatif', () => {
    expect(plantImageFieldsSchema.parse(image)).toEqual({
      alt: 'Feuilles séchées',
      altEn: null,
      type: 'feuille',
      principale: true,
    });
    expect(plantImageFieldsSchema.safeParse({ ...image, alt: '  ' }).success).toBe(false);
  });

  it('refuse un type inconnu', () => {
    expect(plantImageFieldsSchema.safeParse({ ...image, type: 'fleur' }).success).toBe(false);
  });
});
