import { describe, expect, it } from 'vitest';
import { inviteRequestSchema } from './accounts.js';
import { PHONE_ERROR } from './phone.js';

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

describe('Téléphone facultatif d’un compte d’administration (US-012b)', () => {
  it('absent ou vide : null ; saisi librement : forme internationale', () => {
    expect(inviteRequestSchema.parse(base).phone).toBeNull();
    expect(inviteRequestSchema.parse({ ...base, phone: '  ' }).phone).toBeNull();
    expect(inviteRequestSchema.parse({ ...base, phone: null }).phone).toBeNull();
    for (const input of ['621 23 45 67', '+224 621-23-45-67', '00224621234567']) {
      expect(inviteRequestSchema.parse({ ...base, phone: input }).phone).toBe('+224621234567');
    }
  });

  it('refuse ce qui n’est pas un mobile guinéen, avec un message en français', () => {
    for (const input of ['0123', '721234567', '+33612345678', 'abc']) {
      const result = inviteRequestSchema.safeParse({ ...base, phone: input });
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([PHONE_ERROR]);
    }
  });
});

describe('Langue de l’interface : préférence de la personne, pas de la DG', () => {
  it('absente de l’invitation : français par défaut', () => {
    const withoutLanguage: Record<string, unknown> = { ...base };
    delete withoutLanguage.interfaceLanguage;
    expect(inviteRequestSchema.parse(withoutLanguage).interfaceLanguage).toBe('fr');
    delete withoutLanguage.listeningLanguage;
    // Langue d'écoute absente : celle de la région (null)
    expect(inviteRequestSchema.parse(withoutLanguage).listeningLanguage).toBeNull();
  });
});
