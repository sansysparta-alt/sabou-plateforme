import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { sessionUserSchema } from '@sabou/types';
import { ENV, loadEnv } from '../config/env';
import { AuthController, LOGIN_COOKIE, SESSION_COOKIE, safeReturnTo } from './auth.controller';
import { IDENTITY_PROVIDER, type IdentityClaims, type IdentityProvider } from './identity-provider';
import {
  newSessionId,
  SESSION_STORE,
  type LoginTransaction,
  type SessionData,
  type SessionStore,
} from './session.store';

const APP = 'http://localhost:5173';

// Sessions en mémoire, même contrat que Valkey
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
  async saveLogin(tx: LoginTransaction) {
    this.logins.set(tx.state, tx);
  }
  async takeLogin(state: string) {
    const tx = this.logins.get(state) ?? null;
    this.logins.delete(state);
    return tx;
  }
}

// Keycloak simulé : les identités renvoyées sont choisies par chaque test
class FakeIdp implements IdentityProvider {
  claims: IdentityClaims = identity(['praticien'], ['pwd']);
  logout = vi.fn(async () => undefined);
  finishLogin = vi.fn<IdentityProvider['finishLogin']>(async () => ({
    claims: this.claims,
    refreshToken: 'jeton-de-rafraichissement',
  }));
  async startLogin(returnTo: string, action?: 'configure-totp') {
    const state = randomBytes(16).toString('base64url');
    const tx = { state, nonce: 'n', codeVerifier: 'v', returnTo };
    return { url: `http://keycloak.test/auth?state=${state}&action=${action ?? ''}`, tx };
  }
}

function identity(roles: string[], amr: string[]): IdentityClaims {
  return { sub: 'u-1', username: 'awa.camara', name: 'Awa Camara', roles, amr };
}

const store = new MemoryStore();
const idp = new FakeIdp();
let app: INestApplication;
let base: string;

beforeAll(async () => {
  const env = loadEnv({
    DATABASE_URL: 'postgres://u:p@localhost:5432/sabou',
    SYNC_JWT_SECRET: randomBytes(32).toString('base64url'),
    KEYCLOAK_ISSUER: 'http://localhost:8080/realms/sabou',
    KEYCLOAK_ALLOW_HTTP: 'true',
    ADMIN_CLIENT_SECRET: randomBytes(32).toString('base64url'),
    ADMIN_APP_URL: APP,
    VALKEY_URL: 'redis://localhost:6379',
  });
  @Module({
    controllers: [AuthController],
    providers: [
      { provide: ENV, useValue: env },
      { provide: IDENTITY_PROVIDER, useValue: idp },
      { provide: SESSION_STORE, useValue: store },
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
  idp.logout.mockClear();
  idp.finishLogin.mockClear();
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function cookieValue(response: Response, name: string): string | undefined {
  const line = setCookies(response).find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0]!.slice(name.length + 1) || undefined;
}

// Démarre une connexion et revient de Keycloak avec le même navigateur
async function loginAs(roles: string[], amr: string[], returnTo = '/', extra = '') {
  idp.claims = identity(roles, amr);
  const start = await fetch(`${base}/auth/login?returnTo=${encodeURIComponent(returnTo)}`, {
    redirect: 'manual',
  });
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const loginCookie = cookieValue(start, LOGIN_COOKIE)!;
  return fetch(`${base}/auth/callback?code=abc&state=${state}${extra}`, {
    redirect: 'manual',
    headers: { cookie: `${LOGIN_COOKIE}=${loginCookie}` },
  });
}

describe('GET /auth/login', () => {
  it('redirige vers Keycloak et lie la connexion au navigateur par un cookie protégé', async () => {
    const response = await fetch(`${base}/auth/login`, { redirect: 'manual' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toMatch(/^http:\/\/keycloak\.test\/auth\?state=/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const cookie = setCookies(response).find((c) => c.startsWith(`${LOGIN_COOKIE}=`))!;
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Path=\//);
    expect(store.logins.size).toBe(1);
  });

  it("transmet la demande d'activation du double facteur, et elle seule", async () => {
    const totp = await fetch(`${base}/auth/login?action=configure-totp`, { redirect: 'manual' });
    expect(totp.headers.get('location')).toMatch(/action=configure-totp$/);
    const other = await fetch(`${base}/auth/login?action=delete_account`, { redirect: 'manual' });
    expect(other.headers.get('location')).toMatch(/action=$/);
  });
});

describe('GET /auth/callback', () => {
  it('administrateur avec second facteur : session ouverte, cookie HttpOnly, retour à la page demandée', async () => {
    const response = await loginAs(['dg', 'administrateur'], ['pwd', 'otp'], '/dossiers?page=2');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${APP}/dossiers?page=2`);
    const cookie = setCookies(response).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).not.toMatch(/Max-Age|Expires/);
    expect([...store.sessions.values()][0]).toMatchObject({ sub: 'u-1', secondFactor: true });
  });

  it('administrateur sans second facteur : refusé, session Keycloak fermée (R-ACC-03)', async () => {
    const response = await loginAs(['comite', 'administrateur'], ['pwd']);
    expect(response.headers.get('location')).toBe(`${APP}/?erreur=double-facteur`);
    expect(cookieValue(response, SESSION_COOKIE)).toBeUndefined();
    expect(store.sessions.size).toBe(0);
    expect(idp.logout).toHaveBeenCalledWith('jeton-de-rafraichissement');
  });

  it('praticien ou citoyen sans second facteur : accepté (proposé, pas imposé)', async () => {
    for (const role of ['praticien', 'citoyen']) {
      const response = await loginAs([role], ['pwd']);
      expect(response.headers.get('location')).toBe(`${APP}/`);
      expect(cookieValue(response, SESSION_COOKIE)).toBeDefined();
    }
    expect([...store.sessions.values()].every((s) => !s.secondFactor)).toBe(true);
  });

  it("signale à l'application la réussite de l'activation du double facteur", async () => {
    const response = await loginAs(['praticien'], ['pwd'], '/?page=1', '&kc_action_status=success');
    expect(response.headers.get('location')).toBe(`${APP}/?page=1&info=double-facteur`);
  });

  it('refuse un retour sans le cookie du navigateur qui a commencé la connexion', async () => {
    const start = await fetch(`${base}/auth/login`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const response = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
      redirect: 'manual',
    });
    expect(response.headers.get('location')).toBe(`${APP}/?erreur=connexion`);
    expect(idp.finishLogin).not.toHaveBeenCalled();
  });

  it('refuse de rejouer une transaction de connexion déjà utilisée', async () => {
    const start = await fetch(`${base}/auth/login`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const headers = { cookie: `${LOGIN_COOKIE}=${cookieValue(start, LOGIN_COOKIE)}` };
    const url = `${base}/auth/callback?code=abc&state=${state}`;
    await fetch(url, { redirect: 'manual', headers });
    const replay = await fetch(url, { redirect: 'manual', headers });
    expect(replay.headers.get('location')).toBe(`${APP}/?erreur=connexion`);
    expect(idp.finishLogin).toHaveBeenCalledTimes(1);
  });

  it("renvoie vers l'application avec un motif quand l'échange du code échoue", async () => {
    idp.finishLogin.mockRejectedValueOnce(new Error('signature invalide'));
    const response = await loginAs(['praticien'], ['pwd']);
    expect(response.headers.get('location')).toBe(`${APP}/?erreur=connexion`);
    expect(store.sessions.size).toBe(0);
  });
});

describe('GET /auth/session', () => {
  it('401 sans cookie ou avec un cookie inconnu', async () => {
    expect((await fetch(`${base}/auth/session`)).status).toBe(401);
    const forged = await fetch(`${base}/auth/session`, {
      headers: { cookie: `${SESSION_COOKIE}=${newSessionId()}` },
    });
    expect(forged.status).toBe(401);
  });

  it("renvoie l'utilisateur, sans aucun jeton", async () => {
    const login = await loginAs(['dg', 'administrateur'], ['pwd', 'otp']);
    const response = await fetch(`${base}/auth/session`, {
      headers: { cookie: `${SESSION_COOKIE}=${cookieValue(login, SESSION_COOKIE)}` },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body: unknown = await response.json();
    expect(sessionUserSchema.strict().parse(body)).toEqual({
      username: 'awa.camara',
      name: 'Awa Camara',
      roles: ['dg', 'administrateur'],
      administrator: true,
      secondFactor: true,
    });
    expect(JSON.stringify(body)).not.toContain('jeton');
  });
});

describe('POST /auth/logout', () => {
  it("refuse une requête venue d'un autre site (falsification de requête)", async () => {
    const login = await loginAs(['praticien'], ['pwd']);
    const cookie = `${SESSION_COOKIE}=${cookieValue(login, SESSION_COOKIE)}`;
    const response = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { cookie, origin: 'https://site-malveillant.example' },
    });
    expect(response.status).toBe(403);
    expect(store.sessions.size).toBe(1);
  });

  it('ferme la session de l’API et celle de Keycloak, puis efface le cookie', async () => {
    const login = await loginAs(['praticien'], ['pwd']);
    const cookie = `${SESSION_COOKIE}=${cookieValue(login, SESSION_COOKIE)}`;
    const response = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { cookie, origin: APP },
    });
    expect(response.status).toBe(204);
    expect(store.sessions.size).toBe(0);
    expect(idp.logout).toHaveBeenCalledWith('jeton-de-rafraichissement');
    expect(setCookies(response).find((c) => c.startsWith(`${SESSION_COOKIE}=`))).toMatch(
      /Expires=Thu, 01 Jan 1970/,
    );
  });
});

describe('safeReturnTo', () => {
  it("n'accepte qu'un chemin interne", () => {
    expect(safeReturnTo('/dossiers?page=2')).toBe('/dossiers?page=2');
    for (const value of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      '',
      3,
      undefined,
      '/a b',
    ]) {
      expect(safeReturnTo(value)).toBe('/');
    }
  });
});
