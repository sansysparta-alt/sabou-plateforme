// Connexion des citoyens au site public (lot D : US-014) : même parcours que
// l'administration (auth.controller.test.ts), avec le domaine « sabou-public », les cookies
// du site et le numéro pré-rempli après l'inscription.
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AUDIT_LOG, type AuditEntry } from '../audit/audit.log';
import { ENV, loadEnv } from '../config/env';
import {
  AuthController,
  CITIZEN_IDENTITY_PROVIDER,
  CITIZEN_LOGIN_COOKIE,
  CITIZEN_SESSION_COOKIE,
  CitizenAuthController,
  LOGIN_RECORDER,
  SESSION_COOKIE,
} from './auth.controller';
import { IDENTITY_PROVIDER, type IdentityProvider, type LoginAction } from './identity-provider';
import {
  newSessionId,
  SESSION_STORE,
  type LoginTransaction,
  type SessionData,
  type SessionStore,
} from './session.store';

const SITE = 'http://localhost:3000';

class MemoryStore implements SessionStore {
  sessions = new Map<string, SessionData>();
  logins = new Map<string, LoginTransaction>();
  async create(data: SessionData) {
    const id = newSessionId();
    this.sessions.set(id, data);
    return id;
  }
  async touch(id: string) {
    return this.sessions.get(id) ?? null;
  }
  async destroy(id: string) {
    this.sessions.delete(id);
  }
  async revokeAccount() {}
  async restoreAccount() {}
  async saveLogin(tx: LoginTransaction) {
    this.logins.set(tx.state, tx);
  }
  async takeLogin(state: string) {
    const tx = this.logins.get(state) ?? null;
    this.logins.delete(state);
    return tx;
  }
}

function fakeIdp(username: string, roles: string[]) {
  return {
    hints: [] as (string | undefined)[],
    logout: vi.fn(async () => undefined),
    finishLogin: vi.fn<IdentityProvider['finishLogin']>(async () => ({
      claims: { sub: `${username}-sub`, username, name: 'Awa', roles, amr: ['pwd'] },
      refreshToken: 'jeton',
    })),
    async startLogin(returnTo: string, _action?: LoginAction, loginHint?: string) {
      this.hints.push(loginHint);
      const state = randomBytes(16).toString('base64url');
      return {
        url: 'http://keycloak.test/auth',
        tx: { state, nonce: 'n', codeVerifier: 'v', returnTo },
      };
    },
  };
}

const store = new MemoryStore();
const citizenIdp = fakeIdp('621234567', ['citoyen']);
const adminIdp = fakeIdp('dg@sabou.gn', ['dg', 'administrateur']);
const audit = {
  entries: [] as AuditEntry[],
  async record(entry: AuditEntry) {
    audit.entries.push(entry);
  },
};
const accounts = { recordLogin: vi.fn(async () => ({ userId: 42, status: 'actif' })) };
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
    SITE_URL: SITE,
    SMS_PROVIDER: 'journal',
    S3_ENDPOINT: 'http://seaweedfs:8333',
    S3_ACCESS_KEY: 'sabou',
    S3_SECRET_KEY: 's'.repeat(32),
    ADMIN_APP_URL: 'http://localhost:5173',
    VALKEY_URL: 'redis://localhost:6379',
  });
  @Module({
    controllers: [AuthController, CitizenAuthController],
    providers: [
      { provide: ENV, useValue: env },
      { provide: IDENTITY_PROVIDER, useValue: adminIdp },
      { provide: CITIZEN_IDENTITY_PROVIDER, useValue: citizenIdp },
      { provide: SESSION_STORE, useValue: store },
      { provide: AUDIT_LOG, useValue: audit },
      { provide: LOGIN_RECORDER, useValue: accounts },
    ],
  })
  class TestModule {}
  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

afterAll(() => app.close());

beforeEach(() => {
  store.sessions.clear();
  store.logins.clear();
  citizenIdp.hints = [];
  audit.entries = [];
});

const cookieValue = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0]
    ?.slice(name.length + 1);

// Connexion complète : /auth/citoyen/login puis retour de Keycloak sur /auth/citoyen/callback
async function citizenLogin(query = '') {
  const start = await fetch(`${base}/auth/citoyen/login${query}`, { redirect: 'manual' });
  const state = cookieValue(start, CITIZEN_LOGIN_COOKIE)!;
  return fetch(`${base}/auth/citoyen/callback?state=${state}&code=c`, {
    redirect: 'manual',
    headers: { cookie: `${CITIZEN_LOGIN_COOKIE}=${state}` },
  });
}

describe('Connexion du citoyen (lot D)', () => {
  it('ouvre une session sous le cookie du site et revient sur la page demandée', async () => {
    const callback = await citizenLogin('?returnTo=/compte');
    expect(callback.status).toBe(303);
    expect(callback.headers.get('location')).toBe(`${SITE}/compte`);
    const id = cookieValue(callback, CITIZEN_SESSION_COOKIE);
    expect(id).toBeTruthy();
    expect(cookieValue(callback, SESSION_COOKIE)).toBeUndefined();
    expect(callback.headers.getSetCookie().join()).toMatch(/HttpOnly.*Secure.*SameSite=Lax/i);

    const session = await fetch(`${base}/auth/citoyen/session`, {
      headers: { cookie: `${CITIZEN_SESSION_COOKIE}=${id}` },
    });
    expect(await session.json()).toMatchObject({ username: '621234567', roles: ['citoyen'] });
    expect(audit.entries.map((e) => e.action)).toEqual(['connexion.reussie']);
  });

  it('n’accepte pas la session du citoyen dans l’administration, ni l’inverse', async () => {
    const id = cookieValue(await citizenLogin(), CITIZEN_SESSION_COOKIE)!;
    const admin = await fetch(`${base}/auth/session`, {
      headers: { cookie: `${CITIZEN_SESSION_COOKIE}=${id}` },
    });
    expect(admin.status).toBe(401);
    const asAdminCookie = await fetch(`${base}/auth/citoyen/session`, {
      headers: { cookie: `${SESSION_COOKIE}=${id}` },
    });
    expect(asAdminCookie.status).toBe(401);
  });

  it('pré-remplit le numéro transmis par le site, s’il est valide', async () => {
    await fetch(`${base}/auth/citoyen/login?identifiant=621%2023%2045%2067`, {
      redirect: 'manual',
    });
    await fetch(`${base}/auth/citoyen/login?identifiant=%3Cscript%3E`, { redirect: 'manual' });
    await fetch(`${base}/auth/citoyen/login`, { redirect: 'manual' });
    expect(citizenIdp.hints).toEqual(['621234567', undefined, undefined]);
  });

  it('renvoie une erreur de connexion sur la page /connexion du site', async () => {
    const forged = await fetch(`${base}/auth/citoyen/callback?state=forge&code=c`, {
      redirect: 'manual',
    });
    expect(forged.headers.get('location')).toBe(`${SITE}/connexion?erreur=connexion`);
  });

  it('ne déconnecte que depuis le site', async () => {
    const id = cookieValue(await citizenLogin(), CITIZEN_SESSION_COOKIE)!;
    const foreign = await fetch(`${base}/auth/citoyen/logout`, {
      method: 'POST',
      headers: { cookie: `${CITIZEN_SESSION_COOKIE}=${id}`, origin: 'http://localhost:5173' },
    });
    expect(foreign.status).toBe(403);
    const own = await fetch(`${base}/auth/citoyen/logout`, {
      method: 'POST',
      headers: { cookie: `${CITIZEN_SESSION_COOKIE}=${id}`, origin: SITE },
    });
    expect(own.status).toBe(204);
    expect(store.sessions.size).toBe(0);
  });
});
