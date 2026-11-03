import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const url = 'postgres://sabou_app:secret-123@localhost:5432/sabou';
const secret = 'c2Fib3UtY2xlLWRlLXRlc3QtZGUtMzItb2N0ZXRzLW1pbmltdW0';

describe('loadEnv', () => {
  it('lit la configuration et applique le port par défaut', () => {
    expect(loadEnv({ DATABASE_URL: url, SYNC_JWT_SECRET: secret })).toEqual({
      PORT: 3000,
      DATABASE_URL: url,
      SYNC_JWT_SECRET: secret,
    });
  });

  it("refuse une adresse de base absente ou d'un autre protocole", () => {
    expect(() => loadEnv({ SYNC_JWT_SECRET: secret })).toThrow(
      'Configuration invalide : DATABASE_URL',
    );
    expect(() =>
      loadEnv({ DATABASE_URL: 'mysql://localhost/sabou', SYNC_JWT_SECRET: secret }),
    ).toThrow('DATABASE_URL');
  });

  it("ne recopie jamais la valeur fautive dans l'erreur", () => {
    expect(() =>
      loadEnv({ DATABASE_URL: url, SYNC_JWT_SECRET: secret, PORT: 'secret-123' }),
    ).toThrow(/^Configuration invalide : PORT$/);
  });

  it('refuse une clé de synchronisation absente ou trop courte (moins de 256 bits)', () => {
    expect(() => loadEnv({ DATABASE_URL: url })).toThrow(
      /^Configuration invalide : SYNC_JWT_SECRET$/,
    );
    expect(() => loadEnv({ DATABASE_URL: url, SYNC_JWT_SECRET: 'Y291cnRl' })).toThrow(
      'SYNC_JWT_SECRET',
    );
  });
});
