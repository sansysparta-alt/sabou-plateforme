import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const url = 'postgres://sabou_app:secret-123@localhost:5432/sabou';
// Tirés à chaque exécution : aucun secret, même factice, n'est écrit dans le dépôt
const secret = randomBytes(32).toString('base64url');
const clientSecret = randomBytes(32).toString('base64url');
const auditSecret = randomBytes(32).toString('base64url');

// Configuration minimale valide (production : HTTPS partout)
const base = {
  DATABASE_URL: url,
  SYNC_JWT_SECRET: secret,
  KEYCLOAK_ISSUER: 'https://auth.sabou.example/realms/sabou',
  ADMIN_CLIENT_SECRET: clientSecret,
  AUDIT_CLIENT_SECRET: auditSecret,
  ADMIN_APP_URL: 'https://gestion.sabou.example',
  VALKEY_URL: 'rediss://:motdepasse@valkey:6379',
};

describe('loadEnv', () => {
  it('lit la configuration et applique les valeurs par défaut', () => {
    expect(loadEnv(base)).toEqual({
      ...base,
      PORT: 3000,
      KEYCLOAK_ALLOW_HTTP: false,
      ADMIN_CLIENT_ID: 'sabou-admin',
      AUDIT_CLIENT_ID: 'sabou-audit',
      AUDIT_POLL_SECONDS: 60,
      TRUST_PROXY: 'loopback, linklocal, uniquelocal',
    });
  });

  it("refuse une adresse de base absente ou d'un autre protocole", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: undefined })).toThrow(
      'Configuration invalide : DATABASE_URL',
    );
    expect(() => loadEnv({ ...base, DATABASE_URL: 'mysql://localhost/sabou' })).toThrow(
      'DATABASE_URL',
    );
  });

  it("ne recopie jamais la valeur fautive dans l'erreur", () => {
    expect(() => loadEnv({ ...base, PORT: 'secret-123' })).toThrow(
      /^Configuration invalide : PORT$/,
    );
  });

  it('refuse une clé de synchronisation absente ou trop courte (moins de 256 bits)', () => {
    expect(() => loadEnv({ ...base, SYNC_JWT_SECRET: undefined })).toThrow(
      /^Configuration invalide : SYNC_JWT_SECRET$/,
    );
    expect(() => loadEnv({ ...base, SYNC_JWT_SECRET: 'Y291cnRl' })).toThrow('SYNC_JWT_SECRET');
  });

  it('refuse un secret de client Keycloak trop court', () => {
    expect(() => loadEnv({ ...base, ADMIN_CLIENT_SECRET: 'court' })).toThrow(
      /^Configuration invalide : ADMIN_CLIENT_SECRET$/,
    );
    expect(() => loadEnv({ ...base, AUDIT_CLIENT_SECRET: 'court' })).toThrow(
      /^Configuration invalide : AUDIT_CLIENT_SECRET$/,
    );
  });

  it('refuse HTTP sans TLS, sauf autorisation explicite du poste de développement', () => {
    const local = {
      ...base,
      KEYCLOAK_ISSUER: 'http://localhost:8080/realms/sabou',
      KEYCLOAK_INTERNAL_URL: 'http://keycloak:8080',
      ADMIN_APP_URL: 'http://localhost:5173',
    };
    expect(() => loadEnv(local)).toThrow(
      /^Configuration invalide : KEYCLOAK_ISSUER, KEYCLOAK_INTERNAL_URL, ADMIN_APP_URL$/,
    );
    expect(loadEnv({ ...local, KEYCLOAK_ALLOW_HTTP: 'true' }).KEYCLOAK_ALLOW_HTTP).toBe(true);
  });
});
