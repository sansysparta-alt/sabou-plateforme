// US-101 : contrôles d'accès, paramètres des litiges et traduction des refus de la base.
// Base et stockage simulés ; les règles elles-mêmes (qui ouvre, écrit, rend un avis, décide ;
// recours de 30 jours ; effets d'un recours accepté) sont prouvées sur un vrai PostgreSQL
// (packages/db/test/litiges.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InvalidMobileTokenError, MOBILE_TOKEN_VERIFIER } from '../auth/mobile-token';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { SignerUnavailableError } from '../certificates/vault-signer';
import { ENV, type Env } from '../config/env';
import { PractitionerGuard } from '../dossiers/dossiers.controller';
import { PIECE_STORAGE } from '../dossiers/piece-storage';
import { DisputesController, PractitionerDisputesController } from './disputes.controller';
import {
  DisputeNotAllowedError,
  DisputeNotFoundError,
  DisputeRefusedError,
  DisputesRepository,
} from './disputes.repository';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '44444444-4444-4444-8444-444444444444';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const calls: unknown[][] = [];
let failure: Error | null = null;
const repository = {
  async mine(sub: string) {
    calls.push(['mine', sub]);
    if (failure) throw failure;
    return { recoursPossible: true, recoursJusquau: '2026-12-14', litiges: [] };
  },
  async queue(sub: string) {
    calls.push(['queue', sub]);
    if (failure) throw failure;
    return { items: [], suivant: null, total: 0 };
  },
  async detail(sub: string, code: string) {
    calls.push(['detail', sub, code]);
    if (failure) throw failure;
    return {
      code,
      statut: code === 'LT-00002' ? 'resolu' : 'avis_rendu',
      avisSens: 'favorable',
      avis: 'Pièce authentique.',
      avisLe: '2026-11-20T08:00:00Z',
    };
  },
  async open(sub: string, _ip: unknown, input: unknown) {
    calls.push(['open', sub, input]);
    if (failure) throw failure;
    return { code: 'LT-00001' };
  },
  async message(sub: string, _ip: unknown, code: string, contenu: string) {
    calls.push(['message', sub, code, contenu]);
    if (failure) throw failure;
  },
  async addPiece(sub: string, _ip: unknown, code: string, file: { mime: string }) {
    calls.push(['piece', sub, code, file.mime]);
    if (failure) throw failure;
    return { id: 1 };
  },
  async piece(sub: string, code: string, id: number) {
    calls.push(['download', sub, code, id]);
    if (failure) throw failure;
    return { key: 'litiges/x.jpg', mime: 'image/jpeg' };
  },
  async opinion(sub: string, _ip: unknown, code: string, input: unknown) {
    calls.push(['opinion', sub, code, input]);
    if (failure) throw failure;
  },
  async decide(sub: string, _ip: unknown, code: string, input: unknown) {
    calls.push(['decide', sub, code, input]);
    if (failure) throw failure;
    return { certificat: 'SAB-2026-PR1042-ABC' };
  },
};
const stored: string[] = [];
const removed: string[] = [];
const storage = {
  async put(key: string) {
    stored.push(key);
  },
  async get() {
    return JPEG;
  },
  async remove(key: string) {
    removed.push(key);
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
  username: 'regional.labe@sabou-sante.gn',
  name: 'Alpha Barry',
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
    controllers: [PractitionerDisputesController, DisputesController],
    providers: [
      { provide: DisputesRepository, useValue: repository },
      { provide: PIECE_STORAGE, useValue: storage },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: MOBILE_TOKEN_VERIFIER, useValue: mobileTokens },
      { provide: ENV, useValue: { ADMIN_APP_URL: `${APP_ORIGIN}/` } as Env },
      AdministratorGuard,
      PractitionerGuard,
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
    ['admin', session(['admin_regional', 'administrateur'])],
    ['sans-facteur', session(['admin_regional', 'administrateur'], false)],
  ]);
});

const practitioner = (method: string, path: string, body?: unknown, token = 'jeton.praticien.ok') =>
  fetch(`${base}/api/praticien/litiges${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined
        ? {}
        : { 'content-type': Buffer.isBuffer(body) ? 'image/jpeg' : 'application/json' }),
    },
    body:
      body === undefined
        ? undefined
        : Buffer.isBuffer(body)
          ? new Uint8Array(body)
          : JSON.stringify(body),
  });

const admin = (
  method: string,
  path: string,
  body?: unknown,
  { cookie = 'admin', origin = APP_ORIGIN } = {},
) =>
  fetch(`${base}/api/litiges${path}`, {
    method,
    headers: {
      cookie: `${SESSION_COOKIE}=${cookie}`,
      ...(origin ? { origin } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const OPEN = { type: 'recours', objet: '  Contestation du rejet  ', message: 'Pièce authentique.' };

describe('Espace du praticien (application mobile)', () => {
  it('liste ses litiges et dit s’il peut encore déposer un recours', async () => {
    const response = await practitioner('GET', '');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ recoursPossible: true });
    expect(calls).toEqual([['mine', SUB]]);
  });

  it('ouvre un recours : saisie nettoyée, code renvoyé', async () => {
    const response = await practitioner('POST', '', OPEN);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ code: 'LT-00001' });
    expect(calls).toEqual([['open', SUB, { ...OPEN, objet: 'Contestation du rejet' }]]);
  });

  it.each([
    ['sans objet', { ...OPEN, objet: ' ' }],
    ['type inconnu', { ...OPEN, type: 'plainte' }],
    ['champ en trop', { ...OPEN, extra: 1 }],
  ])('refuse une ouverture %s, sans appeler la base', async (_, body) => {
    expect((await practitioner('POST', '', body)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('refus de la base dits tels quels : délai dépassé, recours déjà ouvert', async () => {
    failure = new DisputeRefusedError('too_late', 'Le délai de recours de 30 jours est dépassé.');
    const response = await practitioner('POST', '', OPEN);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'too_late' });
  });

  it('sans jeton, jeton refusé ou compte citoyen : refusé avant la base', async () => {
    expect((await practitioner('GET', '', undefined, '')).status).toBe(401);
    expect((await practitioner('GET', '', undefined, 'jeton.faux')).status).toBe(401);
    expect((await practitioner('GET', '', undefined, 'jeton.citoyen.ok')).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('code de litige mal formé : 400 ; inconnu ou hors de ses litiges : 404', async () => {
    expect((await practitioner('GET', '/XX-1')).status).toBe(400);
    failure = new DisputeNotFoundError();
    expect((await practitioner('GET', '/LT-00009')).status).toBe(404);
  });

  it('message et pièce photo ; la pièce part au stockage sous une clé tirée au hasard', async () => {
    expect((await practitioner('POST', '/LT-00001/messages', { contenu: 'Voici.' })).status).toBe(
      204,
    );
    expect((await practitioner('POST', '/LT-00001/pieces', JPEG)).status).toBe(201);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^litiges\/[0-9a-f-]{36}\.jpg$/);
    expect(calls).toEqual([
      ['message', SUB, 'LT-00001', 'Voici.'],
      ['piece', SUB, 'LT-00001', 'image/jpeg'],
    ]);
  });

  it('pièce refusée par la base (litige résolu) : fichier retiré du stockage', async () => {
    failure = new DisputeRefusedError('resolved', 'Ce litige est résolu : il ne change plus.');
    expect((await practitioner('POST', '/LT-00001/pieces', JPEG)).status).toBe(409);
    expect(removed).toEqual(stored);
  });

  it('avis du régional caché au praticien tant que le recours n’est pas décidé', async () => {
    expect(await (await practitioner('GET', '/LT-00001')).json()).toMatchObject({
      avis: null,
      avisSens: null,
      avisLe: null,
    });
    expect(await (await practitioner('GET', '/LT-00002')).json()).toMatchObject({
      avis: 'Pièce authentique.',
    });
    expect((await (await admin('GET', '/LT-00001')).json()) as object).toMatchObject({
      avis: 'Pièce authentique.',
    });
  });

  it('pièce servie en pièce jointe, sans cache ni interprétation', async () => {
    const response = await practitioner('GET', '/LT-00001/pieces/1');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('Administration (gestion)', () => {
  it('file des litiges de la zone', async () => {
    const response = await admin('GET', '/a-arbitrer');
    expect(response.status).toBe(200);
    expect(calls).toEqual([['queue', SUB]]);
  });

  it('avis motivé et décision motivée transmis à la base', async () => {
    const avis = { sens: 'favorable', avis: 'Pièce authentique.' };
    expect((await admin('POST', '/LT-00001/avis', avis)).status).toBe(204);
    const decision = { issue: 'accepte', motif: 'Recours fondé.' };
    const response = await admin('POST', '/LT-00001/decision', decision);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ certificat: 'SAB-2026-PR1042-ABC' });
    expect(calls).toEqual([
      ['opinion', SUB, 'LT-00001', avis],
      ['decide', SUB, 'LT-00001', decision],
    ]);
  });

  it('décision sans motif : 400 sans appeler la base', async () => {
    expect((await admin('POST', '/LT-00001/decision', { issue: 'refuse', motif: '' })).status).toBe(
      400,
    );
    expect(calls).toEqual([]);
  });

  it('action d’un autre profil ou à une autre étape : 403', async () => {
    failure = new DisputeNotAllowedError();
    expect(
      (await admin('POST', '/LT-00001/decision', { issue: 'refuse', motif: 'Non fondé.' })).status,
    ).toBe(403);
  });

  it('coffre de signature indisponible : 503, rien n’est enregistré', async () => {
    failure = new SignerUnavailableError('coffre');
    const response = await admin('POST', '/LT-00001/decision', {
      issue: 'accepte',
      motif: 'Recours fondé.',
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'signer_unavailable' });
  });

  it('sans second facteur, ou écriture venue d’une autre origine : refusé', async () => {
    expect((await admin('GET', '/a-arbitrer', undefined, { cookie: 'sans-facteur' })).status).toBe(
      403,
    );
    expect(
      (
        await admin(
          'POST',
          '/LT-00001/messages',
          { contenu: 'x' },
          { origin: 'https://ailleurs.example' },
        )
      ).status,
    ).toBe(403);
    expect(calls).toEqual([]);
  });
});
