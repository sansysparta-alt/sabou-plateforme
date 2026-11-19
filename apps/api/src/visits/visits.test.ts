// US-041 : contrôles d'accès, paramètres des visites et traduction des refus de la base.
// Base et stockage simulés ; les règles elles-mêmes (préfectoral de la préfecture, étape 2,
// dates, compte rendu figé, rappel la veille) sont prouvées sur un vrai PostgreSQL
// (packages/db/test/visites-terrain.test.ts) et de bout en bout (apps/admin/e2e/visites-terrain.spec.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { FieldAgendaItem, FieldVisit, FieldVisitReport } from '@sabou/types';
import { FIELD_AGENT_TOKEN_VERIFIER, InvalidMobileTokenError } from '../auth/mobile-token';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { ZoneContextError } from '../database/zone';
import { PIECE_STORAGE } from '../dossiers/piece-storage';
import { FieldAgendaController } from './field-agenda.controller';
import { VisitsController } from './visits.controller';
import {
  VisitClockError,
  VisitDateError,
  VisitDossierNotFoundError,
  VisitNotAllowedError,
  VisitPhotoError,
  VisitsRepository,
  VisitStaleError,
  type VisitPhoto,
} from './visits.repository';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '33333333-3333-4333-8333-333333333333';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const VISIT: FieldVisit = {
  id: 2,
  statut: 'planifiee',
  prevueLe: '2026-11-20T09:30',
  rappelEnvoye: false,
  realiseeLe: null,
  avis: null,
  signePar: null,
  signeLe: null,
  empreinte: null,
  attesteLeDeclare: null,
  photo: false,
};

// US-083 : agenda de l'agent et jeton du client « sabou-terrain » avec second facteur
const AGENDA: FieldAgendaItem[] = [
  {
    categorie: 'planifiee',
    dossier: 'DS-1041',
    visite: 2,
    praticien: 'Sekou Kourouma',
    sousPrefecture: 'Garambé',
    prefecture: 'Labé',
    prevueLe: '2026-11-23T09:30',
    entreeLe: '2026-11-14',
  },
];
const fieldTokens = {
  async verify(token: string) {
    if (token === 'jeton.agent.ok') {
      return { sub: SUB, roles: ['administrateur', 'admin_prefectoral'], amr: ['pwd', 'otp'] };
    }
    if (token === 'jeton.agent.sans2fa') {
      return { sub: SUB, roles: ['administrateur', 'admin_prefectoral'], amr: ['pwd'] };
    }
    throw new InvalidMobileTokenError();
  },
};

const calls: unknown[][] = [];
let failure: Error | null = null;
const repository = {
  async agenda(sub: string) {
    calls.push(['agenda', sub]);
    if (failure) throw failure;
    return AGENDA;
  },
  async plan(sub: string, _ip: unknown, code: string, prevueLe: string) {
    calls.push(['plan', sub, code, prevueLe]);
    if (failure) throw failure;
    return VISIT;
  },
  async report(sub: string, _ip: unknown, code: string, input: FieldVisitReport) {
    calls.push(['report', sub, code, input]);
    if (failure) throw failure;
    return { ...VISIT, statut: 'realisee' };
  },
  async attachPhoto(sub: string, _ip: unknown, code: string, visite: number, photo: VisitPhoto) {
    calls.push(['photo', sub, code, visite, photo.mime, photo.size]);
    if (failure) throw failure;
    return { ...VISIT, statut: 'realisee', photo: true };
  },
};
const stored: string[] = [];
const removed: string[] = [];
const storage = {
  async put(key: string) {
    stored.push(key);
  },
  async remove(key: string) {
    removed.push(key);
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
    controllers: [VisitsController, FieldAgendaController],
    providers: [
      { provide: VisitsRepository, useValue: repository },
      { provide: PIECE_STORAGE, useValue: storage },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: ENV, useValue: { ADMIN_APP_URL: `${APP_ORIGIN}/` } as Env },
      { provide: FIELD_AGENT_TOKEN_VERIFIER, useValue: fieldTokens },
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
  stored.length = 0;
  removed.length = 0;
  failure = null;
  sessions.data = new Map([
    ['admin', session(['prefectoral', 'administrateur'])],
    ['sans-facteur', session(['prefectoral', 'administrateur'], false)],
    ['praticien', session(['praticien'])],
  ]);
});

const post = (
  path: string,
  body: unknown,
  { cookie = 'admin', origin = APP_ORIGIN, type = 'application/json' } = {},
) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': type,
      cookie: `${SESSION_COOKIE}=${cookie}`,
      ...(origin ? { origin } : {}),
    },
    body: Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body),
  });

const REPORT = {
  visite: 2,
  realiseeLe: '2026-11-13',
  avis: 'favorable',
  constats: '  Lieu conforme.  ',
  attestation: true,
};

describe.each([
  ['/api/dossiers/DS-1041/visite', { prevueLe: '2026-11-20T09:30' }],
  ['/api/dossiers/DS-1041/visite/compte-rendu', REPORT],
])('%s : accès', (path, body) => {
  it('refuse un compte qui n’est pas administrateur, ou sans second facteur (R-ACC-03)', async () => {
    expect((await post(path, body, { cookie: 'praticien' })).status).toBe(403);
    expect((await post(path, body, { cookie: 'sans-facteur' })).status).toBe(403);
    expect((await post(path, body, { cookie: 'inconnue' })).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('refuse une écriture venue d’une autre origine', async () => {
    expect((await post(path, body, { origin: 'https://ailleurs.example' })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('refuse un code de dossier mal formé, sans appeler la base', async () => {
    expect((await post(path.replace('DS-1041', 'XX-1'), body)).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('planification', () => {
  it('transmet la date saisie (heure de Conakry) et renvoie la visite, sans cache', async () => {
    const response = await post('/api/dossiers/DS-1041/visite', { prevueLe: '2026-11-20T09:30' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(VISIT);
    expect(calls).toEqual([['plan', SUB, 'DS-1041', '2026-11-20T09:30']]);
  });

  it('refuse une date mal formée, sans appeler la base', async () => {
    const response = await post('/api/dossiers/DS-1041/visite', { prevueLe: '2026-02-30T09:30' });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('Critère 2 : compte rendu signé obligatoire', () => {
  it('transmet le compte rendu, débarrassé des espaces autour', async () => {
    const response = await post('/api/dossiers/DS-1041/visite/compte-rendu', REPORT);
    expect(response.status).toBe(200);
    expect(calls).toEqual([['report', SUB, 'DS-1041', { ...REPORT, constats: 'Lieu conforme.' }]]);
  });

  it.each([
    ['sans attestation (signature)', { attestation: false }],
    ['sans constats', { constats: ' ' }],
    ['sans avis', { avis: undefined }],
  ])('refuse un compte rendu %s, sans appeler la base', async (_, change) => {
    const response = await post('/api/dossiers/DS-1041/visite/compte-rendu', {
      ...REPORT,
      ...change,
    });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('refus de la base', () => {
  it.each([
    [new VisitDossierNotFoundError(), 404, 'not_found'],
    [new VisitNotAllowedError(), 403, 'not_allowed'],
    [new VisitStaleError(), 409, 'stale'],
    [new VisitDateError(), 422, 'invalid_date'],
    [new VisitPhotoError(), 409, 'photo_exists'],
  ])('%s → %i', async (error, status, code) => {
    failure = error;
    const response = await post('/api/dossiers/DS-1041/visite/compte-rendu', REPORT);
    expect(response.status).toBe(status);
    expect(((await response.json()) as { error: string }).error).toBe(code);
  });

  it('refuse un compte suspendu ou inconnu de la base', async () => {
    failure = new ZoneContextError();
    expect(
      (await post('/api/dossiers/DS-1041/visite', { prevueLe: '2026-11-20T09:30' })).status,
    ).toBe(403);
  });

  it('ne déguise pas une panne de la base en refus', async () => {
    failure = new Error('connexion perdue');
    expect(
      (await post('/api/dossiers/DS-1041/visite', { prevueLe: '2026-11-20T09:30' })).status,
    ).toBe(500);
  });
});

describe('photo facultative de la fiche papier', () => {
  const PHOTO = '/api/dossiers/DS-1041/visite/2/photo';

  it('dépose le fichier sous une clé au hasard, puis le joint à la visite', async () => {
    const response = await post(PHOTO, JPEG, { type: 'image/jpeg' });
    expect(response.status).toBe(200);
    expect(stored).toEqual([expect.stringMatching(/^pieces\/[0-9a-f-]{36}\.jpg$/) as string]);
    expect(calls).toEqual([['photo', SUB, 'DS-1041', 2, 'image/jpeg', JPEG.length]]);
    expect(removed).toEqual([]);
  });

  it('juge le format sur le contenu, pas sur l’en-tête', async () => {
    const response = await post(PHOTO, Buffer.from('<svg/>'), { type: 'image/png' });
    expect(response.status).toBe(415);
    expect(stored).toEqual([]);
  });

  it('refuse un fichier de plus de 5 Mo', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await post(PHOTO, big, { type: 'image/jpeg' })).status).toBe(413);
    expect(stored).toEqual([]);
  });

  it('retire le fichier déposé si la base refuse', async () => {
    failure = new VisitPhotoError();
    expect((await post(PHOTO, JPEG, { type: 'image/jpeg' })).status).toBe(409);
    expect(removed).toEqual(stored);
    expect(removed).toHaveLength(1);
  });

  it('refuse sans session ou d’une autre origine, sans rien déposer', async () => {
    expect((await post(PHOTO, JPEG, { type: 'image/jpeg', cookie: 'praticien' })).status).toBe(403);
    expect(
      (await post(PHOTO, JPEG, { type: 'image/jpeg', origin: 'https://ailleurs.example' })).status,
    ).toBe(403);
    expect(stored).toEqual([]);
  });
});

// US-083 : agenda et compte rendu depuis le téléphone (jeton de l'agent, sans cookie ni
// origine) ; heure d'attestation déclarée par le téléphone transmise à la base
describe('US-083 : agenda et compte rendu depuis le téléphone', () => {
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  it('agenda lu avec le jeton de l’agent, sans cache', async () => {
    const response = await fetch(`${base}/api/terrain/visites`, {
      headers: bearer('jeton.agent.ok'),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(AGENDA);
    expect(calls).toEqual([['agenda', SUB]]);
  });

  it('agenda : sans second facteur, jeton refusé ou sans compte, refusé avant la base', async () => {
    const get = (headers: Record<string, string>) =>
      fetch(`${base}/api/terrain/visites`, { headers });
    expect((await get(bearer('jeton.agent.sans2fa'))).status).toBe(403);
    expect((await get(bearer('jeton.inconnu'))).status).toBe(401);
    expect((await get({})).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('agenda : contexte de zone refusé par la base, 403', async () => {
    failure = new ZoneContextError();
    const response = await fetch(`${base}/api/terrain/visites`, {
      headers: bearer('jeton.agent.ok'),
    });
    expect(response.status).toBe(403);
  });

  it('compte rendu rédigé sans réseau : l’heure déclarée est transmise à la base', async () => {
    const body = { ...REPORT, attesteLe: '2026-11-20T07:45:00.000Z' };
    const response = await fetch(`${base}/api/dossiers/DS-1041/visite/compte-rendu`, {
      method: 'POST',
      headers: { ...bearer('jeton.agent.ok'), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual([['report', SUB, 'DS-1041', { ...body, constats: 'Lieu conforme.' }]]);
  });

  it('heure déclarée mal formée : 400 sans appeler la base', async () => {
    const response = await post('/api/dossiers/DS-1041/visite/compte-rendu', {
      ...REPORT,
      attesteLe: 'hier soir',
    });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('horloge du téléphone en avance : 422 « clock », message pour l’agent', async () => {
    failure = new VisitClockError();
    const response = await post('/api/dossiers/DS-1041/visite/compte-rendu', REPORT);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'clock' });
  });
});
