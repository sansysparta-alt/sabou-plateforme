// US-100 : validation du dépôt public et de la décision du Comité (la base vérifie de nouveau)
import { describe, expect, it } from 'vitest';
import { healthReportDecisionSchema, healthReportRequestSchema } from './health-reports.js';

const valid = {
  type: 'danger',
  code: ' rec-2041 ',
  gravite: 'grave',
  description: '  Vomissements après la première prise.  ',
  contact: '',
};

describe('Dépôt d’un signalement', () => {
  it('code mis en forme, textes nettoyés, contact vide ignoré', () => {
    expect(healthReportRequestSchema.parse(valid)).toEqual({
      type: 'danger',
      code: 'REC-2041',
      gravite: 'grave',
      description: 'Vomissements après la première prise.',
      contact: undefined,
    });
  });

  it('refusé : code d’un autre objet, description trop courte, champ inconnu', () => {
    expect(healthReportRequestSchema.safeParse({ ...valid, code: 'DS-2001' }).success).toBe(false);
    expect(healthReportRequestSchema.safeParse({ ...valid, description: 'Court' }).success).toBe(
      false,
    );
    expect(healthReportRequestSchema.safeParse({ ...valid, role: 'dg' }).success).toBe(false);
  });

  it('plante acceptée', () => {
    expect(healthReportRequestSchema.parse({ ...valid, code: 'pl-001' }).code).toBe('PL-001');
  });
});

describe('Décision du Comité', () => {
  it('motif obligatoire, décision connue', () => {
    expect(
      healthReportDecisionSchema.safeParse({ decision: 'suspension', motif: ' ' }).success,
    ).toBe(false);
    expect(healthReportDecisionSchema.safeParse({ decision: 'ignorer', motif: 'x' }).success).toBe(
      false,
    );
    expect(
      healthReportDecisionSchema.parse({ decision: 'retrait', motif: ' Danger avéré ' }),
    ).toEqual({ decision: 'retrait', motif: 'Danger avéré' });
  });
});
