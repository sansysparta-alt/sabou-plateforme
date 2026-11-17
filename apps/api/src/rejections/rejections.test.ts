// US-047 : contrôles d'accès, paramètres et traduction des refus de la base pour le rejet
// définitif. Base simulée ; le rejet lui-même (rôle, effets, traces) est prouvé sur un vrai
// PostgreSQL (packages/db/test/rejet-definitif.test.ts) et de bout en bout
// (apps/admin/e2e/rejet-definitif.spec.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Rejection } from '@sabou/types';
import { DirectorGuard } from '../accounts/accounts.controller';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { ENV, type Env } from '../config/env';
import { ZoneContextError } from '../database/zone';
import { RejectionsController } from './rejections.controller';
import {
  AlreadyRejectedError,
  PractitionerNotFoundError,
  RejectionNotAllowedError,
  RejectionsRepository,
  StalePractitionerError,
} from './rejections.repository';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '11111111-1111-4111-8111-111111111111';

const searches: { sub: string; q: string }[] = [];
const rejections: { sub: string; code: string; input: Rejection }[] = [];
let failure: Error | null = null;
const repository = {
  async search(sub: string, q: string) {
    searches.push({ sub, q });
    if (failure) throw failure;
    return [];
  },
  async reject(sub: string, _ip: string | undefined, code: string, input: Rejection) {
    rejections.push({ sub, code, input });
    if (failure) throw failure;
    return {
      praticien: code,
      dossier: input.dossier,
      certificat: 'SAB-2026-PR1042-KX7',
      traitementsSuspendus: 1,
      recoursJusquau: '2026-12-14',
    };
  },
};

const session = (roles: string[], secondFactor = true): SessionData => ({
  sub: SUB,
  username: 'dg@sabou-sante.gn',
  name: 'Mohamed Camara',
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
    controllers: [RejectionsController],
    providers: [
      { provide: RejectionsRepository, useValue: repository },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: ENV, useValue: { ADMIN_APP_URL: `${APP_ORIGIN}/` } as Env },
      DirectorGuard,
    ],
  })
  class TestModule {}
  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

afterAll(() => app.close());

beforeEach(() => {
  searches.length = 0;
  rejections.length = 0;
  failure = null;
  sessions.data = new Map([
    ['dg', session(['dg', 'administrateur'])],
    ['dg-sans-facteur', session(['dg', 'administrateur'], false)],
    ['regional', session(['regional', 'administrateur'])],
    ['comite', session(['scientifique', 'administrateur'])],
    ['praticien', session(['praticien'])],
  ]);
});

const search = (q: string, cookie?: string) =>
  fetch(`${base}/api/praticiens/recherche?q=${encodeURIComponent(q)}`, {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });

const valid = {
  dossier: null,
  motif: 'fraude_documentaire',
  detail: 'Diplôme falsifié',
  confirmation: true,
};
const reject = (body: unknown, options: { cookie?: string; origin?: string; code?: string } = {}) =>
  fetch(`${base}/api/praticiens/${options.code ?? 'PR-1042'}/rejet-definitif`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: options.origin ?? APP_ORIGIN,
      ...(options.cookie === '' ? {} : { cookie: `${SESSION_COOKIE}=${options.cookie ?? 'dg'}` }),
    },
    body: JSON.stringify(body),
  });

describe('Critère 1 : un autre rôle que la DG est refusé, avant d’atteindre la base', () => {
  it('sans session : 401', async () => {
    expect((await reject(valid, { cookie: '' })).status).toBe(401);
    expect((await search('Diallo')).status).toBe(401);
  });

  it.each(['regional', 'comite', 'praticien', 'dg-sans-facteur'])('%s : 403', async (cookie) => {
    expect((await reject(valid, { cookie })).status).toBe(403);
    expect((await search('Diallo', cookie)).status).toBe(403);
    expect(rejections).toEqual([]);
    expect(searches).toEqual([]);
  });

  it('refusé par la base (rôle changé entre-temps) : 403, même message', async () => {
    failure = new RejectionNotAllowedError();
    const response = await reject(valid);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'not_allowed' });
  });

  it('refuse une décision qui ne vient pas de l’application de gestion', async () => {
    expect((await reject(valid, { origin: 'https://ailleurs.example' })).status).toBe(403);
    expect(rejections).toEqual([]);
  });
});

describe('Rejet prononcé par la DG', () => {
  it('transmet la décision contrôlée et renvoie la date limite du recours, sans cache', async () => {
    const response = await reject({ ...valid, detail: '  Diplôme falsifié  ' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      praticien: 'PR-1042',
      dossier: null,
      certificat: 'SAB-2026-PR1042-KX7',
      traitementsSuspendus: 1,
      recoursJusquau: '2026-12-14',
    });
    expect(rejections).toEqual([
      { sub: SUB, code: 'PR-1042', input: { ...valid, detail: 'Diplôme falsifié' } },
    ]);
  });

  it.each([
    ['sans motif', { motif: undefined }],
    ['sans précision', { detail: ' ' }],
    ['sans confirmation', { confirmation: false }],
    ['pratique dangereuse sans avis du Comité', { motif: 'pratique_dangereuse' }],
    ['avec un champ en trop', { recours: 60 }],
  ])('refuse un rejet %s, sans appeler la base', async (_cas, change) => {
    expect((await reject({ ...valid, ...change })).status).toBe(400);
    expect(rejections).toEqual([]);
  });

  it('refuse un code de praticien invalide', async () => {
    expect((await reject(valid, { code: 'PR-1%27' })).status).toBe(400);
    expect(rejections).toEqual([]);
  });

  it.each([
    [new PractitionerNotFoundError(), 404, 'not_found'],
    [new AlreadyRejectedError(), 409, 'already_rejected'],
    [new StalePractitionerError(), 409, 'stale'],
    [new ZoneContextError(), 403, 'not_allowed'],
  ])('traduit %s', async (error, status, code) => {
    failure = error;
    const response = await reject(valid);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: code });
  });
});

describe('Recherche d’un praticien', () => {
  it('cherche la saisie sans espaces autour, pour la DG connectée, sans cache', async () => {
    const response = await search('  sab-2026-pr1042-kx7 ', 'dg');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual([]);
    expect(searches).toEqual([{ sub: SUB, q: 'sab-2026-pr1042-kx7' }]);
  });

  it.each(['a', 'a'.repeat(101)])('refuse la recherche « %s »', async (q) => {
    expect((await search(q, 'dg')).status).toBe(400);
    expect(searches).toEqual([]);
  });

  it('refuse un paramètre en trop', async () => {
    const response = await fetch(`${base}/api/praticiens/recherche?q=Diallo&region=4`, {
      headers: { cookie: `${SESSION_COOKIE}=dg` },
    });
    expect(response.status).toBe(400);
  });
});
