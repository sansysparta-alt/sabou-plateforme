// Inscription d'un citoyen (lot D : US-014) : enchaînement des trois étapes à travers l'API,
// avec Keycloak, la base, Valkey et le fournisseur de SMS simulés (le magasin réel est
// testé contre Valkey dans signup.store.test.ts, le parcours complet dans le site public).
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AccountExistsError, PasswordRejectedError } from '../accounts/identity-admin';
import { AUDIT_LOG, type AuditEntry } from '../audit/audit.log';
import { ENV, loadEnv } from '../config/env';
import { CITIZEN_IDENTITY, type CitizenIdentity, type NewCitizen } from './citizen-identity';
import { SignupController } from './signup.controller';
import { SignupRepository } from './signup.repository';
import { LIMITS, SignupService } from './signup.service';
import {
  SIGNUP_CODE_ATTEMPTS,
  SIGNUP_STORE,
  type CodeCheck,
  type SignupStore,
} from './signup.store';
import { SMS_SENDER, type SmsSender } from './sms';

const SITE = 'http://localhost:3000';

// Même contrat que ValkeySignupStore, en mémoire
class MemoryStore implements SignupStore {
  codes = new Map<string, { code: string; attempts: number }>();
  tickets = new Map<string, string>();
  counters = new Map<string, number>();
  async hit(key: string, limit: number, windowSeconds: number) {
    const count = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, count);
    return count > limit ? windowSeconds : null;
  }
  async saveCode(phone: string, code: string) {
    this.codes.set(phone, { code, attempts: 0 });
  }
  async checkCode(phone: string, code: string): Promise<CodeCheck> {
    const entry = this.codes.get(phone);
    if (!entry) return { result: 'expired' };
    if (entry.code === code) {
      this.codes.delete(phone);
      return { result: 'valid' };
    }
    entry.attempts += 1;
    const remainingAttempts = SIGNUP_CODE_ATTEMPTS - entry.attempts;
    if (remainingAttempts <= 0) {
      this.codes.delete(phone);
      return { result: 'expired' };
    }
    return { result: 'invalid', remainingAttempts };
  }
  async issueTicket(phone: string) {
    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(ticket, phone);
    return ticket;
  }
  async peekTicket(ticket: string) {
    return this.tickets.get(ticket) ?? null;
  }
  async takeTicket(ticket: string) {
    const phone = this.tickets.get(ticket) ?? null;
    this.tickets.delete(ticket);
    return phone;
  }
  async restoreTicket(ticket: string, phone: string) {
    this.tickets.set(ticket, phone);
  }
}

const store = new MemoryStore();
const sms = { sent: [] as { to: string; text: string }[] } satisfies Record<string, unknown>;
const smsSender: SmsSender = {
  send: async (to, text) => {
    sms.sent.push({ to, text });
  },
};
const identity = {
  accounts: new Map<string, NewCitizen>(),
  failure: null as Error | null,
  createCitizen: vi.fn(async (citizen: NewCitizen) => {
    if (identity.failure) throw identity.failure;
    if ([...identity.accounts.values()].some((a) => a.username === citizen.username)) {
      throw new AccountExistsError();
    }
    const id = crypto.randomUUID();
    identity.accounts.set(id, citizen);
    return id;
  }),
  deleteAccount: vi.fn(async (id: string) => {
    identity.accounts.delete(id);
  }),
} satisfies CitizenIdentity & Record<string, unknown>;
// Utilisateurs de la plateforme : numéro international → identifiant
const repository = {
  citizens: new Map<string, { id: number; firstName: string; keycloakId: string }>(),
  down: false,
  async citizenExists(phone: string) {
    return repository.citizens.has(phone);
  },
  async transaction<T>(work: (trx: never) => Promise<T>) {
    return work(undefined as never);
  },
  async createCitizen(_trx: unknown, c: { phone: string; firstName: string; keycloakId: string }) {
    if (repository.down) throw new Error('base indisponible');
    const id = repository.citizens.size + 100;
    repository.citizens.set(c.phone, { id, firstName: c.firstName, keycloakId: c.keycloakId });
    return id;
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
    INSCRIPTION_CLIENT_SECRET: randomBytes(32).toString('base64url'),
    SITE_URL: SITE,
    SMS_PROVIDER: 'journal',
    ADMIN_APP_URL: 'http://localhost:5173',
    VALKEY_URL: 'redis://localhost:6379',
  });
  @Module({
    controllers: [SignupController],
    providers: [
      SignupService,
      { provide: ENV, useValue: env },
      { provide: SIGNUP_STORE, useValue: store },
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
  identity.accounts.clear();
  identity.failure = null;
  identity.createCitizen.mockClear();
  identity.deleteAccount.mockClear();
  repository.citizens.clear();
  repository.down = false;
  audit.entries = [];
});

function post(path: string, body: unknown, origin: string | null = SITE) {
  return fetch(`${base}/api/inscription/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
}

// Dernier code reçu par SMS (faux fournisseur)
function lastCode(): string {
  const text = sms.sent.at(-1)?.text ?? '';
  return /code est (\d{6})/.exec(text)?.[1] ?? '';
}

async function codeAndVerify(phone: string) {
  expect((await post('code', { phone })).status).toBe(202);
  return post('verification', { phone, code: lastCode() });
}

describe('Critère 1 : un numéro valide reçoit un code ; le compte est créé après le code', () => {
  it('envoie un code de 6 chiffres par SMS au numéro international, en français', async () => {
    const response = await post('code', { phone: '621 23 45 67' });
    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]!.to).toBe('+224621234567');
    expect(sms.sent[0]!.text).toMatch(
      /^SABOU : votre code est \d{6}\. Il expire dans 10 minutes\./,
    );
  });

  it('crée le compte (Keycloak, base, journal) après le bon code, le prénom et le mot de passe', async () => {
    const verified = await codeAndVerify('621234567');
    expect(verified.status).toBe(200);
    const result = (await verified.json()) as { status: string; ticket: string };
    expect(result.status).toBe('new');
    expect(identity.createCitizen).not.toHaveBeenCalled();

    const created = await post('compte', {
      ticket: result.ticket,
      firstName: ' Aïssatou ',
      password: '40718293',
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ status: 'created' });
    expect(identity.createCitizen).toHaveBeenCalledWith({
      username: '621234567',
      firstName: 'Aïssatou',
      password: '40718293',
    });
    const citizen = repository.citizens.get('+224621234567')!;
    expect(citizen.firstName).toBe('Aïssatou');
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'compte.inscription',
        objectId: String(citizen.id),
        account: citizen.keycloakId,
        userId: citizen.id,
      }),
    ]);
    // Le mot de passe n'est ni journalisé ni gardé par l'API
    expect(JSON.stringify(audit.entries)).not.toContain('40718293');
  });

  it('refuse un mauvais code, en donnant les essais restants, puis l’efface', async () => {
    await post('code', { phone: '621234567' });
    const wrong = lastCode() === '000000' ? '000001' : '000000';
    const first = await post('verification', { phone: '621234567', code: wrong });
    expect(first.status).toBe(400);
    expect(await first.json()).toMatchObject({
      error: 'code_invalid',
      remainingAttempts: SIGNUP_CODE_ATTEMPTS - 1,
    });
    for (let i = 1; i < SIGNUP_CODE_ATTEMPTS; i += 1) {
      await post('verification', { phone: '621234567', code: wrong });
    }
    const after = await post('verification', { phone: '621234567', code: lastCode() });
    expect(await after.json()).toMatchObject({ error: 'code_expired' });
  });

  it('refuse un numéro non guinéen ou non mobile, sans envoyer de SMS', async () => {
    for (const phone of ['301234567', '+33612345678', '6212345', 'abc']) {
      const response = await post('code', { phone });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid' });
    }
    expect(sms.sent).toHaveLength(0);
  });

  it('refuse un mot de passe trop faible, sans perdre le ticket', async () => {
    const { ticket } = (await (await codeAndVerify('621234567')).json()) as { ticket: string };
    for (const password of ['1234567', '12345678', '621234567']) {
      const refused = await post('compte', { ticket, firstName: 'Awa', password });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: 'invalid' });
    }
    expect(identity.createCitizen).not.toHaveBeenCalled();
    const created = await post('compte', { ticket, firstName: 'Awa', password: '40718293' });
    expect(await created.json()).toEqual({ status: 'created' });
  });

  it('rend le ticket si Keycloak refuse le mot de passe', async () => {
    const { ticket } = (await (await codeAndVerify('621234567')).json()) as { ticket: string };
    identity.failure = new PasswordRejectedError('Mot de passe refusé.');
    expect((await post('compte', { ticket, firstName: 'Awa', password: '40718293' })).status).toBe(
      400,
    );
    identity.failure = null;
    const created = await post('compte', { ticket, firstName: 'Awa', password: '40718293' });
    expect(await created.json()).toEqual({ status: 'created' });
  });

  it('n’accepte un ticket qu’une fois', async () => {
    const { ticket } = (await (await codeAndVerify('621234567')).json()) as { ticket: string };
    await post('compte', { ticket, firstName: 'Awa', password: '40718293' });
    const again = await post('compte', { ticket, firstName: 'Awa', password: '40718293' });
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: 'ticket_invalid' });
  });

  it('retire le compte Keycloak si la base échoue (ni compte orphelin, ni compte sans audit)', async () => {
    const { ticket } = (await (await codeAndVerify('621234567')).json()) as { ticket: string };
    repository.down = true;
    const response = await post('compte', { ticket, firstName: 'Awa', password: '40718293' });
    expect(response.status).toBe(500);
    expect(identity.deleteAccount).toHaveBeenCalledTimes(1);
    expect(identity.accounts.size).toBe(0);
  });
});

describe('Critère 2 : un numéro déjà inscrit se voit proposer de se connecter', () => {
  beforeEach(async () => {
    const { ticket } = (await (await codeAndVerify('621234567')).json()) as { ticket: string };
    await post('compte', { ticket, firstName: 'Awa', password: '40718293' });
    sms.sent = [];
    store.counters.clear();
  });

  it('répond « déjà inscrit » après le bon code, sans ticket', async () => {
    const verified = await codeAndVerify('621234567');
    expect(await verified.json()).toEqual({ status: 'existing' });
    expect(store.tickets.size).toBe(0);
  });

  it('ne révèle rien avant le code : même réponse et même SMS qu’un numéro nouveau', async () => {
    const known = await post('code', { phone: '621234567' });
    const unknown = await post('code', { phone: '629999999' });
    expect(known.status).toBe(unknown.status);
    expect(await known.text()).toBe(await unknown.text());
    expect(sms.sent.map((m) => m.to)).toEqual(['+224621234567', '+224629999999']);
  });

  it('répond « déjà inscrit » si le compte a été créé entre-temps (Keycloak 409)', async () => {
    const { ticket } = (await (await codeAndVerify('629999999')).json()) as { ticket: string };
    identity.failure = new AccountExistsError();
    const response = await post('compte', { ticket, firstName: 'Awa', password: '40718293' });
    expect(await response.json()).toEqual({ status: 'existing' });
  });
});

describe('Protections', () => {
  it('refuse une requête venue d’une autre origine (pas de SMS déclenché par un autre site)', async () => {
    for (const origin of [null, 'https://autre.example', 'http://localhost:5173']) {
      expect((await post('code', { phone: '621234567' }, origin)).status).toBe(403);
    }
    expect(sms.sent).toHaveLength(0);
  });

  it(`limite à ${LIMITS.codePerPhone.limit} codes par numéro et par heure (Retry-After)`, async () => {
    for (let i = 0; i < LIMITS.codePerPhone.limit; i += 1) {
      expect((await post('code', { phone: '621234567' })).status).toBe(202);
    }
    const refused = await post('code', { phone: '621234567' });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe(String(LIMITS.codePerPhone.windowSeconds));
    expect(await refused.json()).toMatchObject({ error: 'too_many' });
    expect(sms.sent).toHaveLength(LIMITS.codePerPhone.limit);
  });

  it(`limite à ${LIMITS.codePerIp.limit} codes par adresse IP et par heure`, async () => {
    for (let i = 0; i < LIMITS.codePerIp.limit; i += 1) {
      await post('code', { phone: `62${String(i).padStart(7, '0')}` });
    }
    expect((await post('code', { phone: '629999999' })).status).toBe(429);
    expect(sms.sent).toHaveLength(LIMITS.codePerIp.limit);
  });

  it('refuse les champs inconnus et un prénom qui n’est pas un prénom', async () => {
    expect((await post('code', { phone: '621234567', role: 'dg' })).status).toBe(400);
    const { ticket } = (await (await codeAndVerify('621234567')).json()) as { ticket: string };
    const response = await post('compte', { ticket, firstName: '<script>', password: '40718293' });
    expect(response.status).toBe(400);
  });
});
