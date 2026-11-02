import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const url = 'postgres://sabou_app:secret-123@localhost:5432/sabou';

describe('loadEnv', () => {
  it('lit la configuration et applique le port par défaut', () => {
    expect(loadEnv({ DATABASE_URL: url })).toEqual({ PORT: 3000, DATABASE_URL: url });
  });

  it("refuse une adresse de base absente ou d'un autre protocole", () => {
    expect(() => loadEnv({})).toThrow('Configuration invalide : DATABASE_URL');
    expect(() => loadEnv({ DATABASE_URL: 'mysql://localhost/sabou' })).toThrow('DATABASE_URL');
  });

  it("ne recopie jamais la valeur fautive dans l'erreur", () => {
    expect(() => loadEnv({ DATABASE_URL: url, PORT: 'secret-123' })).toThrow(
      /^Configuration invalide : PORT$/,
    );
  });
});
