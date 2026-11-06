import { describe, expect, it } from 'vitest';
import { inviteRequestSchema } from './accounts.js';

const base = {
  email: 'Fanta.Conde@Sabou-Sante.gn',
  firstName: ' Fanta ',
  lastName: 'Condé',
  role: 'regional',
  regionId: 3,
  prefectureId: null,
  interfaceLanguage: 'fr',
  listeningLanguage: 'sou',
  languages: [{ code: 'sou', record: true, translate: false, validate: true }],
} as const;

describe('inviteRequestSchema', () => {
  it('accepte une invitation complète et normalise e-mail et noms', () => {
    expect(inviteRequestSchema.parse(base)).toMatchObject({
      email: 'fanta.conde@sabou-sante.gn',
      firstName: 'Fanta',
    });
  });

  it('refuse un rôle régional sans région (US-012, critère 2)', () => {
    const result = inviteRequestSchema.safeParse({ ...base, regionId: null });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['zone'] });
  });

  it('refuse une zone qui ne correspond pas au rôle', () => {
    expect(inviteRequestSchema.safeParse({ ...base, prefectureId: 4 }).success).toBe(false);
    expect(inviteRequestSchema.safeParse({ ...base, role: 'dg' }).success).toBe(false);
    expect(
      inviteRequestSchema.safeParse({ ...base, role: 'prefectoral', regionId: null }).success,
    ).toBe(false);
  });

  it('refuse une langue en double, un rôle non invitable et tout champ en trop', () => {
    expect(
      inviteRequestSchema.safeParse({ ...base, languages: [...base.languages, ...base.languages] })
        .success,
    ).toBe(false);
    expect(
      inviteRequestSchema.safeParse({ ...base, role: 'citoyen', regionId: null }).success,
    ).toBe(false);
    expect(inviteRequestSchema.safeParse({ ...base, password: 'x' }).success).toBe(false);
  });
});
