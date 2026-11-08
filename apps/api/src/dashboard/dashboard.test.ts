// US-016 : accès au tableau de bord. Base simulée ; les chiffres par zone sont prouvés de bout
// en bout, sur l'API et la base réelles (apps/admin/e2e/zones.spec.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { DashboardSummary } from '@sabou/types';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ZoneContextError } from '../database/zone';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';

const SUB = '33333333-3333-4333-8333-333333333333';
const SUMMARY: DashboardSummary = {
  zone: 'Labé',
  praticiens: 3,
  dossiersSoumis: 1,
  comptes: 2,
  specialites: 8,
  activite: [],
};

const calls: string[] = [];
let failure: Error | null = null;
const repository = {
  async summary(sub: string) {
    calls.push(sub);
    if (failure) throw failure;
    return SUMMARY;
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
    controllers: [DashboardController],
    providers: [
      { provide: DashboardRepository, useValue: repository },
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

const get = (cookie?: string) =>
  fetch(`${base}/api/tableau-de-bord`, {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });

describe('GET /api/tableau-de-bord', () => {
  it('refuse une requête sans session', async () => {
    expect((await get()).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('refuse un compte qui n’est pas administrateur', async () => {
    expect((await get('praticien')).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('refuse un administrateur connecté sans second facteur (R-ACC-03)', async () => {
    expect((await get('sans-facteur')).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('renvoie les chiffres de la zone du compte connecté, sans cache', async () => {
    const response = await get('admin');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(SUMMARY);
    expect(calls).toEqual([SUB]);
  });

  it('refuse un compte suspendu ou inconnu de la base, sans dire lequel', async () => {
    failure = new ZoneContextError();
    expect((await get('admin')).status).toBe(403);
  });
});
