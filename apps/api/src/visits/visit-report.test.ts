import { describe, expect, it } from 'vitest';
import { canonicalReport, normalizeNotes, reportFingerprint } from './visit-report';

// US-041 : empreinte du compte rendu signé, recalculable à partir des données en base
const content = {
  dossier: 'DS-1041',
  visite: 2,
  realiseeLe: '2026-11-13',
  avis: 'favorable' as const,
  auteur: 3,
  constats: 'Lieu conforme.\nPlantes séchées à l’abri.',
};

describe('empreinte du compte rendu', () => {
  it('est le SHA3-256 du texte canonique (vecteur fixe)', () => {
    expect(canonicalReport(content)).toBe(
      'SABOU compte rendu de visite v1\ndossier=DS-1041\nvisite=2\ndate=2026-11-13\navis=favorable\nauteur=3\nconstats=\nLieu conforme.\nPlantes séchées à l’abri.',
    );
    // Calculé une fois hors de Node (hashlib.sha3_256 de Python) : fige le format et l'algorithme
    expect(reportFingerprint(content)).toBe(
      'f9190c213cd642697300a0b21be71eae76f1dba5db274de7f8b2ad3489e9d502',
    );
  });

  it.each([
    ['dossier', { dossier: 'DS-1042' }],
    ['visite', { visite: 3 }],
    ['date', { realiseeLe: '2026-11-12' }],
    ['avis', { avis: 'defavorable' as const }],
    ['auteur', { auteur: 5 }],
    ['constats', { constats: 'Lieu conforme.' }],
  ])('change dès que %s change', (_, change) => {
    expect(reportFingerprint({ ...content, ...change })).not.toBe(reportFingerprint(content));
  });

  it('ne dépend ni des fins de ligne ni de la forme Unicode de la saisie', () => {
    const typed = normalizeNotes('  Lieu conforme.\r\nPlantes séchées à l’abri.  ');
    expect(typed).toBe(content.constats);
    expect(reportFingerprint({ ...content, constats: typed })).toBe(reportFingerprint(content));
  });
});
