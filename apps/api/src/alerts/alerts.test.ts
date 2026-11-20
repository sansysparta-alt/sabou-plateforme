// US-102 : contrôles d'accès, paramètres des alertes et traduction des refus de la base.
// Base simulée ; les règles (détection, cloisonnement, qui déclare, accuse, relance, clôt)
// sont prouvées sur un vrai PostgreSQL (packages/db/test/alertes.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { AlertsController } from './alerts.controller';
import {
  AlertNotAllowedError,
  AlertNotFoundError,
  AlertRefusedError,
  AlertsRepository,
} from './alerts.repository';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '55555555-5555-4555-8555-555555555555';
const calls: unknown[][] = [];
let failure: Error | null = null;
const repository = {
  async list(sub: string) {
    calls.push(['list', sub]);
    if (failure) throw failure;
    return [];
  },
  async referentials(sub: string) {
    calls.push(['referentials', sub]);
    return { prefectures: [], maladies: [] };
  },
  async declare(sub: string, _ip: unknown, input: unknown) {
    calls.push(['declare', sub, input]);
    if (failure) throw failure;
    return { id: 9 };
  },
  async acknowledge(sub: string, _ip: unknown, id: number) {
    calls.push(['acknowledge', sub, id]);
    if (failure) throw failure;
  },
  async relaunch(sub: string, _ip: unknown, id: number) {
    calls.push(['relaunch', sub, id]);
    if (failure) throw failure;
    return { prevenus: 2 };
  },
  async close(sub: string, _ip: unknown, id: number, motif: string) {
    calls.push(['close', sub, id, motif]);
    if (failure) throw failure;
  },
};
const session = (secondFactor = true): SessionData => ({
  sub: SUB,
  username: 'regional.labe@sabou-sante.gn',
  name: 'Alpha Barry',
  roles: ['admin_regional', 'administrateur'],
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
    controllers: [AlertsController],
    providers: [
      { provide: AlertsRepository, useValue: repository },
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
  failure = null;
  sessions.data = new Map([
    ['admin', session()],
    ['sans-facteur', session(false)],
  ]);
});

const call = (
  method: string,
  path: string,
  body?: unknown,
  { cookie = 'admin', origin = APP_ORIGIN } = {},
) =>
  fetch(`${base}/api/alertes${path}`, {
    method,
    headers: {
      cookie: `${SESSION_COOKIE}=${cookie}`,
      ...(origin ? { origin } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const DECLARE = { prefectureId: 4, maladie: 'MA-001', description: '  Cas en hausse.  ' };

describe('Critère 1 : alertes de la zone, hausse de pathologie déclarée', () => {
  it('liste sans cache ; déclaration nettoyée transmise à la base', async () => {
    const list = await call('GET', '');
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('no-store');
    expect((await call('POST', '', DECLARE)).status).toBe(201);
    expect(calls).toEqual([
      ['list', SUB],
      ['declare', SUB, { ...DECLARE, description: 'Cas en hausse.' }],
    ]);
  });

  it.each([
    ['sans maladie', { ...DECLARE, maladie: '' }],
    ['sans description', { ...DECLARE, description: ' ' }],
    ['champ en trop', { ...DECLARE, gravite: 'haute' }],
  ])('refuse une déclaration %s, sans appeler la base', async (_, body) => {
    expect((await call('POST', '', body)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('déclaration par un autre profil (régional) : 403', async () => {
    failure = new AlertNotAllowedError();
    expect((await call('POST', '', DECLARE)).status).toBe(403);
  });
});

describe('Critère 2 : accusé de réception, relance, clôture', () => {
  it('accusé, relance (nombre de responsables prévenus), clôture motivée', async () => {
    expect((await call('POST', '/3/accuse')).status).toBe(204);
    const relance = await call('POST', '/3/relance');
    expect(relance.status).toBe(200);
    expect(await relance.json()).toEqual({ prevenus: 2 });
    expect((await call('POST', '/3/cloture', { motif: 'Dossier repris.' })).status).toBe(204);
    expect(calls).toEqual([
      ['acknowledge', SUB, 3],
      ['relaunch', SUB, 3],
      ['close', SUB, 3, 'Dossier repris.'],
    ]);
  });

  it('relance de moins d’un jour, alerte close : 409 avec le message de la base', async () => {
    failure = new AlertRefusedError('too_soon', 'Déjà relancée il y a moins d’un jour.');
    const response = await call('POST', '/3/relance');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'too_soon' });
  });

  it('alerte hors zone : 404 ; identifiant mal formé ou clôture sans motif : 400', async () => {
    failure = new AlertNotFoundError();
    expect((await call('POST', '/3/accuse')).status).toBe(404);
    failure = null;
    expect((await call('POST', '/abc/accuse')).status).toBe(400);
    expect((await call('POST', '/3/cloture', { motif: '' })).status).toBe(400);
  });

  it('sans second facteur, ou écriture venue d’une autre origine : refusé', async () => {
    expect((await call('GET', '', undefined, { cookie: 'sans-facteur' })).status).toBe(403);
    expect(
      (await call('POST', '/3/accuse', undefined, { origin: 'https://ailleurs.example' })).status,
    ).toBe(403);
    expect(calls).toEqual([]);
  });
});
