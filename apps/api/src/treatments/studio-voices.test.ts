// US-081 : voix du praticien au Studio mobile à travers l'API (accès, clé d'envoi rejouable,
// format, traduction des refus de la base). Base et stockage simulés ; les règles (cible,
// consentement, brouillon, historique, envoi rejoué sans doublon) sont prouvées sur un vrai
// PostgreSQL (packages/db/test/studio-voix-praticien.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InvalidMobileTokenError, MOBILE_TOKEN_VERIFIER } from '../auth/mobile-token';
import { SESSION_STORE } from '../auth/session.store';
import { ENV } from '../config/env';
import { PractitionerGuard } from '../dossiers/dossiers.controller';
import { PIECE_STORAGE } from '../dossiers/piece-storage';
import { TreatmentLockedError } from './studio.repository';
import { StudioVoicesController } from './studio-voices.controller';
import {
  StudioVoicesRepository,
  VoiceAbsentError,
  VoiceConsentRequiredError,
  VoiceRateLimitError,
} from './studio-voices.repository';

const SUB = '81818181-8181-4181-8181-818181818181';
const KEY = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const M4A = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from('ftypM4A '),
  Buffer.alloc(64, 3),
]);

const calls: unknown[][] = [];
const stored = new Map<string, Buffer>();
let failure: Error | null = null;
let alreadyKnown = false;
const repository = {
  async known(sub: string, key: string) {
    calls.push(['known', sub, key]);
    return alreadyKnown;
  },
  async deposit(...args: unknown[]) {
    const [sub, , code, cible, objet, key, upload] = args as [
      string,
      unknown,
      string,
      string,
      string,
      string,
      { key: string; mime: string; size: number; sha256: string },
    ];
    calls.push(['deposit', sub, code, cible, objet, key, upload.mime, upload.size]);
    if (failure) throw failure;
    return 12;
  },
  async remove(sub: string, _ip: unknown, code: string, cible: string, objet: string) {
    calls.push(['remove', sub, code, cible, objet]);
    if (failure) throw failure;
    return true;
  },
  async list(sub: string, code: string) {
    calls.push(['list', sub, code]);
    return [];
  },
  async file(sub: string, code: string, cible: string, objet: string) {
    calls.push(['file', sub, code, cible, objet]);
    if (failure) throw failure;
    return { key: 'voix/traitee.m4a', mime: 'audio/mp4' };
  },
};
const storage = {
  async put(key: string, body: Buffer) {
    stored.set(key, body);
  },
  async get(key: string) {
    return key === 'voix/traitee.m4a' ? M4A : (stored.get(key) ?? null);
  },
  async remove(key: string) {
    stored.delete(key);
  },
};
const mobileTokens = {
  async verify(token: string) {
    const roles = { 'jeton.praticien.ok': ['praticien'], 'jeton.citoyen.ok': ['citoyen'] }[token];
    if (!roles) throw new InvalidMobileTokenError();
    return { sub: SUB, roles };
  },
};

let app: INestApplication;
let base: string;

beforeAll(async () => {
  @Module({
    controllers: [StudioVoicesController],
    providers: [
      PractitionerGuard,
      { provide: StudioVoicesRepository, useValue: repository },
      { provide: PIECE_STORAGE, useValue: storage },
      { provide: SESSION_STORE, useValue: { touch: async () => null } },
      { provide: MOBILE_TOKEN_VERIFIER, useValue: mobileTokens },
      { provide: ENV, useValue: { SITE_URL: 'http://localhost:3000' } },
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
  stored.clear();
  failure = null;
  alreadyKnown = false;
});

const PATH = 'traitements/REC-0001/voix/section/preparation';
function call(
  method: string,
  path = PATH,
  options: { token?: string | null; body?: Buffer; key?: string | null } = {},
) {
  const { token = 'jeton.praticien.ok', body, key = KEY } = options;
  const headers: Record<string, string> = { 'content-type': 'audio/mp4' };
  if (token) headers['authorization'] = `Bearer ${token}`;
  const query = method === 'PUT' && key ? `?cle=${key}` : '';
  return fetch(`${base}/api/praticien/${path}${query}`, {
    method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
  });
}

describe('Accès : le praticien connecté, par le jeton de l’application', () => {
  it('sans jeton : 401 ; jeton d’un citoyen : 403', async () => {
    expect((await call('PUT', PATH, { token: null, body: M4A })).status).toBe(401);
    expect((await call('PUT', PATH, { token: 'jeton.citoyen.ok', body: M4A })).status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe('Critère : un enregistrement par champ (section ou plante)', () => {
  it('dépose la voix d’une section, rangée sous une clé tirée au hasard', async () => {
    const response = await call('PUT', PATH, { body: M4A });
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      ['known', SUB, KEY],
      ['deposit', SUB, 'REC-0001', 'section', 'preparation', KEY, 'audio/mp4', M4A.length],
      ['list', SUB, 'REC-0001'],
    ]);
    expect([...stored.keys()]).toEqual([
      expect.stringMatching(/^voix\/originaux\/[0-9a-f-]{36}\.m4a$/),
    ]);
  });

  it('dépose la voix du nom d’une plante', async () => {
    const response = await call('PUT', 'traitements/REC-0001/voix/plante/PL-003', { body: M4A });
    expect(response.status).toBe(200);
    expect(calls[1]).toEqual([
      'deposit',
      SUB,
      'REC-0001',
      'plante',
      'PL-003',
      KEY,
      'audio/mp4',
      M4A.length,
    ]);
  });

  it('cible, objet ou clé invalides : 400 sans dépôt', async () => {
    for (const path of [
      'traitements/REC-0001/voix/titre/preparation',
      'traitements/REC-0001/voix/section/posologie',
      'traitements/REC-0001/voix/plante/..%2F..',
    ]) {
      expect((await call('PUT', path, { body: M4A })).status).toBe(400);
    }
    expect((await call('PUT', PATH, { body: M4A, key: null })).status).toBe(400);
    expect((await call('PUT', PATH, { body: M4A, key: 'pas-une-cle' })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('fichier qui n’est pas un enregistrement : 415, rien n’est rangé', async () => {
    const response = await call('PUT', PATH, { body: Buffer.from('<html>pas une voix</html>') });
    expect(response.status).toBe(415);
    expect(stored.size).toBe(0);
  });

  it('plus de 3 Mo : 413', async () => {
    const response = await call('PUT', PATH, {
      body: Buffer.concat([M4A, Buffer.alloc(3 * 1024 * 1024)]),
    });
    expect(response.status).toBe(413);
  });

  it('retirer sa voix, puis réécouter la voix traitée (AAC)', async () => {
    expect((await call('DELETE')).status).toBe(200);
    const audio = await call('GET', `${PATH}/audio`);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/mp4');
    expect(audio.headers.get('cache-control')).toBe('private, no-store');
    expect(audio.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('Critère : envoi au retour du réseau, sans doublon', () => {
  it('clé déjà reçue (envoi rejoué après une coupure) : rien n’est rangé ni déposé', async () => {
    alreadyKnown = true;
    const response = await call('PUT', PATH, { body: M4A });
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      ['known', SUB, KEY],
      ['list', SUB, 'REC-0001'],
    ]);
    expect(stored.size).toBe(0);
  });

  it('refus de la base : le fichier rangé est effacé', async () => {
    failure = new TreatmentLockedError();
    expect((await call('PUT', PATH, { body: M4A })).status).toBe(409);
    expect(stored.size).toBe(0);
  });
});

describe('Refus de la base traduits', () => {
  it('sans consentement : 409 consent_required ; trop d’envois : 429 ; voix absente : 404', async () => {
    failure = new VoiceConsentRequiredError();
    const consent = await call('PUT', PATH, { body: M4A });
    expect(consent.status).toBe(409);
    expect(await consent.json()).toMatchObject({ error: 'consent_required' });
    failure = new VoiceRateLimitError();
    expect((await call('PUT', PATH, { body: M4A })).status).toBe(429);
    failure = new VoiceAbsentError();
    expect((await call('GET', `${PATH}/audio`)).status).toBe(404);
  });
});
