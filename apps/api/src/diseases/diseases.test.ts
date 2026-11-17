// US-052 : accès aux fiches maladies, contrôle des saisies, traduction des refus de la base.
// Base simulée ; les règles (rôle, nom français unique, dénominations, recherche sans accents)
// sont prouvées sur un vrai PostgreSQL (packages/db/test/fiches-maladies.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { DiseaseDetail } from '@sabou/types';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { ENV, type Env } from '../config/env';
import { PlantEditorGuard } from '../plants/plants.controller';
import { DiseasesController } from './diseases.controller';
import {
  DiseaseNameTakenError,
  DiseaseNotAllowedError,
  DiseasesRepository,
  DiseaseStaleError,
} from './diseases.repository';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '55555555-5555-4555-8555-555555555555';
const DISEASE: DiseaseDetail = {
  code: 'MA-006',
  nomFr: 'Fièvre typhoïde',
  nomEn: null,
  symptomesFr: null,
  symptomesEn: null,
  denominations: [],
  modifieLe: '2026-11-15T10:00:00.000000Z',
};

const calls: unknown[][] = [];
let failure: Error | null = null;
const repository = {
  async list(sub: string, q?: string) {
    calls.push(['list', sub, q]);
    return [];
  },
  async detail(sub: string, code: string) {
    calls.push(['detail', sub, code]);
    return DISEASE;
  },
  async create(sub: string, _ip: unknown, fields: unknown) {
    calls.push(['create', sub, fields]);
    if (failure) throw failure;
    return DISEASE;
  },
  async update(sub: string, _ip: unknown, code: string, input: unknown) {
    calls.push(['update', sub, code, input]);
    if (failure) throw failure;
    return DISEASE;
  },
};
const session = (roles: string[]): SessionData => ({
  sub: SUB,
  username: 'dg@sabou-sante.gn',
  name: 'Mohamed Camara',
  roles,
  secondFactor: true,
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
    controllers: [DiseasesController],
    providers: [
      { provide: DiseasesRepository, useValue: repository },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: ENV, useValue: { ADMIN_APP_URL: `${APP_ORIGIN}/` } as Env },
      PlantEditorGuard,
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
    ['dg', session(['dg', 'administrateur'])],
    ['prefectoral', session(['admin_prefectoral', 'administrateur'])],
  ]);
});

const request = (method: string, path: string, body?: unknown, cookie = 'dg') =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: `${SESSION_COOKIE}=${cookie}`,
      origin: APP_ORIGIN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const fields = {
  nomFr: 'Fièvre typhoïde',
  denominations: [{ langue: 'fr', denomination: 'Typhoïde' }],
};

describe('Fiches maladies', () => {
  it('réservées à la DG et au Comité', async () => {
    expect((await request('GET', '/api/maladies', undefined, 'prefectoral')).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('recherche transmise ; création avec les facultatifs à null', async () => {
    expect((await request('GET', '/api/maladies?q=fievre')).status).toBe(200);
    expect((await request('POST', '/api/maladies', fields)).status).toBe(201);
    expect(calls).toEqual([
      ['list', SUB, 'fievre'],
      ['create', SUB, { ...fields, nomEn: null, symptomesFr: null, symptomesEn: null }],
    ]);
  });

  it('dénomination en langue nationale refusée avant la base', async () => {
    const response = await request('POST', '/api/maladies', {
      ...fields,
      denominations: [{ langue: 'mal', denomination: 'Kaba' }],
    });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('refus de la base traduits : rôle, nom déjà pris, fiche changée', async () => {
    failure = new DiseaseNotAllowedError();
    expect((await request('POST', '/api/maladies', fields)).status).toBe(403);
    failure = new DiseaseNameTakenError('MA-001');
    const taken = await request('POST', '/api/maladies', fields);
    expect(taken.status).toBe(409);
    expect((await taken.json()).message).toBe('Ce nom français est déjà celui de la fiche MA-001.');
    failure = new DiseaseStaleError();
    const stale = await request('PATCH', '/api/maladies/MA-001', {
      ...fields,
      vueLe: '2026-11-15T10:00:00.000000Z',
    });
    expect(stale.status).toBe(409);
  });

  it('code de fiche invalide : refusé avant la base', async () => {
    expect((await request('GET', '/api/maladies/MA-1%27')).status).toBe(400);
  });
});
