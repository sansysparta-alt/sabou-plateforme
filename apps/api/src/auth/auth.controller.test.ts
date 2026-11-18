import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Logger, Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { sessionUserSchema } from '@sabou/types';
import { AUDIT_LOG, type AuditEntry, type AuditLog } from '../audit/audit.log';
import { ENV, loadEnv } from '../config/env';
import {
  AuthController,
  LOGIN_COOKIE,
  LOGIN_RECORDER,
  SESSION_COOKIE,
  safeReturnTo,
} from './auth.controller';
import {
  IDENTITY_PROVIDER,
  type IdentityClaims,
  type IdentityProvider,
  type LoginAction,
} from './identity-provider';
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
  async revokeAccount(sub: string) {
    for (const [id, data] of this.sessions) if (data.sub === sub) this.sessions.delete(id);
  }
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

// Journal d'audit simulé : garde les lignes ; peut être rendu indisponible
class MemoryAudit implements Pick<AuditLog, 'record'> {
  entries: AuditEntry[] = [];
  down = false;
  async record(entry: AuditEntry) {
    if (this.down) throw new Error('base indisponible');
    this.entries.push(entry);
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
  // Code à usage unique enregistré pendant la connexion : non, par défaut
  otpConfiguredSince = vi.fn<NonNullable<IdentityProvider['otpConfiguredSince']>>(
    async () => false,
  );
  async startLogin(returnTo: string, action?: LoginAction) {
    const state = randomBytes(16).toString('base64url');
    const tx = { state, nonce: 'n', codeVerifier: 'v', returnTo, startedAt: Date.now() };
    return { url: `http://keycloak.test/auth?state=${state}&action=${action ?? ''}`, tx };
  }
}

function identity(roles: string[], amr: string[]): IdentityClaims {
  return { sub: 'u-1', username: 'awa.camara', name: 'Awa Camara', roles, amr };
}

const store = new MemoryStore();
const idp = new FakeIdp();
const audit = new MemoryAudit();
// Utilisateurs de la plateforme simulés : aucun par défaut (compte Keycloak seul)
type PlatformAccount = { userId: number; status: string } | null;
const accounts: {
  account: PlatformAccount;
  recordLogin: Mock<(sub: string) => Promise<PlatformAccount>>;
} = {
  account: null as PlatformAccount,
  recordLogin: vi.fn<(sub: string) => Promise<PlatformAccount>>(
    async (): Promise<PlatformAccount> => accounts.account,
  ),
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
    controllers: [AuthController],
    providers: [
      { provide: ENV, useValue: env },
      { provide: IDENTITY_PROVIDER, useValue: idp },
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
  audit.entries = [];
  audit.down = false;
  accounts.account = null;
  accounts.recordLogin.mockClear();
  idp.logout.mockClear();
  idp.finishLogin.mockClear();
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
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

// Suit la relance de niveau 2 : retour de Keycloak sur la nouvelle transaction
async function followStepUp(step: Response, roles: string[], amr: string[], extra = '') {
  idp.claims = identity(roles, amr);
  const state = new URL(step.headers.get('location')!).searchParams.get('state')!;
  return fetch(`${base}/auth/callback?code=abc&state=${state}${extra}`, {
    redirect: 'manual',
    headers: { cookie: `${LOGIN_COOKIE}=${cookieValue(step, LOGIN_COOKIE)!}` },
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

  it('administrateur sans second facteur (il vient de l’activer) : relancé une fois au niveau 2, session Keycloak gardée (§2.28)', async () => {
    const response = await loginAs(['comite', 'administrateur'], ['pwd'], '/dossiers');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toMatch(
      /^http:\/\/keycloak\.test\/auth\?.*action=step-up$/,
    );
    expect(cookieValue(response, SESSION_COOKIE)).toBeUndefined();
    expect(cookieValue(response, LOGIN_COOKIE)).toBeDefined();
    expect(store.sessions.size).toBe(0);
    expect(idp.logout).not.toHaveBeenCalled();
    // La nouvelle transaction garde la page demandée et marque la relance
    expect([...store.logins.values()]).toEqual([
      expect.objectContaining({ returnTo: '/dossiers', stepUp: true }),
    ]);
  });

  it('administrateur qui vient de configurer et vérifier son code : session ouverte sans nouvelle demande', async () => {
    idp.otpConfiguredSince.mockResolvedValueOnce(true);
    const response = await loginAs(['comite', 'administrateur'], ['pwd'], '/dossiers');
    expect(response.headers.get('location')).toBe(`${APP}/dossiers?info=double-facteur`);
    expect(idp.otpConfiguredSince).toHaveBeenCalledWith('u-1', expect.any(Number));
    expect([...store.sessions.values()][0]).toMatchObject({ secondFactor: true });
  });

  it('vérification du code configuré impossible (Keycloak injoignable) : relance au niveau 2, comme avant', async () => {
    idp.otpConfiguredSince.mockRejectedValueOnce(new Error('injoignable'));
    const response = await loginAs(['comite', 'administrateur'], ['pwd']);
    expect(response.headers.get('location')).toMatch(/action=step-up$/);
    expect(store.sessions.size).toBe(0);
  });

  it('administrateur toujours sans second facteur après la relance : refusé, session Keycloak fermée (R-ACC-03)', async () => {
    const step = await loginAs(['comite', 'administrateur'], ['pwd']);
    const response = await followStepUp(step, ['comite', 'administrateur'], ['pwd']);
    expect(response.headers.get('location')).toBe(`${APP}/?erreur=double-facteur`);
    expect(cookieValue(response, SESSION_COOKIE)).toBeUndefined();
    expect(store.sessions.size).toBe(0);
    expect(idp.logout).toHaveBeenCalledWith('jeton-de-rafraichissement');
  });

  it('administrateur qui saisit le code à la relance : session ouverte, activation confirmée', async () => {
    const step = await loginAs(['comite', 'administrateur'], ['pwd'], '/dossiers');
    const response = await followStepUp(step, ['comite', 'administrateur'], ['pwd', 'otp']);
    expect(response.headers.get('location')).toBe(`${APP}/dossiers?info=double-facteur`);
    expect([...store.sessions.values()][0]).toMatchObject({ secondFactor: true });
  });

  it('praticien ou citoyen sans second facteur : accepté (proposé, pas imposé)', async () => {
    for (const role of ['praticien', 'citoyen']) {
      const response = await loginAs([role], ['pwd']);
      expect(response.headers.get('location')).toBe(`${APP}/`);
      expect(cookieValue(response, SESSION_COOKIE)).toBeDefined();
    }
    expect([...store.sessions.values()].every((s) => !s.secondFactor)).toBe(true);
  });

  it('praticien qui vient d’activer le double facteur : code demandé aussitôt, puis activation confirmée', async () => {
    const step = await loginAs(['praticien'], ['pwd'], '/?page=1', '&kc_action_status=success');
    expect(step.headers.get('location')).toMatch(/action=step-up$/);
    expect(store.sessions.size).toBe(0);
    const response = await followStepUp(step, ['praticien'], ['pwd', 'otp']);
    expect(response.headers.get('location')).toBe(`${APP}/?page=1&info=double-facteur`);
    expect([...store.sessions.values()][0]).toMatchObject({ secondFactor: true });
  });

  it('praticien qui abandonne la saisie du code : connecté au mot de passe seul, sans nouvelle relance', async () => {
    const step = await loginAs(['praticien'], ['pwd'], '/', '&kc_action_status=success');
    const response = await followStepUp(step, ['praticien'], ['pwd'], '&kc_action_status=success');
    expect(response.headers.get('location')).toBe(`${APP}/?info=double-facteur`);
    expect([...store.sessions.values()][0]).toMatchObject({ secondFactor: false });
  });

  it('activation annulée ou échouée dans Keycloak : pas de relance', async () => {
    const response = await loginAs(['praticien'], ['pwd'], '/', '&kc_action_status=cancelled');
    expect(response.headers.get('location')).toBe(`${APP}/`);
  });

  it('refuse un retour sans le cookie du navigateur qui a commencé la connexion ; l’application relance (US-019)', async () => {
    const start = await fetch(`${base}/auth/login`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const response = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
      redirect: 'manual',
    });
    // Aucun code échangé ; l'application de gestion relance une connexion neuve, une fois
    expect(response.headers.get('location')).toBe(`${APP}/?reprise=1`);
    expect(idp.finishLogin).not.toHaveBeenCalled();
  });

  it('refuse de rejouer une transaction de connexion déjà utilisée', async () => {
    const start = await fetch(`${base}/auth/login`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const headers = { cookie: `${LOGIN_COOKIE}=${cookieValue(start, LOGIN_COOKIE)}` };
    const url = `${base}/auth/callback?code=abc&state=${state}`;
    await fetch(url, { redirect: 'manual', headers });
    const replay = await fetch(url, { redirect: 'manual', headers });
    expect(replay.headers.get('location')).toBe(`${APP}/?reprise=1`);
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

// US-030 : toute connexion est journalisée (R-ACC-05) ; les échecs et blocages saisis
// dans Keycloak sont relevés par KeycloakEventsPoller
describe('Journal d’audit des connexions', () => {
  const ip = expect.stringMatching(/^(::ffff:)?127\.0\.0\.1$|^::1$/);

  it('connexion réussie : qui, quoi et IP', async () => {
    await loginAs(['dg', 'administrateur'], ['pwd', 'otp']);
    expect(audit.entries).toEqual([
      {
        action: 'connexion.reussie',
        objectType: 'compte',
        objectId: 'u-1',
        account: 'u-1',
        ip,
        details: { identifiant: 'awa.camara', second_facteur: true },
      },
    ]);
  });

  it('connexion refusée faute de second facteur, même après la relance : journalisée', async () => {
    const step = await loginAs(['comite', 'administrateur'], ['pwd']);
    // La relance elle-même n'est pas une connexion : rien au journal
    expect(audit.entries).toEqual([]);
    await followStepUp(step, ['comite', 'administrateur'], ['pwd']);
    expect(audit.entries).toMatchObject([
      {
        action: 'connexion.refusee',
        account: 'u-1',
        ip,
        details: { motif: 'double_facteur_absent' },
      },
    ]);
  });

  it('connexion réussie : reliée à l’utilisateur de la plateforme (lot A)', async () => {
    accounts.account = { userId: 3, status: 'actif' };
    await loginAs(['dg', 'administrateur'], ['pwd', 'otp']);
    expect(accounts.recordLogin).toHaveBeenCalledWith('u-1');
    expect(audit.entries).toMatchObject([{ action: 'connexion.reussie', userId: 3 }]);
  });

  it('compte suspendu dans la plateforme : refusé, journalisé, session Keycloak fermée (US-013)', async () => {
    accounts.account = { userId: 3, status: 'suspendu' };
    const response = await loginAs(['dg', 'administrateur'], ['pwd', 'otp']);
    expect(response.headers.get('location')).toBe(`${APP}/?erreur=connexion`);
    expect(store.sessions.size).toBe(0);
    expect(idp.logout).toHaveBeenCalledWith('jeton-de-rafraichissement');
    expect(audit.entries).toMatchObject([
      { action: 'connexion.refusee', userId: 3, details: { motif: 'compte_suspendu' } },
    ]);
  });

  it('journal indisponible : aucune session ouverte, session Keycloak fermée', async () => {
    audit.down = true;
    const response = await loginAs(['praticien'], ['pwd']);
    expect(response.headers.get('location')).toBe(`${APP}/?erreur=connexion`);
    expect(cookieValue(response, SESSION_COOKIE)).toBeUndefined();
    expect(store.sessions.size).toBe(0);
    expect(idp.logout).toHaveBeenCalledWith('jeton-de-rafraichissement');
  });

  it('déconnexion : journalisée ; close même si le journal est indisponible', async () => {
    const login = await loginAs(['praticien'], ['pwd']);
    const cookie = `${SESSION_COOKIE}=${cookieValue(login, SESSION_COOKIE)}`;
    audit.entries = [];
    await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie, origin: APP } });
    expect(audit.entries).toMatchObject([{ action: 'deconnexion', account: 'u-1', ip }]);

    const again = await loginAs(['praticien'], ['pwd']);
    audit.down = true;
    const response = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${cookieValue(again, SESSION_COOKIE)}`, origin: APP },
    });
    expect(response.status).toBe(204);
    expect(store.sessions.size).toBe(0);
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
