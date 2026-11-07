import { describe, expect, it } from 'vitest';
import {
  citizenPasswordError,
  formatNationalMobile,
  signupCompleteRequestSchema,
  signupVerifyRequestSchema,
  toInternational,
  toNationalMobile,
} from './index.js';

describe('Numéro de mobile guinéen (US-014)', () => {
  it('accepte la saisie libre et la ramène aux 9 chiffres nationaux', () => {
    for (const input of [
      '621234567',
      '621 23 45 67',
      '+224 621 23 45 67',
      '00224621234567',
      '224621234567',
      '621-23-45-67',
    ]) {
      expect(toNationalMobile(input)).toBe('621234567');
    }
    expect(toInternational('621234567')).toBe('+224621234567');
    expect(formatNationalMobile('621234567')).toBe('621 23 45 67');
  });

  it('refuse un numéro fixe, étranger, trop court ou contenant des lettres', () => {
    for (const input of [
      '',
      '301234567',
      '+33612345678',
      '62123456',
      '6212345678',
      '62123456a',
      '+224 30 12 34 56',
    ]) {
      expect(toNationalMobile(input)).toBeNull();
    }
  });

  it('valide le code reçu par SMS : 6 chiffres', () => {
    expect(
      signupVerifyRequestSchema.safeParse({ phone: '621234567', code: '012345' }).success,
    ).toBe(true);
    expect(signupVerifyRequestSchema.safeParse({ phone: '621234567', code: '12345' }).success).toBe(
      false,
    );
    expect(
      signupVerifyRequestSchema.safeParse({ phone: '621234567', code: '12a456' }).success,
    ).toBe(false);
  });
});

describe('Mot de passe et prénom du citoyen', () => {
  it('accepte 8 chiffres (décision du maître d’œuvre)', () => {
    expect(citizenPasswordError('40718293', '621234567')).toBeNull();
  });

  it('refuse un mot de passe trop court, son propre numéro, une répétition ou une suite', () => {
    for (const password of [
      '4071829',
      '621234567',
      '21234567',
      '00000000',
      '12345678',
      '98765432',
      '89012345',
    ]) {
      expect(citizenPasswordError(password, '621234567')).not.toBeNull();
    }
  });

  it('accepte un prénom avec accents, trait d’union ou apostrophe, refuse chiffres et balises', () => {
    const base = { ticket: 'a'.repeat(43), password: '40718293' };
    for (const firstName of ['Aïssatou', 'Mamadou-Saliou', "N'Faly"]) {
      expect(signupCompleteRequestSchema.safeParse({ ...base, firstName }).success).toBe(true);
    }
    for (const firstName of ['', '  ', 'Ali2', '<b>Ali</b>', 'x'.repeat(51)]) {
      expect(signupCompleteRequestSchema.safeParse({ ...base, firstName }).success).toBe(false);
    }
  });
});
