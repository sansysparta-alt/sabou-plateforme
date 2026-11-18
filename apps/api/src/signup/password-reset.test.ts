// US-069 : mot de passe oublié par SMS (praticien et citoyen), à travers l'API, avec Keycloak,
// la base, Valkey et le fournisseur de SMS simulés. Le magasin réel (espace de clés séparé)
// est testé contre Valkey dans signup.store.test.ts.
// Critère 1 : numéro, code reçu par SMS, nouveau mot de passe (règles de US-014) ; réponse
//             identique que le numéro existe ou non.
// Critère 2 : code à usage unique, durée limitée, essais limités ; réinitialisation journalisée.
// Critère 3 : le double facteur n'est pas touché (seul le mot de passe est remplacé).
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PasswordRejectedError } from '../accounts/identity-admin';
import { AUDIT_LOG, type AuditEntry } from '../audit/audit.log';
import { ENV, loadEnv } from '../config/env';
import { SMS_SENDER, type SmsSender } from '../sms/sms';
import { CITIZEN_IDENTITY, type CitizenIdentity } from './citizen-identity';
import { MemoryStore } from './memory-store.fake';
import { PasswordResetController } from './password-reset.controller';
import { PASSWORD_RESET_STORE, PasswordResetService } from './password-reset.service';
import { SignupRepository } from './signup.repository';
import { LIMITS } from './signup.service';
import { SIGNUP_CODE_ATTEMPTS } from './signup.store';

const SITE = 'http://localhost:3000';
const KNOWN = '621234567';
const KEYCLOAK_ID = '0b9e3a52-6f43-4e0c-9c1f-5d2f8f4f6a10';

const store = new MemoryStore();
const sms = { sent: [] as { to: string; text: string }[] };
const smsSender: SmsSender = {
  send: async (to, text) => {
    sms.sent.push({ to, text });
  },
};
// Comptes Keycloak : identifiant → mot de passe, sessions ouvertes, double facteur
const identity = {
  passwords: new Map<string, string>(),
  sessions: new Map<string, number>(),
  otp: new Set<string>(),
  rejectNext: false,
  createAccount: vi.fn(async () => crypto.randomUUID()),
  deleteAccount: vi.fn(async () => undefined),
  resetPassword: vi.fn(async (id: string, password: string) => {
    if (identity.rejectNext) {
      identity.rejectNext = false;
      throw new PasswordRejectedError('Mot de passe refusé par les règles de sécurité.');
    }
    identity.passwords.set(id, password);
  }),
  signOutEverywhere: vi.fn(async (id: string) => {
    identity.sessions.set(id, 0);
  }),
} satisfies CitizenIdentity & Record<string, unknown>;
// Utilisateurs actifs du domaine public : numéro international → compte
const repository = {
  accounts: new Map<string, { id: number; keycloakId: string }>(),
  async findActiveAccount(phone: string) {
    return repository.accounts.get(phone) ?? null;
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
    SITE_URL: SITE,
    SMS_PROVIDER: 'journal',
    S3_ENDPOINT: 'http://seaweedfs:8333',
    OPENBAO_ADDR: 'https://openbao:8200',
    OPENBAO_TOKEN_FILE: '/run/openbao/jeton-api',
    S3_ACCESS_KEY: 'sabou',
    S3_SECRET_KEY: 's'.repeat(32),
    ADMIN_APP_URL: 'http://localhost:5173',
    VALKEY_URL: 'redis://localhost:6379',
  });
  @Module({
    controllers: [PasswordResetController],
    providers: [
      PasswordResetService,
      { provide: ENV, useValue: env },
      { provide: PASSWORD_RESET_STORE, useValue: store },
      { provide: SMS_SENDER, useValue: smsSender },
      { provide: CITIZEN_IDENTITY, useValue: identity },
      { provide: SignupRepository, useValue: repository },
      { provide: AUDIT_LOG, useValue: audit },
    ],
  })
  class TestModule {}
  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

afterAll(() => app.close());

beforeEach(() => {
  store.codes.clear();
  store.tickets.clear();
  store.counters.clear();
  sms.sent = [];
  identity.passwords.clear();
  identity.sessions.clear();
  identity.otp.clear();
  identity.rejectNext = false;
  identity.resetPassword.mockClear();
  identity.signOutEverywhere.mockClear();
  repository.accounts.clear();
  repository.accounts.set(`+224${KNOWN}`, { id: 42, keycloakId: KEYCLOAK_ID });
  identity.passwords.set(KEYCLOAK_ID, 'ancien-mot-de-passe');
  identity.sessions.set(KEYCLOAK_ID, 2);
  audit.entries = [];
});

function post(path: string, body: unknown, origin: string | null = SITE) {
  return fetch(`${base}/api/mot-de-passe-oublie/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
}

// L'envoi du SMS n'est pas attendu par l'API : on laisse passer la file des promesses
async function lastCode(): Promise<string> {
  await new Promise((resolve) => setImmediate(resolve));
  const text = sms.sent.at(-1)?.text ?? '';
  return /code est (\d{6})/.exec(text)?.[1] ?? '';
}

async function ticketFor(phone: string): Promise<string> {
  expect((await post('code', { phone })).status).toBe(202);
  const verified = await post('verification', { phone, code: await lastCode() });
  expect(verified.status).toBe(200);
  return ((await verified.json()) as { ticket: string }).ticket;
}

describe('Critère 1 : numéro, code reçu par SMS, nouveau mot de passe', () => {
  it('remplace le mot de passe après le bon code, ferme toutes les sessions', async () => {
    const ticket = await ticketFor(KNOWN);
    expect(sms.sent[0]).toMatchObject({ to: `+224${KNOWN}` });
    expect(sms.sent[0]!.text).toMatch(/changer votre mot de passe/);

    const done = await post('nouveau', { ticket, password: '40718293' });
    expect(done.status).toBe(204);
    expect(done.headers.get('cache-control')).toBe('no-store');
    expect(identity.passwords.get(KEYCLOAK_ID)).toBe('40718293');
    expect(identity.sessions.get(KEYCLOAK_ID)).toBe(0);
  });

  it('accepte l’application mobile (sans en-tête Origin), refuse une autre origine', async () => {
    expect((await post('code', { phone: KNOWN }, null)).status).toBe(202);
    for (const origin of ['https://autre.example', 'null']) {
      for (const path of ['code', 'verification', 'nouveau']) {
        expect((await post(path, { phone: KNOWN }, origin)).status).toBe(403);
      }
    }
    expect(sms.sent).toHaveLength(1);
  });

  it('applique les règles de US-014 au nouveau mot de passe, sans consommer le ticket', async () => {
    const ticket = await ticketFor(KNOWN);
    for (const password of ['1234567', '12345678', KNOWN, 'aaaaaaaa']) {
      const refused = await post('nouveau', { ticket, password });
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: string }).error).toBe('invalid');
    }
    expect(identity.resetPassword).not.toHaveBeenCalled();
    expect((await post('nouveau', { ticket, password: '40718293' })).status).toBe(204);
  });

  it('rend le ticket si Keycloak refuse le mot de passe', async () => {
    const ticket = await ticketFor(KNOWN);
    identity.rejectNext = true;
    expect((await post('nouveau', { ticket, password: '40718293' })).status).toBe(400);
    expect((await post('nouveau', { ticket, password: '50829304' })).status).toBe(204);
    expect(identity.passwords.get(KEYCLOAK_ID)).toBe('50829304');
  });

  it('numéro sans compte : même réponse, aucun SMS, aucun code valable', async () => {
    const unknown = await post('code', { phone: '661234567' });
    const known = await post('code', { phone: KNOWN });
    expect(unknown.status).toBe(known.status);
    expect(await unknown.text()).toBe(await known.text());
    await lastCode();
    expect(sms.sent.map((s) => s.to)).toEqual([`+224${KNOWN}`]);
    const verify = await post('verification', { phone: '661234567', code: '000000' });
    expect(((await verify.json()) as { error: string }).error).toBe('code_expired');
  });

  it('refuse un numéro qui n’est pas un mobile guinéen, sans SMS', async () => {
    expect((await post('code', { phone: '721234567' })).status).toBe(400);
    expect(sms.sent).toHaveLength(0);
  });
});

describe('Critère 2 : code à usage unique, durée et essais limités, journal', () => {
  it('le code ne sert qu’une fois, le ticket aussi', async () => {
    expect((await post('code', { phone: KNOWN })).status).toBe(202);
    const code = await lastCode();
    const first = await post('verification', { phone: KNOWN, code });
    expect(first.status).toBe(200);
    const again = await post('verification', { phone: KNOWN, code });
    expect(((await again.json()) as { error: string }).error).toBe('code_expired');

    const { ticket } = (await first.json()) as { ticket: string };
    expect((await post('nouveau', { ticket, password: '40718293' })).status).toBe(204);
    const reused = await post('nouveau', { ticket, password: '50829304' });
    expect(((await reused.json()) as { error: string }).error).toBe('ticket_invalid');
  });

  it(`efface le code après ${SIGNUP_CODE_ATTEMPTS} erreurs, en donnant les essais restants`, async () => {
    expect((await post('code', { phone: KNOWN })).status).toBe(202);
    const code = await lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    const first = (await (await post('verification', { phone: KNOWN, code: wrong })).json()) as {
      remainingAttempts: number;
    };
    expect(first.remainingAttempts).toBe(SIGNUP_CODE_ATTEMPTS - 1);
    for (let i = 1; i < SIGNUP_CODE_ATTEMPTS; i += 1) {
      await post('verification', { phone: KNOWN, code: wrong });
    }
    const late = await post('verification', { phone: KNOWN, code });
    expect(((await late.json()) as { error: string }).error).toBe('code_expired');
  });

  it(`limite à ${LIMITS.codePerPhone.limit} codes par numéro et par heure (Retry-After)`, async () => {
    for (let i = 0; i < LIMITS.codePerPhone.limit; i += 1) {
      expect((await post('code', { phone: KNOWN })).status).toBe(202);
    }
    const blocked = await post('code', { phone: KNOWN });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('limite aussi un numéro inconnu (pas de sondage illimité)', async () => {
    for (let i = 0; i < LIMITS.codePerPhone.limit; i += 1) {
      await post('code', { phone: '661234567' });
    }
    expect((await post('code', { phone: '661234567' })).status).toBe(429);
  });

  it('journalise chaque réinitialisation : compte, adresse, moyen', async () => {
    const ticket = await ticketFor(KNOWN);
    await post('nouveau', { ticket, password: '40718293' });
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'compte.mot_de_passe_reinitialise',
        objectType: 'utilisateur',
        objectId: '42',
        account: KEYCLOAK_ID,
        userId: 42,
        details: { moyen: 'sms', sessionsFermees: true },
      }),
    ]);
    expect(audit.entries[0]!.ip).toBeTruthy();
  });

  it('compte suspendu entre le code et le nouveau mot de passe : rien n’est changé', async () => {
    const ticket = await ticketFor(KNOWN);
    repository.accounts.clear();
    const refused = await post('nouveau', { ticket, password: '40718293' });
    expect(((await refused.json()) as { error: string }).error).toBe('ticket_invalid');
    expect(identity.resetPassword).not.toHaveBeenCalled();
    expect(audit.entries).toHaveLength(0);
  });
});

describe('Critère 3 : le double facteur reste exigé', () => {
  it('seul le mot de passe est remplacé : le second facteur du compte est conservé', async () => {
    identity.otp.add(KEYCLOAK_ID);
    const ticket = await ticketFor(KNOWN);
    await post('nouveau', { ticket, password: '40718293' });
    expect(identity.resetPassword).toHaveBeenCalledWith(KEYCLOAK_ID, '40718293');
    expect(identity.otp.has(KEYCLOAK_ID)).toBe(true);
  });
});
