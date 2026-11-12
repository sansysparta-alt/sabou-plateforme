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
  COMPTES_CLIENT_SECRET: auditSecret,
  ADMIN_APP_URL: 'https://gestion.sabou.example',
  PUBLIC_KEYCLOAK_ISSUER: 'https://auth.sabou.example/realms/sabou-public',
  SITE_CLIENT_SECRET: clientSecret,
  PUBLIC_AUDIT_CLIENT_SECRET: auditSecret,
  INSCRIPTION_CLIENT_SECRET: auditSecret,
  SITE_URL: 'https://sabou.example',
  SMS_PROVIDER: 'journal',
  S3_ENDPOINT: 'http://seaweedfs:8333',
  S3_ACCESS_KEY: 'sabou',
  S3_SECRET_KEY: 's'.repeat(32),
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
      SMS_POLL_SECONDS: 30,
      COMPTES_CLIENT_ID: 'sabou-comptes',
      INVITATION_HOURS: 72,
      SITE_CLIENT_ID: 'sabou-site',
      MOBILE_CLIENT_ID: 'sabou-mobile',
      API_AUDIENCE: 'sabou-api',
      PUBLIC_AUDIT_CLIENT_ID: 'sabou-audit',
      INSCRIPTION_CLIENT_ID: 'sabou-inscription',
      TRUST_PROXY: 'loopback, linklocal, uniquelocal',
      S3_REGION: 'us-east-1',
      S3_PIECES_BUCKET: 'sabou-pieces',
      S3_CREATE_BUCKET: false,
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

  // US-031 : un SMS part dans les 5 minutes ; la relève ne peut pas être plus espacée
  it('refuse une relève des SMS espacée de plus de 4 minutes', () => {
    expect(loadEnv({ ...base, SMS_POLL_SECONDS: '240' }).SMS_POLL_SECONDS).toBe(240);
    expect(() => loadEnv({ ...base, SMS_POLL_SECONDS: '241' })).toThrow(
      /^Configuration invalide : SMS_POLL_SECONDS$/,
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
