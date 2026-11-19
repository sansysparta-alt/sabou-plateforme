// US-100 : signalements à travers l'API (dépôt public protégé, accès du Comité, contrôle des
// saisies, traduction des refus). Base simulée ; décisions, cloisonnement et effacement des
// contacts sont prouvés sur un vrai PostgreSQL (packages/db/test/signalements.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { MemoryStore } from '../signup/memory-store.fake';
import {
  HEALTH_REPORT_STORE,
  HealthReportsController,
  PublicHealthReportsController,
  REPORT_LIMIT,
} from './health-reports.controller';
import {
  HealthReportClosedError,
  HealthReportDecisionRefusedError,
  HealthReportNotAllowedError,
  HealthReportsRepository,
  HealthReportUnknownObjectError,
  SuspensionLiftBlockedError,
} from './health-reports.repository';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:3000';
const SUB = '61616161-6161-4161-8161-616161616161';

const calls: unknown[][] = [];
let failure: Error | null = null;
const repository = {
  async deposit(input: unknown) {
    calls.push(['deposit', input]);
    if (failure) throw failure;
    return 'SIG-00042';
  },
  async queue(sub: string, query: unknown) {
    calls.push(['queue', sub, query]);
    if (failure) throw failure;
    return { elements: [], suivant: null, total: 0 };
  },
  async decide(sub: string, _ip: unknown, reference: string, decision: string, motif: string) {
    calls.push(['decide', sub, reference, decision, motif]);
    if (failure) throw failure;
  },
  async suspended(sub: string) {
    calls.push(['suspended', sub]);
    if (failure) throw failure;
    return [];
  },
  async liftSuspension(sub: string, _ip: unknown, code: string, motif: string) {
    calls.push(['lift', sub, code, motif]);
    if (failure) throw failure;
  },
};
const session = (roles: string[], secondFactor = true): SessionData => ({
  sub: SUB,
  username: 'comite@sabou-sante.gn',
  name: 'Aïssatou Bah',
  roles,
  secondFactor,
  refreshToken: 'r',
  createdAt: Date.now(),
});
const sessions = {
  data: new Map<string, SessionData>(),
  async touch(id: string) {
    return this.data.get(id) ?? null;
  },
};
let store: MemoryStore;

let app: INestApplication;
let base: string;

beforeAll(async () => {
  store = new MemoryStore();
  @Module({
    controllers: [PublicHealthReportsController, HealthReportsController],
    providers: [
      AdministratorGuard,
      { provide: HealthReportsRepository, useValue: repository },
      { provide: SESSION_STORE, useValue: sessions },
      {
        provide: HEALTH_REPORT_STORE,
        useValue: { hit: (...a: [string, number, number]) => store.hit(...a) },
      },
      {
        provide: ENV,
        useValue: { ADMIN_APP_URL: `${APP_ORIGIN}/`, SITE_URL: `${SITE_ORIGIN}/` } as Env,
      },
    ],
  })
  class TestModule {}
  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

afterAll(() => app.close());

beforeEach(() => {
  calls.length = 0;
  failure = null;
  store.counters.clear();
  sessions.data = new Map([
    ['comite', session(['scientifique', 'administrateur'])],
    ['sans-facteur', session(['scientifique', 'administrateur'], false)],
  ]);
});

const REPORT = {
  type: 'danger',
  code: 'rec-2041',
  gravite: 'grave',
  description: 'Vomissements après la première prise.',
  contact: '622 00 00 00',
};

function deposit(body: unknown, origin: string | null = SITE_ORIGIN) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) headers['origin'] = origin;
  return fetch(`${base}/api/signalements`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function call(path: string, body?: unknown, cookie: string | null = 'comite', origin = APP_ORIGIN) {
  const headers: Record<string, string> = { origin };
  if (cookie) headers['cookie'] = `${SESSION_COOKIE}=${cookie}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${base}/api/signalements/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('Dépôt public, sans compte (page /signaler)', () => {
  it('signalement enregistré : référence remise, saisie nettoyée, jamais mis en cache', async () => {
    const response = await deposit(REPORT);
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ reference: 'SIG-00042' });
    expect(calls).toEqual([['deposit', { ...REPORT, code: 'REC-2041' }]]);
  });

  it('leurre rempli (robot) : même réponse, rien n’est enregistré', async () => {
    const response = await deposit({ ...REPORT, site: 'http://spam.example' });
    expect(response.status).toBe(201);
    expect((await response.json()) as object).toEqual({
      reference: expect.stringMatching(/^SIG-\d{5}$/) as string,
    });
    expect(calls).toEqual([]);
  });

  it('limite par adresse IP : 429 avec le délai d’attente', async () => {
    for (let i = 0; i < REPORT_LIMIT.limit; i += 1) {
      expect((await deposit(REPORT)).status).toBe(201);
    }
    const refused = await deposit(REPORT);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe(String(REPORT_LIMIT.windowSeconds));
    expect(calls).toHaveLength(REPORT_LIMIT.limit);
  });

  it('autre site : 403 ; saisie invalide : 400 avec le message ; code inconnu : 400', async () => {
    expect((await deposit(REPORT, 'https://evil.example')).status).toBe(403);
    const invalid = await deposit({ ...REPORT, description: 'Court' });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      message: expect.stringContaining('10 caractères'),
    });
    failure = new HealthReportUnknownObjectError();
    const unknown = await deposit(REPORT);
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ message: expect.stringContaining('ce code') });
  });
});

describe('Critère : file du Comité, graves en tête (ordre tenu par la base)', () => {
  it('sans session : 401 ; sans second facteur : 403 ; file transmise, jamais mise en cache', async () => {
    expect((await call('a-traiter', undefined, null)).status).toBe(401);
    expect((await call('a-traiter', undefined, 'sans-facteur')).status).toBe(403);
    const response = await call('a-traiter?limite=10&q=REC');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(calls).toEqual([['queue', SUB, { limite: 10, q: 'REC' }]]);
  });

  it('autre profil que le Comité : 403', async () => {
    failure = new HealthReportNotAllowedError();
    expect((await call('a-traiter')).status).toBe(403);
  });
});

describe('Critère : décision motivée (aucune action, révision, suspension, retrait)', () => {
  it('décision et motif transmis ; motif vide ou décision inconnue : 400', async () => {
    const response = await call('SIG-00001/decision', {
      decision: 'suspension',
      motif: ' Danger ',
    });
    expect(response.status).toBe(204);
    expect(calls).toEqual([['decide', SUB, 'SIG-00001', 'suspension', 'Danger']]);
    expect((await call('SIG-00001/decision', { decision: 'suspension', motif: '' })).status).toBe(
      400,
    );
    expect((await call('SIG-00001/decision', { decision: 'oublier', motif: 'x' })).status).toBe(
      400,
    );
    expect((await call('nimporte/decision', { decision: 'retrait', motif: 'x' })).status).toBe(400);
  });

  it.each([
    [new HealthReportClosedError(), 409, 'stale'],
    [new HealthReportDecisionRefusedError(), 409, 'refused'],
  ])('refus de la base %s : %i', async (error, status, code) => {
    failure = error;
    const response = await call('SIG-00001/decision', { decision: 'retrait', motif: 'x' });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: code });
  });

  it('décision envoyée depuis une autre page : 403', async () => {
    const forged = await call(
      'SIG-00001/decision',
      { decision: 'retrait', motif: 'x' },
      'comite',
      'https://evil.example',
    );
    expect(forged.status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe('Levée d’une suspension par le Comité, avec un motif', () => {
  it('liste des suspendus ; levée transmise ; motif exigé ; certification devenue impossible : 409', async () => {
    expect((await call('suspendus')).status).toBe(200);
    expect((await call('suspendus/REC-2041/levee', { motif: 'Sans lien' })).status).toBe(204);
    expect(calls).toEqual([
      ['suspended', SUB],
      ['lift', SUB, 'REC-2041', 'Sans lien'],
    ]);
    expect((await call('suspendus/REC-2041/levee', { motif: ' ' })).status).toBe(400);
    failure = new SuspensionLiftBlockedError();
    const blocked = await call('suspendus/REC-2041/levee', { motif: 'Sans lien' });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: 'blocked' });
  });
});
