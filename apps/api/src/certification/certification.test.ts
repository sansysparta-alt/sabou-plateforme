// Lot B (US-011) et US-042 : contrôles d'accès, paramètres des listes cloisonnées et des
// décisions, traduction des refus de la base. Base simulée ;
// le cloisonnement lui-même est prouvé sur un vrai PostgreSQL (packages/db/test/zones.test.ts)
// et de bout en bout, par l'API réelle (apps/admin/e2e/zones.spec.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { DossierDecision, ZoneListQuery } from '@sabou/types';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { ENV, type Env } from '../config/env';
import { ZoneContextError } from '../database/zone';
import { AdministratorGuard, CertificationController } from './certification.controller';
import {
  CertificationRepository,
  DecisionNotAllowedError,
  DossierNotFoundError,
  FieldVisitRequiredError,
  StaleDossierError,
} from './certification.repository';

const APP_ORIGIN = 'http://localhost:5173';

const SUB = '33333333-3333-4333-8333-333333333333';

const calls: { list: string; sub: string; query: ZoneListQuery }[] = [];
const decisions: { sub: string; code: string; input: DossierDecision }[] = [];
let failure: Error | null = null;
const repository = {
  async listFieldVerification(sub: string, query: ZoneListQuery) {
    calls.push({ list: 'dossiers/verification-terrain', sub, query });
    if (failure) throw failure;
    return { elements: [], suivant: null };
  },
  async decide(sub: string, _ip: string | undefined, code: string, input: DossierDecision) {
    decisions.push({ sub, code, input });
    if (failure) throw failure;
    return { code, etape: input.decision === 'valide' ? input.etape + 1 : input.etape - 1 };
  },
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
      { provide: ENV, useValue: { ADMIN_APP_URL: `${APP_ORIGIN}/` } as Env },
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
  decisions.length = 0;
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

describe.each(['/api/praticiens', '/api/dossiers', '/api/dossiers/verification-terrain'])(
  '%s',
  (path) => {
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
  },
);

const decide = (body: unknown, options: { cookie?: string; origin?: string; code?: string } = {}) =>
  fetch(`${base}/api/dossiers/${options.code ?? 'DS-2001'}/decision`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: options.origin ?? APP_ORIGIN,
      ...(options.cookie === ''
        ? {}
        : { cookie: `${SESSION_COOKIE}=${options.cookie ?? 'admin'}` }),
    },
    body: JSON.stringify(body),
  });

describe('US-042 : décision sur un dossier', () => {
  it('valide : renvoie l’étape suivante, sans cache', async () => {
    const response = await decide({ etape: 2, decision: 'valide' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ code: 'DS-2001', etape: 3 });
    expect(decisions).toEqual([
      { sub: SUB, code: 'DS-2001', input: { etape: 2, decision: 'valide' } },
    ]);
  });

  it('rejette avec motif, débarrassé des espaces autour', async () => {
    const response = await decide({
      etape: 2,
      decision: 'rejete',
      motif: '  Adresse introuvable ',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 'DS-2001', etape: 1 });
    expect(decisions[0]!.input).toEqual({
      etape: 2,
      decision: 'rejete',
      motif: 'Adresse introuvable',
    });
  });

  it.each([
    ['sans motif', { etape: 2, decision: 'rejete' }],
    ['avec un motif vide', { etape: 2, decision: 'rejete', motif: '' }],
    ['avec un motif fait d’espaces', { etape: 2, decision: 'rejete', motif: '   ' }],
  ])('refuse un rejet %s (critère 3)', async (_case, body) => {
    const response = await decide(body);
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('Le motif du rejet est obligatoire.');
    expect(decisions).toEqual([]);
  });

  it.each([
    ['un motif trop long', { etape: 2, decision: 'rejete', motif: 'x'.repeat(1001) }],
    ['une validation motivée', { etape: 2, decision: 'valide', motif: 'Bien' }],
    ['une décision inconnue', { etape: 2, decision: 'rejet_definitif', motif: 'Fraude' }],
    ['l’étape 1', { etape: 1, decision: 'valide' }],
    ['l’étape 6', { etape: 6, decision: 'valide' }],
    ['une étape manquante', { decision: 'valide' }],
    ['un champ en trop', { etape: 2, decision: 'valide', acteur: 1 }],
  ])('refuse %s', async (_case, body) => {
    expect((await decide(body)).status).toBe(400);
    expect(decisions).toEqual([]);
  });

  it.each(['ds-1041', 'PR-1041', 'DS-', "DS-1'--"])(
    'refuse le code de dossier %s',
    async (code) => {
      const response = await decide(
        { etape: 2, decision: 'valide' },
        { code: encodeURIComponent(code) },
      );
      expect(response.status).toBe(400);
      expect(decisions).toEqual([]);
    },
  );

  it.each([
    ['sans session', { cookie: '' }, 401],
    ['d’un compte qui n’est pas administrateur', { cookie: 'praticien' }, 403],
    ['sans second facteur', { cookie: 'sans-facteur' }, 403],
    ['venue d’une autre origine', { origin: 'https://exemple.invalid' }, 403],
  ])('refuse une décision %s', async (_case, options, status) => {
    expect((await decide({ etape: 2, decision: 'valide' }, options)).status).toBe(status);
    expect(decisions).toEqual([]);
  });

  it.each([
    // Critère 4 : dossier d'une autre préfecture, invisible pour le compte (RLS)
    ['hors zone', new DossierNotFoundError(), 404, 'not_found'],
    // Critère 4 : dossier visible mais hors de sa responsabilité (ex. admin régional)
    ['non responsable', new DecisionNotAllowedError(), 403, 'not_allowed'],
    // Critère 2 : dossier initial sans visite réalisée
    ['sans visite', new FieldVisitRequiredError(), 409, 'visit_required'],
    ['étape changée', new StaleDossierError(), 409, 'stale'],
  ])('traduit le refus « %s »', async (_case, error, status, code) => {
    failure = error;
    const response = await decide({ etape: 2, decision: 'valide' });
    expect(response.status).toBe(status);
    expect(((await response.json()) as { error: string }).error).toBe(code);
  });

  it('refuse un compte suspendu ou inconnu de la base', async () => {
    failure = new ZoneContextError();
    expect((await decide({ etape: 2, decision: 'valide' })).status).toBe(403);
  });

  it('ne déguise pas une panne de la base en refus', async () => {
    failure = new Error('connexion perdue');
    expect((await decide({ etape: 2, decision: 'valide' })).status).toBe(500);
  });
});
