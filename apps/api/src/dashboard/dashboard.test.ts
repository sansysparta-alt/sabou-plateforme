// US-016, US-090 : accès aux tableaux de bord. Base simulée ; les indicateurs de chaque profil et
// leur cloisonnement par zone sont prouvés sur un vrai PostgreSQL
// (packages/db/test/tableau-de-bord.test.ts) et de bout en bout (apps/admin/e2e/zones.spec.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { DashboardSummary, PractitionerDashboard } from '@sabou/types';
import { InvalidMobileTokenError, MOBILE_TOKEN_VERIFIER } from '../auth/mobile-token';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { ZoneContextError } from '../database/zone';
import { PractitionerGuard } from '../dossiers/dossiers.controller';
import { DashboardController, PractitionerDashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';

const SUB = '33333333-3333-4333-8333-333333333333';
const SUMMARY: DashboardSummary = {
  zone: 'Labé',
  praticiens: 3,
  indicateurs: {
    profil: 'prefectoral',
    enregistres: 3,
    certifies: 1,
    enAttente: 2,
    recettesNumerisees: 0,
    parSpecialite: [{ specialite: 'Herboristerie', praticiens: 3 }],
    aValider: { total: 0, dossiers: [] },
  },
  activite: [],
  smsNonRemis: null,
};

const PRACTITIONER: PractitionerDashboard = {
  profil: 'praticien',
  traitements: { certifies: 1, enExamen: 0, brouillons: 2, suspendus: 0 },
  dossier: null,
  certificat: null,
};

const calls: string[] = [];
let failure: Error | null = null;
const repository = {
  async summary(sub: string) {
    calls.push(sub);
    if (failure) throw failure;
    return SUMMARY;
  },
  async practitioner(sub: string) {
    calls.push(`praticien:${sub}`);
    if (failure) throw failure;
    return PRACTITIONER;
  },
};
const mobileTokens = {
  async verify(token: string) {
    if (token === 'jeton.praticien.ok') return { sub: SUB, roles: ['praticien'], amr: [] };
    if (token === 'jeton.citoyen.ok') return { sub: SUB, roles: ['citoyen'], amr: [] };
    throw new InvalidMobileTokenError();
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
    controllers: [DashboardController, PractitionerDashboardController],
    providers: [
      { provide: DashboardRepository, useValue: repository },
      { provide: MOBILE_TOKEN_VERIFIER, useValue: mobileTokens },
      PractitionerGuard,
      { provide: SESSION_STORE, useValue: sessions },
      // Garde commune aux administrateurs : l'origine n'est contrôlée que hors GET
      { provide: ENV, useValue: { ADMIN_APP_URL: 'http://localhost:5173/' } as Env },
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

describe('GET /api/praticien/tableau-de-bord (application mobile)', () => {
  const mine = (token?: string) =>
    fetch(`${base}/api/praticien/tableau-de-bord`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('refuse une requête sans jeton ou avec un jeton refusé', async () => {
    expect((await mine()).status).toBe(401);
    expect((await mine('faux')).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('refuse un compte qui n’est pas praticien', async () => {
    expect((await mine('jeton.citoyen.ok')).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('renvoie le tableau de bord du praticien du jeton, sans cache', async () => {
    const response = await mine('jeton.praticien.ok');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(PRACTITIONER);
    expect(calls).toEqual([`praticien:${SUB}`]);
  });

  it('refuse un compte suspendu, inconnu ou d’un autre profil, sans dire lequel', async () => {
    failure = new ZoneContextError();
    expect((await mine('jeton.praticien.ok')).status).toBe(403);
  });
});
