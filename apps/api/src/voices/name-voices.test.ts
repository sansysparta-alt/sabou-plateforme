// US-071 : accès aux voix des noms, contrôle des saisies, traduction des refus de la base,
// écoute. Base et stockage simulés ; les règles (statuts, droits par langue, séparation des
// tâches, consentement, journal) sont prouvées sur un vrai PostgreSQL
// (packages/db/test/voix-des-noms.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NameVoices } from '@sabou/types';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { PIECE_STORAGE } from '../dossiers/piece-storage';
import { NameVoicesController } from './name-voices.controller';
import {
  NameVoiceConsentError,
  NameVoiceNotAllowedError,
  NameVoicesRepository,
  NameVoiceSelfValidationError,
  NameVoiceTransitionError,
} from './name-voices.repository';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '66666666-6666-4666-8666-666666666666';

const VOICES: NameVoices = {
  objet: 'plante',
  code: 'PL-002',
  nom: 'Vernonie',
  dg: false,
  voix: [],
};

const calls: unknown[][] = [];
let failure: Error | null = null;
const fail = () => {
  if (failure) throw failure;
};
const repository = {
  async targets(sub: string) {
    calls.push(['targets', sub]);
    return [];
  },
  async detail(sub: string, objet: string, code: string) {
    calls.push(['detail', sub, objet, code]);
    fail();
    return VOICES;
  },
  async record(
    sub: string,
    _ip: unknown,
    objet: string,
    code: string,
    langue: string,
    depot: number,
  ) {
    calls.push(['record', sub, objet, code, langue, depot]);
    fail();
    return VOICES;
  },
  async move(
    sub: string,
    _ip: unknown,
    objet: string,
    code: string,
    langue: string,
    vers: string,
    motif: string | null,
  ) {
    calls.push(['move', sub, objet, code, langue, vers, motif]);
    fail();
    return VOICES;
  },
  async file(sub: string, objet: string, code: string, langue: string, fallback: boolean) {
    calls.push(['file', sub, objet, code, langue, fallback]);
    fail();
    return fallback
      ? { key: 'voix/a.m4a', mime: 'audio/mp4' }
      : { key: 'voix/a.webm', mime: 'audio/webm' };
  },
};
const files = new Map<string, Buffer>([
  ['voix/a.webm', Buffer.from('opus')],
  ['voix/a.m4a', Buffer.from('aac')],
]);
const storage = {
  async put() {},
  async get(key: string) {
    return files.get(key) ?? null;
  },
  async remove() {},
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
    controllers: [NameVoicesController],
    providers: [
      { provide: NameVoicesRepository, useValue: repository },
      { provide: PIECE_STORAGE, useValue: storage },
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
    ['regional', session(['admin_regional', 'administrateur'])],
    ['sans-facteur', session(['admin_regional', 'administrateur'], false)],
    ['praticien', session(['praticien'])],
  ]);
});

const request = (
  method: string,
  path: string,
  body?: unknown,
  { cookie = 'regional', origin = APP_ORIGIN } = {},
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

describe('Accès aux voix des noms', () => {
  it('administrateur avec second facteur : la fiche et ses langues', async () => {
    const response = await request('GET', '/api/voix-des-noms/plante/PL-002');
    expect(response.status).toBe(200);
    expect(calls).toEqual([['detail', SUB, 'plante', 'PL-002']]);
  });

  it('sans second facteur, praticien, sans session : refusé, la base n’est pas appelée', async () => {
    const path = '/api/voix-des-noms';
    expect((await request('GET', path, undefined, { cookie: 'sans-facteur' })).status).toBe(403);
    expect((await request('GET', path, undefined, { cookie: 'praticien' })).status).toBe(403);
    expect((await request('GET', path, undefined, { cookie: 'inconnu' })).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('code et objet contrôlés : une maladie a un code MA-, une plante PL-', async () => {
    expect((await request('GET', '/api/voix-des-noms/plante/MA-001')).status).toBe(400);
    expect((await request('GET', '/api/voix-des-noms/recette/PL-001')).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('Critère : statuts Brouillon → Traduit → Validé → Publié par langue', () => {
  it('enregistrer : le dépôt de voix traité', async () => {
    const response = await request('POST', '/api/voix-des-noms/plante/PL-002/pul', { depot: 42 });
    expect(response.status).toBe(200);
    expect(calls).toEqual([['record', SUB, 'plante', 'PL-002', 'pul', 42]]);
  });

  it('chaque statut passe par la base ; renvoi sans motif refusé avant elle', async () => {
    for (const vers of ['traduit', 'valide', 'publie']) {
      await request('POST', '/api/voix-des-noms/maladie/MA-001/mal/statut', { vers });
    }
    expect(
      (await request('POST', '/api/voix-des-noms/maladie/MA-001/mal/statut', { vers: 'brouillon' }))
        .status,
    ).toBe(400);
    await request('POST', '/api/voix-des-noms/maladie/MA-001/mal/statut', {
      vers: 'brouillon',
      motif: '  Nom mal prononcé ',
    });
    expect(calls.map((c) => [c[5], c[6]])).toEqual([
      ['traduit', null],
      ['valide', null],
      ['publie', null],
      ['brouillon', 'Nom mal prononcé'],
    ]);
  });

  it('refus de la base traduits en clair', async () => {
    const cases: [Error, number, string][] = [
      [new NameVoiceSelfValidationError(), 403, 'self_validation'],
      [new NameVoiceNotAllowedError(), 403, 'not_allowed'],
      [new NameVoiceConsentError(), 409, 'consent_missing'],
      [new NameVoiceTransitionError(), 409, 'stale'],
    ];
    for (const [error, status, code] of cases) {
      failure = error;
      const response = await request('POST', '/api/voix-des-noms/plante/PL-002/pul/statut', {
        vers: 'valide',
      });
      expect(response.status).toBe(status);
      expect(((await response.json()) as { error: string }).error).toBe(code);
    }
  });
});

describe('Écoute', () => {
  it('Opus par défaut, AAC en secours ; en-têtes stricts', async () => {
    const opus = await request('GET', '/api/voix-des-noms/plante/PL-002/pul/audio');
    expect(opus.status).toBe(200);
    expect(opus.headers.get('content-type')).toBe('audio/webm');
    expect(opus.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await opus.text()).toBe('opus');
    const aac = await request('GET', '/api/voix-des-noms/plante/PL-002/pul/audio?format=aac');
    expect(aac.headers.get('content-type')).toBe('audio/mp4');
  });
});
