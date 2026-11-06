// Lot B (US-011) : contrôles d'accès et paramètres des listes cloisonnées. Base simulée ;
// le cloisonnement lui-même est prouvé sur un vrai PostgreSQL (packages/db/test/zones.test.ts)
// et de bout en bout, par l'API réelle (apps/admin/e2e/zones.spec.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { ZoneListQuery } from '@sabou/types';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { ZoneContextError } from '../database/zone';
import { AdministratorGuard, CertificationController } from './certification.controller';
import { CertificationRepository } from './certification.repository';

const SUB = '33333333-3333-4333-8333-333333333333';

const calls: { list: string; sub: string; query: ZoneListQuery }[] = [];
let failure: Error | null = null;
const repository = {
  async listPractitioners(sub: string, query: ZoneListQuery) {
    calls.push({ list: 'praticiens', sub, query });
    if (failure) throw failure;
    return { elements: [], suivant: null };
  },
  async listDossiers(sub: string, query: ZoneListQuery) {
    calls.push({ list: 'dossiers', sub, query });
    if (failure) throw failure;
    return { elements: [], suivant: null };
  },
};

const session = (roles: string[], secondFactor = true): SessionData => ({
  sub: SUB,
  username: 'prefectoral.labe@sabou-sante.gn',
  name: 'Ibrahima Sow',
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

let app: INestApplication;
let base: string;

beforeAll(async () => {
  @Module({
    controllers: [CertificationController],
    providers: [
      { provide: CertificationRepository, useValue: repository },
      { provide: SESSION_STORE, useValue: sessions },
      AdministratorGuard,
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
  sessions.data = new Map([
    ['admin', session(['prefectoral', 'administrateur'])],
    ['sans-facteur', session(['prefectoral', 'administrateur'], false)],
    ['praticien', session(['praticien'])],
  ]);
});

const get = (path: string, cookie?: string) =>
  fetch(`${base}${path}`, {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });

describe.each(['/api/praticiens', '/api/dossiers'])('%s', (path) => {
  it('refuse une requête sans session', async () => {
    expect((await get(path)).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('refuse un compte qui n’est pas administrateur', async () => {
    expect((await get(path, 'praticien')).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('refuse un administrateur connecté sans second facteur (R-ACC-03)', async () => {
    expect((await get(path, 'sans-facteur')).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('lit la zone du compte connecté, sans cache', async () => {
    const response = await get(path, 'admin');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ elements: [], suivant: null });
    expect(calls).toEqual([{ list: path.slice(5), sub: SUB, query: { limite: 50 } }]);
  });

  it('transmet la pagination', async () => {
    await get(`${path}?limite=10&apres=PR-1041`, 'admin');
    expect(calls[0]!.query).toEqual({ limite: 10, apres: 'PR-1041' });
  });

  it.each([
    ['limite=0'],
    ['limite=101'],
    ['apres=%27%20OR%201%3D1'],
    // Aucun paramètre de zone n'est accepté : la zone vient du compte, jamais de la requête
    ['prefecture_id=9'],
    ['region=7'],
  ])('refuse le paramètre %s', async (params) => {
    expect((await get(`${path}?${params}`, 'admin')).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('refuse un compte suspendu ou inconnu de la base, sans dire lequel', async () => {
    failure = new ZoneContextError();
    expect((await get(path, 'admin')).status).toBe(403);
  });
});
