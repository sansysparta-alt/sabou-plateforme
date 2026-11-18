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
import { IDENTITY_ADMIN } from '../accounts/identity-admin';
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
  async createContraindication(_trx: never, input: unknown) {
    this.write('createContraindication', input);
    return 6;
  }
  async updateContraindication(_trx: never, id: number, input: unknown) {
    this.write('updateContraindication', id, input);
    return id !== 999;
  }
  // US-022 : la base renvoie l'aperçu ; une fusion de Labé suspend son admin préfectoral
  async previewRedistricting(input: { operation: string }) {
    if (this.failure) throw this.failure;
    return preview(input.operation);
  }
  async applyRedistricting(_trx: never, input: { operation: string }, actorId: number) {
    this.write('applyRedistricting', input, actorId);
    return preview(input.operation);
  }
  async keycloakIds(ids: number[]) {
    return ids.map((id) => `kc-${String(id)}`);
  }
}

const preview = (operation: string) => ({
  operation,
  object: 'Labé',
  before: 'Labé',
  target: 'Mamou',
  practitioners: 2,
  dossiers: 2,
  subPrefectures: 2,
  others: 1,
  administrators:
    operation === 'fusionner_prefectures'
      ? [
          {
            id: 3,
            name: 'Ibrahima Sow',
            email: 'p@x.gn',
            role: 'prefectoral',
            effect: 'suspendu',
          },
        ]
      : [],
});

const repository = new FakeRepository();
const sessions = {
  data: new Map<string, SessionData>(),
  async touch(id: string) {
    return this.data.get(id) ?? null;
  },
  revoked: [] as string[],
  async revokeAccount(sub: string) {
    sessions.revoked.push(sub);
  },
  async restoreAccount(sub: string) {
    sessions.revoked = sessions.revoked.filter((s) => s !== sub);
  },
};
const idp = {
  disabled: new Set<string>(),
  failure: null as unknown,
  async setEnabled(id: string, enabled: boolean) {
    if (enabled) idp.disabled.delete(id);
    else idp.disabled.add(id);
  },
  async logoutAccount() {
    if (idp.failure) throw idp.failure;
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
      { provide: IDENTITY_ADMIN, useValue: idp },
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
  sessions.revoked = [];
  idp.disabled = new Set();
  idp.failure = null;
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

describe('US-022 : redécoupage administratif', () => {
  const merge = { operation: 'fusionner_prefectures', objectId: 4, targetId: 5 };

  it('l’aperçu montre ce qui bouge, sans rien écrire ni journaliser', async () => {
    const response = await call('POST', '/redecoupage/apercu', { as: 'dg', body: merge });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ practitioners: 2, dossiers: 2 });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(repository.writes).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  it('une fusion est journalisée avec ce qui a bougé, et les comptes suspendus perdent leurs accès', async () => {
    const response = await call('POST', '/redecoupage', { as: 'dg', body: merge });
    expect(response.status).toBe(200);
    expect(repository.writes).toEqual([['applyRedistricting', merge, 1]]);
    expect(repository.outcomes).toEqual(['COMMIT']);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'referentiel.redecoupage',
        objectType: 'prefecture',
        objectId: '4',
        userId: 1,
        details: expect.objectContaining({ operation: 'fusionner_prefectures', targetId: 5 }),
      }),
    ]);
    expect(sessions.revoked).toEqual(['kc-3']);
    expect([...idp.disabled]).toEqual(['kc-3']);
  });

  it('si Keycloak échoue, tout est annulé et le compte retrouve ses accès', async () => {
    idp.failure = new Error('Keycloak indisponible');
    expect((await call('POST', '/redecoupage', { as: 'dg', body: merge })).status).toBe(500);
    expect(repository.outcomes).toEqual(['ROLLBACK']);
    expect(sessions.revoked).toEqual([]);
    expect([...idp.disabled]).toEqual([]);
  });

  it('un découpage de sous-préfecture est journalisé sur la sous-préfecture', async () => {
    const body = { operation: 'rattacher_sous_prefecture', objectId: 2, targetId: 7 };
    expect((await call('POST', '/redecoupage', { as: 'dg', body })).status).toBe(200);
    expect(audit.entries[0]).toMatchObject({ objectType: 'sous_prefecture', objectId: '2' });
    expect(sessions.revoked).toEqual([]);
  });

  it('refuse une opération inconnue avant la base, et un autre rôle que la DG', async () => {
    const unknown = { operation: 'supprimer', objectId: 4, targetId: 5 };
    expect((await call('POST', '/redecoupage', { as: 'dg', body: unknown })).status).toBe(400);
    expect((await call('POST', '/redecoupage', { as: 'regional', body: merge })).status).toBe(403);
    expect(repository.writes).toEqual([]);
  });

  it('traduit les refus de la base : rien ne change (400), territoire inconnu (404)', async () => {
    repository.failure = Object.assign(new Error('identique'), {
      code: '23514',
      constraint: 'ck_redecoupage_identique',
    });
    const same = await call('POST', '/redecoupage/apercu', { as: 'dg', body: merge });
    expect(same.status).toBe(400);
    expect(((await same.json()) as { message: string }).message).toMatch(/Rien ne change/);
    repository.failure = Object.assign(new Error('inconnu'), { code: 'P0002' });
    expect((await call('POST', '/redecoupage/apercu', { as: 'dg', body: merge })).status).toBe(404);
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

describe('US-063 : contre-indications structurées, liste paramétrable par la DG', () => {
  it('ajoute, renomme et désactive une contre-indication, tracé au journal', async () => {
    const created = await call('POST', '/contre-indications', {
      as: 'dg',
      body: { code: 'insuffisance_renale', labelFr: 'Insuffisance rénale', labelEn: null },
    });
    expect(created.status).toBe(204);
    const updated = await call('PATCH', '/contre-indications/6', {
      as: 'dg',
      body: { active: false },
    });
    expect(updated.status).toBe(204);
    expect(repository.writes).toEqual([
      [
        'createContraindication',
        { code: 'insuffisance_renale', labelFr: 'Insuffisance rénale', labelEn: null },
      ],
      ['updateContraindication', 6, { active: false }],
    ]);
    expect(audit.entries.map((e) => e.action)).toEqual([
      'referentiel.contre_indication_ajoutee',
      'referentiel.contre_indication_modifiee',
    ]);
  });

  it('inconnue : 404 ; code mal formé : 400 ; libellé déjà pris : 409', async () => {
    expect(
      (await call('PATCH', '/contre-indications/999', { as: 'dg', body: { active: true } })).status,
    ).toBe(404);
    expect(
      (
        await call('POST', '/contre-indications', {
          as: 'dg',
          body: { code: 'Rein!', labelFr: 'Rein', labelEn: null },
        })
      ).status,
    ).toBe(400);
    repository.failure = Object.assign(new Error('doublon'), { code: '23505' });
    expect(
      (
        await call('POST', '/contre-indications', {
          as: 'dg',
          body: { code: 'grossesse_bis', labelFr: 'Grossesse', labelEn: null },
        })
      ).status,
    ).toBe(409);
  });
});
