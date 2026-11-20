// Construction des modules de l'API : chaque dépendance déclarée par un contrôleur, une garde
// ou un dépôt doit être fournie par son module (sinon l'API s'arrête au démarrage, comme le
// 20 novembre 2026 : garde du praticien sans vérificateur de jeton dans DisputesModule).
// Seuls les modules globaux (base, configuration, audit) sont simulés ; aucune connexion n'est
// ouverte.
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Global, Module, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AUDIT_LOG } from './audit/audit.log';
import { ENV, loadEnv } from './config/env';
import { DATABASE } from './database/database';
import { DisputesModule } from './disputes/disputes.module';

const secret = () => randomBytes(32).toString('base64url');
const env = loadEnv({
  DATABASE_URL: 'postgres://sabou_app:secret-123@localhost:5432/sabou',
  SYNC_JWT_SECRET: secret(),
  KEYCLOAK_ISSUER: 'https://auth.sabou.example/realms/sabou',
  ADMIN_CLIENT_SECRET: secret(),
  AUDIT_CLIENT_SECRET: secret(),
  COMPTES_CLIENT_SECRET: secret(),
  ADMIN_APP_URL: 'https://gestion.sabou.example',
  PUBLIC_KEYCLOAK_ISSUER: 'https://auth.sabou.example/realms/sabou-public',
  SITE_CLIENT_SECRET: secret(),
  PUBLIC_AUDIT_CLIENT_SECRET: secret(),
  INSCRIPTION_CLIENT_SECRET: secret(),
  SITE_URL: 'https://sabou.example',
  SMS_PROVIDER: 'journal',
  S3_ENDPOINT: 'http://seaweedfs:8333',
  OPENBAO_ADDR: 'https://openbao:8200',
  OPENBAO_TOKEN_FILE: '/run/openbao/jeton-api',
  S3_ACCESS_KEY: 'sabou',
  S3_SECRET_KEY: 's'.repeat(32),
  VALKEY_URL: 'redis://localhost:6379',
});

@Global()
@Module({
  providers: [
    { provide: ENV, useValue: env },
    { provide: DATABASE, useValue: {} },
    // Modules globaux de l'API (audit) : simulés, comme la base
    { provide: AUDIT_LOG, useValue: {} },
  ],
  exports: [ENV, DATABASE, AUDIT_LOG],
})
class InfrastructureStub {}

const modules: [string, Type][] = [['DisputesModule (US-101)', DisputesModule]];

describe('Chaque module se construit avec ses propres fournisseurs', () => {
  it.each(modules)('%s', async (_, feature) => {
    @Module({ imports: [InfrastructureStub, feature] })
    class Root {}
    const app = await NestFactory.createApplicationContext(Root, {
      logger: false,
      abortOnError: false,
    });
    expect(app).toBeDefined();
    await app.close();
  });
});
