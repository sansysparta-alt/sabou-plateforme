// Lot A (US-012, US-013) : enchaînement des décisions (base, Keycloak, sessions, journal)
// et contrôles d'accès. Base et Keycloak simulés ; les requêtes SQL et le vrai Keycloak
// sont prouvés par les tests de bout en bout (apps/admin/e2e/comptes.spec.ts).
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ACCOUNT_ROLES, PHONE_ERROR, type InviteRequest } from '@sabou/types';
import { grantedRoles } from '@sabou/types/permissions';
import { AUDIT_LOG, type AuditEntry } from '../audit/audit.log';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { ENV, loadEnv } from '../config/env';
import { AccountsController, DirectorGuard, InvitationController } from './accounts.controller';
import { AccountsRepository, type PendingInvitation } from './accounts.repository';
import { AccountsService, digestToken } from './accounts.service';
import {
  IDENTITY_ADMIN,
  KEYCLOAK_ROLES,
  PasswordRejectedError,
  type IdentityAdmin,
} from './identity-admin';

const APP = 'http://localhost:5173';
const DG_SUB = '11111111-1111-4111-8111-111111111111';
const TARGET_SUB = '22222222-2222-4222-8222-222222222222';

// Base simulée : chaque transaction note son issue ; une décision annulée ne laisse rien
class FakeRepository {
  outcomes: string[] = [];
  invitations = new Map<string, PendingInvitation>();
  statuses = new Map<number, string>([[7, 'actif']]);
  activated: [number, string][] = [];
  failActivation = false;
  async transaction<T>(work: (trx: never) => Promise<T>): Promise<T> {
    const statuses = new Map(this.statuses);
    try {
      const result = await work(undefined as never);
      this.outcomes.push('COMMIT');
      return result;
    } catch (error) {
      this.statuses = statuses;
      this.outcomes.push('ROLLBACK');
      throw error;
    }
  }
  async userIdBySub(sub: string) {
    return sub === DG_SUB ? 1 : null;
  }
  invited: InviteRequest[] = [];
  async createInvited(_trx: never, input: InviteRequest) {
    this.invited.push(input);
    return 42;
  }
  async issueInvitation() {
    return new Date('2026-11-09T08:00:00Z');
  }
  async findInvitation(digest: Buffer) {
    return this.invitations.get(digest.toString('hex')) ?? null;
  }
  async activate(_trx: never, pending: PendingInvitation, id: string) {
    if (this.failActivation) throw new Error('base indisponible');
    this.activated.push([pending.accountId, id]);
  }
  async changeStatus(_trx: never, id: number, from: string, to: string) {
    if (this.statuses.get(id) !== from) return null;
    this.statuses.set(id, to);
    return { keycloakId: TARGET_SUB, email: 'cible@sabou-sante.gn' };
  }
  async statusOf(id: number) {
    return this.statuses.has(id) ? { status: this.statuses.get(id), role: 'regional' } : null;
  }
  async list() {
    return [];
  }
  async references() {
    return { regions: [], prefectures: [], languages: [] };
  }
}

const repository = new FakeRepository();
const idp = {
  createAccount: vi.fn<IdentityAdmin['createAccount']>(async () => TARGET_SUB),
  deleteAccount: vi.fn(async () => undefined),
  setEnabled: vi.fn(async () => undefined),
  logoutAccount: vi.fn(async () => undefined),
};
const sessions = {
  data: new Map<string, SessionData>(),
  revokeAccount: vi.fn(async () => undefined),
  restoreAccount: vi.fn(async () => undefined),
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
    controllers: [AccountsController, InvitationController],
    providers: [
      { provide: ENV, useValue: env },
      { provide: AccountsRepository, useValue: repository },
      { provide: IDENTITY_ADMIN, useValue: idp },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: AUDIT_LOG, useValue: audit },
      AccountsService,
      DirectorGuard,
    ],
  })
  class TestModule {}
  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

afterAll(() => app.close());

const session = (roles: string[], secondFactor = true, sub = DG_SUB): SessionData => ({
  sub,
  username: 'dg@sabou-sante.gn',
  name: 'Direction',
  roles,
  secondFactor,
  refreshToken: 'r',
  createdAt: Date.now(),
});

beforeEach(() => {
  repository.outcomes = [];
  repository.invitations.clear();
  repository.statuses = new Map([[7, 'actif']]);
  repository.activated = [];
  repository.failActivation = false;
  audit.entries = [];
  sessions.data = new Map([
    ['dg', session(['dg', 'administrateur'])],
    ['regional', session(['admin_regional', 'administrateur'], true, TARGET_SUB)],
    ['dg-sans-otp', session(['dg', 'administrateur'], false)],
    // Un compte par rôle, avec second facteur : matrice des droits (US-012b)
    ...ACCOUNT_ROLES.map(
      (role) => [`role-${role}`, session([KEYCLOAK_ROLES[role], 'administrateur'])] as const,
    ),
  ]);
  for (const mock of [...Object.values(idp), sessions.revokeAccount, sessions.restoreAccount]) {
    mock.mockClear();
  }
  idp.createAccount.mockImplementation(async () => TARGET_SUB);
  idp.setEnabled.mockImplementation(async () => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

function call(path: string, options: { as?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.as) headers.cookie = `${SESSION_COOKIE}=${options.as}`;
  const method = options.body === undefined && !path.includes('/') ? 'GET' : 'POST';
  if (method === 'POST') headers.origin = options.origin ?? APP;
  return fetch(`${base}/api/${path}`, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
  });
}

const invitation: InviteRequest = {
  email: 'fanta.conde@sabou-sante.gn',
  firstName: 'Fanta',
  lastName: 'Condé',
  phone: null,
  role: 'regional',
  regionId: 3,
  prefectureId: null,
  interfaceLanguage: 'fr',
  listeningLanguage: 'sou',
  languages: [{ code: 'sou', record: true, translate: false, validate: true }],
};

describe('Accès réservé à la DG (UC-65, R-ACC-04)', () => {
  it('401 sans session, 403 pour un autre rôle ou sans second facteur', async () => {
    expect((await call('comptes')).status).toBe(401);
    expect((await call('comptes', { as: 'regional' })).status).toBe(403);
    expect((await call('comptes', { as: 'dg-sans-otp' })).status).toBe(403);
    expect((await call('comptes', { as: 'dg' })).status).toBe(200);
  });

  it('matrice des droits : seuls les rôles du catalogue gèrent les comptes (US-012b)', async () => {
    const allowed: string[] = grantedRoles('users.manage');
    for (const role of ACCOUNT_ROLES) {
      const response = await call('comptes', { as: `role-${role}` });
      expect([role, response.status]).toEqual([role, allowed.includes(role) ? 200 : 403]);
    }
  });

  it('refuse une décision envoyée depuis un autre site (falsification de requête)', async () => {
    const response = await call('comptes', {
      as: 'dg',
      body: invitation,
      origin: 'https://pirate.example',
    });
    expect(response.status).toBe(403);
    expect(repository.outcomes).toEqual([]);
  });
});

describe('Invitation (US-012)', () => {
  it('renvoie un lien dont le jeton est dans le fragment, et journalise la décision', async () => {
    const response = await call('comptes', { as: 'dg', body: invitation });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { link: string; accountId: number };
    const link = new URL(body.link);
    expect(`${link.origin}${link.pathname}`).toBe(`${APP}/invitation`);
    expect(link.search).toBe('');
    expect(link.hash).toMatch(/^#[\w-]{43}$/);
    expect(body.accountId).toBe(42);
    expect(repository.outcomes).toEqual(['COMMIT']);
    expect(audit.entries).toMatchObject([
      {
        action: 'compte.invite',
        objectId: '42',
        account: DG_SUB,
        userId: 1,
        details: { role: 'regional', region: 3 },
      },
    ]);
  });

  it('téléphone facultatif : saisi librement, enregistré sous la forme +224 (US-012b)', async () => {
    const response = await call('comptes', {
      as: 'dg',
      body: { ...invitation, phone: ' 621 23.45-67 ' },
    });
    expect(response.status).toBe(201);
    expect(repository.invited.at(-1)).toMatchObject({ phone: '+224621234567' });
    await call('comptes', { as: 'dg', body: invitation });
    expect(repository.invited.at(-1)).toMatchObject({ phone: null });
  });

  it('refuse un téléphone qui n’est pas un mobile guinéen, sans rien écrire', async () => {
    const response = await call('comptes', { as: 'dg', body: { ...invitation, phone: '0123' } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string[] }).message).toEqual([PHONE_ERROR]);
    expect(repository.outcomes).toEqual([]);
  });

  it('refuse un rôle régional sans région (critère 2), sans rien écrire', async () => {
    const response = await call('comptes', { as: 'dg', body: { ...invitation, regionId: null } });
    expect(response.status).toBe(400);
    expect(repository.outcomes).toEqual([]);
  });
});

describe('Acceptation de l’invitation', () => {
  const token = randomBytes(32).toString('base64url');
  const pending: PendingInvitation = {
    invitationId: 9,
    accountId: 42,
    firstName: 'Fanta',
    lastName: 'Condé',
    email: 'fanta.conde@sabou-sante.gn',
    role: 'regional',
  };
  const accept = (password = 'Un-mot-de-passe-long-42') =>
    call('invitation/acceptation', { body: { token, password } });

  beforeEach(() => {
    repository.invitations.set(digestToken(token).toString('hex'), pending);
  });

  it('crée le compte Keycloak avec le rôle attribué, puis active le compte', async () => {
    expect((await accept()).status).toBe(204);
    expect(idp.createAccount).toHaveBeenCalledWith({
      username: pending.email,
      firstName: 'Fanta',
      lastName: 'Condé',
      role: 'regional',
      password: 'Un-mot-de-passe-long-42',
    });
    expect(repository.activated).toEqual([[42, TARGET_SUB]]);
    expect(audit.entries).toMatchObject([
      { action: 'compte.active', userId: 42, account: TARGET_SUB },
    ]);
    // Le mot de passe n'est jamais journalisé
    expect(JSON.stringify(audit.entries)).not.toContain('Un-mot-de-passe');
  });

  it('lien inconnu, expiré ou déjà utilisé : 410, aucun compte créé', async () => {
    repository.invitations.clear();
    expect((await accept()).status).toBe(410);
    expect(idp.createAccount).not.toHaveBeenCalled();
  });

  it('mot de passe refusé par Keycloak : 400 avec son message, rien d’activé', async () => {
    idp.createAccount.mockRejectedValueOnce(
      new PasswordRejectedError('Mot de passe invalide : longueur minimale de 12.'),
    );
    const response = await accept('court');
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toContain('12');
    expect(repository.outcomes).toEqual(['ROLLBACK']);
  });

  it('échec de la base après la création dans Keycloak : le compte Keycloak est supprimé', async () => {
    repository.failActivation = true;
    expect((await accept()).status).toBe(500);
    expect(idp.deleteAccount).toHaveBeenCalledWith(TARGET_SUB);
  });

  it('refuse un jeton mal formé et toute requête venue d’un autre site', async () => {
    expect(
      (await call('invitation/acceptation', { body: { token: 'x', password: 'p' } })).status,
    ).toBe(400);
    expect(
      (
        await call('invitation/acceptation', {
          body: { token, password: 'Un-mot-de-passe-long-42' },
          origin: 'https://pirate.example',
        })
      ).status,
    ).toBe(403);
  });
});

describe('Suspension et réactivation (US-013)', () => {
  it('suspend : sessions de l’API révoquées, Keycloak désactivé et déconnecté, journalisé', async () => {
    expect((await call('comptes/7/suspension', { as: 'dg' })).status).toBe(204);
    expect(sessions.revokeAccount).toHaveBeenCalledWith(TARGET_SUB);
    expect(idp.setEnabled).toHaveBeenCalledWith(TARGET_SUB, false);
    expect(idp.logoutAccount).toHaveBeenCalledWith(TARGET_SUB);
    expect(repository.statuses.get(7)).toBe('suspendu');
    expect(audit.entries).toMatchObject([
      { action: 'compte.suspendu', objectId: '7', account: DG_SUB, userId: 1 },
    ]);
  });

  it('Keycloak indisponible : suspension annulée, sessions rendues', async () => {
    idp.setEnabled.mockRejectedValueOnce(new Error('Keycloak : HTTP 503'));
    expect((await call('comptes/7/suspension', { as: 'dg' })).status).toBe(500);
    expect(repository.statuses.get(7)).toBe('actif');
    expect(repository.outcomes).toEqual(['ROLLBACK']);
    expect(sessions.restoreAccount).toHaveBeenCalledWith(TARGET_SUB);
  });

  it('refuse de suspendre un compte déjà suspendu, inconnu, ou le sien', async () => {
    repository.statuses.set(7, 'suspendu');
    expect((await call('comptes/7/suspension', { as: 'dg' })).status).toBe(409);
    expect((await call('comptes/99/suspension', { as: 'dg' })).status).toBe(404);
    expect((await call('comptes/1/suspension', { as: 'dg' })).status).toBe(400);
  });

  it('réactive : Keycloak réactivé, sessions de nouveau permises, journalisé', async () => {
    repository.statuses.set(7, 'suspendu');
    expect((await call('comptes/7/reactivation', { as: 'dg' })).status).toBe(204);
    expect(idp.setEnabled).toHaveBeenCalledWith(TARGET_SUB, true);
    expect(sessions.restoreAccount).toHaveBeenCalledWith(TARGET_SUB);
    expect(audit.entries).toMatchObject([{ action: 'compte.reactive', objectId: '7' }]);
  });
});
