// US-053 : accès aux noms locaux, contrôle des saisies, traduction des refus de la base. Base
// simulée ; les règles (référent de la langue, un seul principal, voix d'un dépôt traité du
// même compte, journal) sont prouvées sur un vrai PostgreSQL (packages/db/test/noms-locaux.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { LocalNamesPlant } from '@sabou/types';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { LocalNamesController } from './local-names.controller';
import {
  LocalNameNotAllowedError,
  LocalNameNotFoundError,
  LocalNamesRepository,
  LocalNameTakenError,
  LocalNameVoiceError,
} from './local-names.repository';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '55555555-5555-4555-8555-555555555555';

const PLANT: LocalNamesPlant = {
  code: 'PL-006',
  nomScientifique: 'Combretum micranthum',
  nomFr: 'Kinkéliba',
  noms: [
    {
      id: 7,
      langue: 'mal',
      langueNom: 'Malinké',
      transcription: 'Kinkéliba',
      principal: true,
      voix: true,
      modifiable: true,
    },
  ],
};

const calls: unknown[][] = [];
let failure: Error | null = null;
const fail = () => {
  if (failure) throw failure;
};
const repository = {
  async languages(sub: string) {
    calls.push(['languages', sub]);
    return [{ code: 'mal', nom: 'Malinké' }];
  },
  async plants(sub: string, q?: string) {
    calls.push(['plants', sub, q]);
    return [];
  },
  async plant(sub: string, code: string) {
    calls.push(['plant', sub, code]);
    fail();
    return PLANT;
  },
  async add(sub: string, _ip: unknown, input: unknown) {
    calls.push(['add', sub, input]);
    fail();
    return PLANT;
  },
  async makePrincipal(sub: string, _ip: unknown, id: number) {
    calls.push(['makePrincipal', sub, id]);
    fail();
    return PLANT;
  },
  async remove(sub: string, _ip: unknown, id: number) {
    calls.push(['remove', sub, id]);
    fail();
    return PLANT;
  },
};

const session = (roles: string[], secondFactor = true): SessionData => ({
  sub: SUB,
  username: 'referent@sabou-sante.gn',
  name: 'Fanta Kourouma',
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
    controllers: [LocalNamesController],
    providers: [
      { provide: LocalNamesRepository, useValue: repository },
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
    ['prefectoral', session(['admin_prefectoral', 'administrateur'])],
    ['sans-facteur', session(['admin_prefectoral', 'administrateur'], false)],
    ['praticien', session(['praticien'])],
  ]);
});

const request = (
  method: string,
  path: string,
  body?: unknown,
  { cookie = 'prefectoral', origin = APP_ORIGIN } = {},
) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      cookie: `${SESSION_COOKIE}=${cookie}`,
      ...(origin ? { origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const valid = { plante: 'PL-006', langue: 'mal', transcription: '  Kinkéliba  ', principal: true };

describe('Accès aux noms locaux', () => {
  it('administrateur avec second facteur : ses langues de référent', async () => {
    const response = await request('GET', '/api/noms-locaux/langues');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ code: 'mal', nom: 'Malinké' }]);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('sans second facteur, praticien ou sans session : refusé, la base n’est pas appelée', async () => {
    expect(
      (await request('GET', '/api/noms-locaux/langues', undefined, { cookie: 'sans-facteur' }))
        .status,
    ).toBe(403);
    expect(
      (await request('GET', '/api/noms-locaux/langues', undefined, { cookie: 'praticien' })).status,
    ).toBe(403);
    expect(
      (await request('GET', '/api/noms-locaux/langues', undefined, { cookie: 'inconnu' })).status,
    ).toBe(401);
    expect(calls).toEqual([]);
  });

  it('écriture depuis une autre origine : refusée', async () => {
    const response = await request('POST', '/api/noms-locaux', valid, {
      origin: 'https://ailleurs.example',
    });
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe('Critère : plusieurs noms par langue, un seul principal', () => {
  it('ajout : transcription sans espaces autour, sans voix par défaut', async () => {
    const response = await request('POST', '/api/noms-locaux', valid);
    expect(response.status).toBe(201);
    expect(calls).toEqual([['add', SUB, { ...valid, transcription: 'Kinkéliba', depot: null }]]);
  });

  it('ajout avec la voix d’un dépôt', async () => {
    await request('POST', '/api/noms-locaux', { ...valid, depot: 42 });
    expect(calls[0]![2]).toMatchObject({ depot: 42 });
  });

  it('saisie incomplète ou champ inconnu : 400, rien n’est écrit', async () => {
    expect(
      (await request('POST', '/api/noms-locaux', { ...valid, transcription: ' ' })).status,
    ).toBe(400);
    expect((await request('POST', '/api/noms-locaux', { ...valid, plante: 'X' })).status).toBe(400);
    expect((await request('POST', '/api/noms-locaux', { ...valid, audio: 3 })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('changer le principal, retirer un nom : la fiche à jour est renvoyée', async () => {
    const principal = await request('POST', '/api/noms-locaux/7/principal');
    expect(principal.status).toBe(200);
    const removed = await request('DELETE', '/api/noms-locaux/7');
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as LocalNamesPlant).code).toBe('PL-006');
    expect(calls).toEqual([
      ['makePrincipal', SUB, 7],
      ['remove', SUB, 7],
    ]);
  });

  it('refus de la base traduits en clair', async () => {
    const cases: [Error, number, string][] = [
      [new LocalNameNotAllowedError(), 403, 'not_allowed'],
      [new LocalNameTakenError(), 409, 'name_taken'],
      [new LocalNameVoiceError(), 409, 'voice_not_ready'],
      [new LocalNameNotFoundError(), 404, 'name_not_found'],
    ];
    for (const [error, status, code] of cases) {
      failure = error;
      const response = await request('POST', '/api/noms-locaux', valid);
      expect(response.status).toBe(status);
      expect(((await response.json()) as { error: string }).error).toBe(code);
    }
  });
});
