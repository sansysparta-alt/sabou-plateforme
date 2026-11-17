import { describe, expect, it } from 'vitest';
import { fieldVisitPlanSchema, fieldVisitReportSchema } from './visits.js';

// US-041 : saisies des visites terrain, contrôlées avant d'atteindre la base
describe('planification d’une visite', () => {
  it.each(['2026-11-20T09:30', '2026-12-31T23:59', '2028-02-29T00:00'])(
    'accepte %s',
    (prevueLe) => {
      expect(fieldVisitPlanSchema.safeParse({ prevueLe }).success).toBe(true);
    },
  );

  it.each([
    '2026-02-30T09:30',
    '2026-11-20T24:00',
    '2026-11-20T09:60',
    '2026-11-20',
    '20/11/2026 09:30',
  ])('refuse %s', (prevueLe) => {
    expect(fieldVisitPlanSchema.safeParse({ prevueLe }).success).toBe(false);
  });
});

describe('compte rendu signé', () => {
  const report = {
    visite: 2,
    realiseeLe: '2026-11-13',
    avis: 'favorable',
    constats: '  Lieu conforme.  ',
    attestation: true,
  };

  it('accepte un compte rendu complet et retire les espaces autour du texte', () => {
    expect(fieldVisitReportSchema.parse(report).constats).toBe('Lieu conforme.');
  });

  it.each([
    ['sans attestation', { attestation: false }, 'Cochez l’attestation'],
    ['sans constats', { constats: '   ' }, 'Décrivez ce que vous avez constaté.'],
    ['trop long', { constats: 'a'.repeat(5001) }, '5000 caractères'],
    ['avec un avis inconnu', { avis: 'excellent' }, 'Choisissez un avis.'],
    ['avec une date impossible', { realiseeLe: '2026-02-29' }, 'Date de visite invalide.'],
  ])('refuse un compte rendu %s', (_, change, message) => {
    const result = fieldVisitReportSchema.safeParse({ ...report, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(message);
  });

  it('refuse un champ inattendu', () => {
    expect(fieldVisitReportSchema.safeParse({ ...report, signePar: 1 }).success).toBe(false);
  });
});
