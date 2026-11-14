import { describe, expect, it } from 'vitest';
import { practitionerCodeSchema, rejectionSchema, rejectionSearchSchema } from './rejections.js';

// US-047 : saisie du rejet définitif, contrôlée avant d'atteindre la base
const fraud = {
  dossier: null,
  motif: 'fraude_documentaire',
  detail: '  Diplôme falsifié.  ',
  confirmation: true,
};
const dangerous = {
  ...fraud,
  motif: 'pratique_dangereuse',
  avisComite: { date: '2026-11-10', reference: ' AV-2026-014 ' },
};

describe('rejet définitif', () => {
  it('accepte un rejet motivé et retire les espaces autour des textes', () => {
    expect(rejectionSchema.parse(fraud).detail).toBe('Diplôme falsifié.');
    expect(rejectionSchema.parse(dangerous).avisComite).toEqual({
      date: '2026-11-10',
      reference: 'AV-2026-014',
    });
    expect(rejectionSchema.parse({ ...fraud, dossier: 'DS-1041' }).dossier).toBe('DS-1041');
  });

  it.each([
    ['un motif hors des trois cas', { motif: 'retard' }, 'Choisissez le motif du rejet.'],
    ['sans précision', { detail: '   ' }, 'Précisez les faits'],
    ['une précision trop longue', { detail: 'a'.repeat(1001) }, '1000 caractères'],
    ['sans confirmation', { confirmation: false }, 'Cochez la confirmation'],
    ['une pratique dangereuse sans avis', { motif: 'pratique_dangereuse' }, 'exige la date'],
    [
      'un avis du Comité pour un autre motif',
      { avisComite: dangerous.avisComite },
      'ne concerne que la pratique dangereuse',
    ],
    [
      'un avis à une date impossible',
      { ...dangerous, avisComite: { date: '2026-02-30', reference: 'AV-1' } },
      'Date de l’avis du Comité invalide.',
    ],
    [
      'un avis sans référence',
      { ...dangerous, avisComite: { date: '2026-11-10', reference: '  ' } },
      'Indiquez la référence',
    ],
    ['un code de dossier invalide', { dossier: "DS-1' OR 1=1" }, 'Code de dossier invalide.'],
    ['un champ inconnu', { praticien: 'PR-1042' }, 'praticien'],
  ])('refuse %s', (_cas, change, message) => {
    const result = rejectionSchema.safeParse({ ...fraud, ...change });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error!.issues)).toContain(message);
  });
});

describe('recherche d’un praticien', () => {
  it('accepte un nom, un code ou un numéro, sans espaces autour', () => {
    expect(rejectionSearchSchema.parse({ q: ' SAB-2026-PR1042-KX7 ' }).q).toBe(
      'SAB-2026-PR1042-KX7',
    );
  });

  it.each([[' a '], ['a'.repeat(101)]])('refuse « %s »', (q) => {
    expect(rejectionSearchSchema.safeParse({ q }).success).toBe(false);
  });

  it('code de praticien', () => {
    expect(practitionerCodeSchema.safeParse('PR-1042').success).toBe(true);
    expect(practitionerCodeSchema.safeParse('PR-1042/../x').success).toBe(false);
  });
});
