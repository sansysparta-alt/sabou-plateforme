// Lot C (US-020, US-021) : contrôle d'accès, validation, traduction des refus de la base et
// journal d'audit. Base simulée ; les règles de la base sont prouvées par
// packages/db/test/referentiels.test.ts, l'ensemble par apps/admin/e2e/referentiels.spec.ts.
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AUDIT_LOG, type AuditEntry } from '../audit/audit.log';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { ENV, loadEnv } from '../config/env';
import { DirectorGuard } from '../accounts/accounts.controller';
import { ReferentialsController } from './referentials.controller';
import { ReferentialsRepository } from './referentials.repository';
import { ReferentialsService } from './referentials.service';

const APP = 'http://localhost:5173';
const DG_SUB = '11111111-1111-4111-8111-111111111111';

// Base simulée : note les écritures et l'issue de chaque transaction
class FakeRepository {
  outcomes: string[] = [];
  writes: unknown[][] = [];
  failure: unknown = null;
  async transaction<T>(work: (trx: never) => Promise<T>): Promise<T> {
    try {
      const result = await work(undefined as never);
      this.outcomes.push('COMMIT');
      return result;
    } catch (error) {
      this.outcomes.push('ROLLBACK');
      throw error;
    }
  }
  async userIdBySub() {
    return 1;
  }
  private write(...args: unknown[]) {
    if (this.failure) throw this.failure;
    this.writes.push(args);
  }
  async all() {
    return {
      languages: [],
      naturalRegions: [],
      regions: [],
      prefectures: [],
      subPrefectures: [],
      specialties: [],
    };
  }
  async createLanguage(_trx: never, input: unknown) {
    this.write('createLanguage', input);
  }
  async updateLanguage(_trx: never, code: string, input: unknown) {
    this.write('updateLanguage', code, input);
    return code !== 'xx';
  }
  async createTerritory(_trx: never, level: string, name: string, parentId: number) {
    this.write('createTerritory', level, name, parentId);
    return 35;
  }
  async renameTerritory(_trx: never, level: string, id: number, name: string) {
    this.write('renameTerritory', level, id, name);
    return id === 999 ? null : 'Ancien nom';
  }
  async createSpecialty(_trx: never, input: unknown) {
    this.write('createSpecialty', input);
    return 9;
  }
  async updateSpecialty(_trx: never, id: number, input: unknown) {
    this.write('updateSpecialty', id, input);
    return true;
  }
}

const repository = new FakeRepository();
const sessions = {
  data: new Map<string, SessionData>(),
  async touch(id: string) {
    return this.data.get(id) ?? null;
  },
};
const audit = {
  entries: [] as AuditEntry[],
  async record(entry: AuditEntry) {
    audit.entries.push(entry);
  },
};

let app: INestApplication;
let base: string;

beforeAll(async () => {
  const env = loadEnv({
    DATABASE_URL: 'postgres://u:p@localhost:5432/sabou',
    SYNC_JWT_SECRET: randomBytes(32).toString('base64url'),
    KEYCLOAK_ISSUER: 'http://localhost:8080/realms/sabou',
    KEYCLOAK_ALLOW_HTTP: 'true',
    ADMIN_CLIENT_SECRET: randomBytes(32).toString('base64url'),
    AUDIT_CLIENT_SECRET: randomBytes(32).toString('base64url'),
    COMPTES_CLIENT_SECRET: randomBytes(32).toString('base64url'),
    PUBLIC_KEYCLOAK_ISSUER: 'http://localhost:8080/realms/sabou-public',
    SITE_CLIENT_SECRET: randomBytes(32).toString('base64url'),
    PUBLIC_AUDIT_CLIENT_SECRET: randomBytes(32).toString('base64url'),
    INSCRIPTION_CLIENT_SECRET: randomBytes(32).toString('base64url'),
    SITE_URL: 'http://localhost:3000',
    SMS_PROVIDER: 'journal',
    S3_ENDPOINT: 'http://seaweedfs:8333',
    OPENBAO_ADDR: 'https://openbao:8200',
    OPENBAO_TOKEN_FILE: '/run/openbao/jeton-api',
    S3_ACCESS_KEY: 'sabou',
    S3_SECRET_KEY: 's'.repeat(32),
    ADMIN_APP_URL: APP,
    VALKEY_URL: 'redis://localhost:6379',
  });
  @Module({
    controllers: [ReferentialsController],
    providers: [
      { provide: ENV, useValue: env },
      { provide: ReferentialsRepository, useValue: repository },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: AUDIT_LOG, useValue: audit },
      ReferentialsService,
      DirectorGuard,
    ],
  })
  class TestModule {}
  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

afterAll(() => app.close());

const session = (roles: string[], secondFactor = true): SessionData => ({
  sub: DG_SUB,
  username: 'dg@sabou-sante.gn',
  name: 'Direction',
  roles,
  secondFactor,
  refreshToken: 'r',
  createdAt: Date.now(),
});

beforeEach(() => {
  repository.outcomes = [];
  repository.writes = [];
  repository.failure = null;
  audit.entries = [];
  sessions.data = new Map([
    ['dg', session(['dg', 'administrateur'])],
    ['regional', session(['admin_regional', 'administrateur'])],
    ['dg-sans-otp', session(['dg', 'administrateur'], false)],
  ]);
});

function call(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  options: { as?: string; body?: unknown; origin?: string } = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.as) headers.cookie = `${SESSION_COOKIE}=${options.as}`;
  if (method !== 'GET') headers.origin = options.origin ?? APP;
  return fetch(`${base}/api/referentiels${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
  });
}

const kissi = {
  code: 'kis',
  iso6393: 'kss',
  name: 'Kissi',
  type: 'nationale',
  text: false,
  voice: true,
};

describe('Accès réservé à la DG', () => {
  it('sans session : 401 ; autre rôle ou DG sans second facteur : 403', async () => {
    expect((await call('GET', '')).status).toBe(401);
    expect((await call('GET', '', { as: 'regional' })).status).toBe(403);
    expect((await call('GET', '', { as: 'dg-sans-otp' })).status).toBe(403);
    expect((await call('GET', '', { as: 'dg' })).status).toBe(200);
  });

  it('une modification venue d’une autre origine est refusée, sans rien écrire', async () => {
    const response = await call('POST', '/langues', {
      as: 'dg',
      body: kissi,
      origin: 'https://ailleurs.example',
    });
    expect(response.status).toBe(403);
    expect(repository.writes).toEqual([]);
  });
});

describe('US-020 : langues', () => {
  it('ajoute une langue nationale, et journalise la décision dans la même transaction', async () => {
    const response = await call('POST', '/langues', { as: 'dg', body: { ...kissi, code: 'KIS' } });
    expect(response.status).toBe(204);
    expect(repository.writes).toEqual([['createLanguage', kissi]]);
    expect(repository.outcomes).toEqual(['COMMIT']);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'referentiel.langue_ajoutee',
        objectType: 'langue',
        objectId: 'kis',
        account: DG_SUB,
        userId: 1,
      }),
    ]);
  });

  it('refuse une langue nationale écrite (R-LNG-02) avant d’interroger la base', async () => {
    const response = await call('POST', '/langues', { as: 'dg', body: { ...kissi, text: true } });
    expect(response.status).toBe(400);
    expect((await response.json()).message.join(' ')).toContain('uniquement en voix');
    expect(repository.writes).toEqual([]);
  });

  it('active une langue ; une langue inconnue donne 404 et rien n’est journalisé', async () => {
    expect((await call('PATCH', '/langues/kis', { as: 'dg', body: { active: true } })).status).toBe(
      204,
    );
    expect(repository.writes).toEqual([['updateLanguage', 'kis', { active: true }]]);
    const missing = await call('PATCH', '/langues/xx', { as: 'dg', body: { active: true } });
    expect(missing.status).toBe(404);
    expect(repository.outcomes).toEqual(['COMMIT', 'ROLLBACK']);
    expect(audit.entries).toHaveLength(1);
  });

  it('traduit un refus de la base en message pour la DG', async () => {
    repository.failure = Object.assign(new Error('refus'), {
      code: '23514',
      constraint: 'ck_langue_region',
    });
    const response = await call('PATCH', '/langues/sou', { as: 'dg', body: { active: false } });
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('région naturelle');
  });

  it('refuse un champ inconnu (l’usage d’une langue ne se modifie pas)', async () => {
    const response = await call('PATCH', '/langues/en', { as: 'dg', body: { voice: true } });
    expect(response.status).toBe(400);
    expect(repository.writes).toEqual([]);
  });
});

describe('US-020 : territoires', () => {
  it('ajoute une sous-préfecture et renomme une préfecture, avec l’ancien nom au journal', async () => {
    expect(
      (
        await call('POST', '/sous-prefectures', {
          as: 'dg',
          body: { name: ' Tountouroun ', parentId: 4 },
        })
      ).status,
    ).toBe(204);
    expect(
      (await call('PATCH', '/prefectures/4', { as: 'dg', body: { name: 'Labé-Centre' } })).status,
    ).toBe(204);
    expect(repository.writes).toEqual([
      ['createTerritory', 'sous-prefectures', 'Tountouroun', 4],
      ['renameTerritory', 'prefectures', 4, 'Labé-Centre'],
    ]);
    expect(audit.entries[1]).toMatchObject({
      action: 'referentiel.territoire_renomme',
      objectType: 'prefecture',
      details: { avant: 'Ancien nom', apres: 'Labé-Centre' },
    });
  });

  it('refuse un niveau inconnu et un doublon (409)', async () => {
    expect(
      (await call('POST', '/communes', { as: 'dg', body: { name: 'X', parentId: 1 } })).status,
    ).toBe(400);
    repository.failure = Object.assign(new Error('doublon'), { code: '23505' });
    expect(
      (await call('POST', '/prefectures', { as: 'dg', body: { name: 'Labé', parentId: 4 } }))
        .status,
    ).toBe(409);
  });
});

describe('US-021 : spécialités', () => {
  it('ajoute, renomme et désactive une spécialité', async () => {
    const created = await call('POST', '/specialites', {
      as: 'dg',
      body: { code: 'ophtalmologie', labelFr: 'Maladies des yeux', labelEn: 'Eye diseases' },
    });
    expect(created.status).toBe(204);
    const updated = await call('PATCH', '/specialites/9', {
      as: 'dg',
      body: { labelEn: null, active: false },
    });
    expect(updated.status).toBe(204);
    expect(repository.writes[1]).toEqual(['updateSpecialty', 9, { labelEn: null, active: false }]);
    expect(audit.entries.map((e) => e.action)).toEqual([
      'referentiel.specialite_ajoutee',
      'referentiel.specialite_modifiee',
    ]);
  });
});
