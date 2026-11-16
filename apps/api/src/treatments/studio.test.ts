// US-060 : Studio web du praticien à travers l'API (accès, contrôle des saisies, traduction des
// refus de la base). Base simulée ; les règles (brouillon seul modifiable, soumission complète,
// consentement, dossier joint, cloisonnement) sont prouvées sur un vrai PostgreSQL
// (packages/db/test/studio-traitement.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { TreatmentDetail, TreatmentFieldsInput } from '@sabou/types';
import { CITIZEN_SESSION_COOKIE } from '../auth/auth.controller';
import { InvalidMobileTokenError, MOBILE_TOKEN_VERIFIER } from '../auth/mobile-token';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { ENV } from '../config/env';
import { ZoneContextError } from '../database/zone';
import { PractitionerGuard } from '../dossiers/dossiers.controller';
import { StudioController } from './studio.controller';
import {
  StudioNoProfileError,
  StudioRepository,
  TreatmentIncompleteError,
  TreatmentLockedError,
  TreatmentNoDossierError,
  TreatmentStaleError,
} from './studio.repository';

const SITE = 'http://localhost:3000';
const SUB = '60606060-6060-4060-8060-606060606060';

const FIELDS: TreatmentFieldsInput = {
  maladie: 'MA-001',
  titreFr: 'Décoction de caïlcédrat',
  titreEn: '',
  cycleDureeJours: 7,
  cyclePrisesParJour: 2,
  cyclePauseJours: null,
  plantes: [
    { plante: 'PL-002', partie: 'feuilles' },
    { plante: 'PL-001', partie: ' écorce ' },
  ],
  sections: [{ type: 'preparation', texteFr: 'Faire bouillir.', texteEn: null }],
  consentement: true,
  visibilite: 'publique',
};
const DETAIL: TreatmentDetail = {
  code: 'REC-0001',
  titreFr: 'Décoction de caïlcédrat',
  titreEn: null,
  maladie: { code: 'MA-001', nomFr: 'Paludisme' },
  statut: 'brouillon',
  attenteRaison: null,
  cycleDureeJours: 7,
  cyclePrisesParJour: 2,
  cyclePauseJours: null,
  plantes: [],
  sections: [],
  visibilite: 'publique',
  consentementLe: '2026-11-16T10:00:00.000000Z',
  manques: ['sections'],
  dossier: null,
  dernierMotif: null,
  modifieLe: '2026-11-16T10:00:00.000000Z',
};

const calls: unknown[][] = [];
let failure: Error | null = null;
const repository = {
  async referentials() {
    return { maladies: [], plantes: [], sections: [] };
  },
  async list(sub: string) {
    calls.push(['list', sub]);
    if (failure) throw failure;
    return [];
  },
  async detail(sub: string, code: string) {
    calls.push(['detail', sub, code]);
    if (failure) throw failure;
    return DETAIL;
  },
  async save(sub: string, _ip: unknown, code: string | null, seen: string | null, fields: unknown) {
    calls.push(['save', sub, code, seen, fields]);
    if (failure) throw failure;
    return DETAIL;
  },
  async submit(sub: string, _ip: unknown, code: string) {
    calls.push(['submit', sub, code]);
    if (failure) throw failure;
    return { ...DETAIL, statut: 'soumise', dossier: 'DS-1041' };
  },
};
const session = (roles: string[]): SessionData => ({
  sub: SUB,
  username: '661234567',
  name: 'Sékou',
  roles,
  secondFactor: false,
  refreshToken: 'r',
  createdAt: Date.now(),
});
const sessions = {
  data: new Map<string, SessionData>(),
  async touch(id: string) {
    return this.data.get(id) ?? null;
  },
};
const mobileTokens = {
  async verify(token: string) {
    if (token !== 'jeton.praticien.ok') throw new InvalidMobileTokenError();
    return { sub: SUB, roles: ['praticien'] };
  },
};

let app: INestApplication;
let base: string;

beforeAll(async () => {
  @Module({
    controllers: [StudioController],
    providers: [
      PractitionerGuard,
      { provide: StudioRepository, useValue: repository },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: MOBILE_TOKEN_VERIFIER, useValue: mobileTokens },
      { provide: ENV, useValue: { SITE_URL: SITE } },
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
    ['praticien', session(['praticien'])],
    ['citoyen', session(['citoyen'])],
  ]);
});

function call(
  method: string,
  path: string,
  options: { cookie?: string | null; origin?: string | null; body?: unknown } = {},
) {
  const { cookie = 'praticien', origin = SITE, body } = options;
  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = `${CITIZEN_SESSION_COOKIE}=${cookie}`;
  if (origin) headers['origin'] = origin;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${base}/api/praticien/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('Accès : le praticien connecté seulement, toujours ses propres traitements', () => {
  it('sans session : 401 ; citoyen : 403 ; écriture d’une autre origine : 403', async () => {
    expect((await call('GET', 'traitements', { cookie: null })).status).toBe(401);
    expect((await call('GET', 'traitements', { cookie: 'citoyen' })).status).toBe(403);
    expect(
      (await call('POST', 'traitements', { origin: 'https://evil.example', body: FIELDS })).status,
    ).toBe(403);
    expect(calls).toEqual([]);
  });

  it('application mobile : jeton du praticien accepté', async () => {
    const response = await fetch(`${base}/api/praticien/traitements`, {
      headers: { authorization: 'Bearer jeton.praticien.ok' },
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual([['list', SUB]]);
  });

  it('aucun identifiant de praticien accepté : le compte vient de la session', async () => {
    const response = await call('POST', 'traitements', {
      body: { ...FIELDS, praticien: 'PR-1042' },
    });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('compte suspendu entre-temps : 403 ; sans fiche de praticien : 409 expliqué', async () => {
    failure = new ZoneContextError();
    expect((await call('GET', 'traitements')).status).toBe(403);
    failure = new StudioNoProfileError();
    const response = await call('POST', 'traitements', { body: FIELDS });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'no_profile' });
  });

  it('réponses jamais mises en cache, sauf les listes du formulaire (privé, 5 min)', async () => {
    expect((await call('GET', 'traitements')).headers.get('cache-control')).toBe('no-store');
    expect((await call('GET', 'studio/referentiels')).headers.get('cache-control')).toBe(
      'private, max-age=300',
    );
  });
});

describe('Critère : maladie, plantes ordonnées avec partie utilisée, cycle, sections', () => {
  it('création : champs nettoyés et transmis tels quels, dans l’ordre des plantes', async () => {
    const response = await call('POST', 'traitements', { body: FIELDS });
    expect(response.status).toBe(201);
    expect(calls).toEqual([
      [
        'save',
        SUB,
        null,
        null,
        {
          ...FIELDS,
          titreEn: null,
          plantes: [
            { plante: 'PL-002', partie: 'feuilles' },
            { plante: 'PL-001', partie: 'écorce' },
          ],
        },
      ],
    ]);
  });

  it.each([
    ['sans titre', { titreFr: ' ' }],
    ['maladie mal formée', { maladie: 'paludisme' }],
    ['plante en double', { plantes: [{ plante: 'PL-001' }, { plante: 'PL-001' }] }],
    [
      '16 plantes',
      { plantes: Array.from({ length: 16 }, (_, i) => ({ plante: `PL-${100 + i}` })) },
    ],
    ['durée nulle', { cycleDureeJours: 0 }],
    ['11 prises par jour', { cyclePrisesParJour: 11 }],
    ['durée décimale', { cycleDureeJours: 2.5 }],
    ['section inconnue', { sections: [{ type: 'posologie', texteFr: 'x' }] }],
    ['section trop longue', { sections: [{ type: 'cycle', texteFr: 'x'.repeat(4001) }] }],
    ['texte en langue nationale', { titreMal: 'x' }],
  ])('%s : refusé (400) sans appel à la base', async (_label, change) => {
    const response = await call('POST', 'traitements', { body: { ...FIELDS, ...change } });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('Critère : consentement et niveau de visibilité obligatoires avant soumission', () => {
  it('consentement sans niveau de visibilité : refusé, message clair', async () => {
    const response = await call('POST', 'traitements', { body: { ...FIELDS, visibilite: null } });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('niveau de visibilité');
  });

  it('soumission d’un traitement incomplet : 422 avec la liste des manques', async () => {
    failure = new TreatmentIncompleteError(['consentement', 'sections']);
    const response = await call('POST', 'traitements/REC-0001/soumission');
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ gaps: ['consentement', 'sections'] });
  });

  it('soumission : traitement « soumis », joint au dossier du praticien non certifié', async () => {
    const response = await call('POST', 'traitements/REC-0001/soumission');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ statut: 'soumise', dossier: 'DS-1041' });
    expect(calls).toEqual([['submit', SUB, 'REC-0001']]);
  });

  it('pas de dossier en cours ni de certification : 409 expliqué', async () => {
    failure = new TreatmentNoDossierError();
    const response = await call('POST', 'traitements/REC-0001/soumission');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'no_dossier' });
  });
});

describe('Modification d’un brouillon', () => {
  it('date de lecture transmise ; traitement soumis ou modifié entre-temps : 409', async () => {
    const seen = '2026-11-16T10:00:00.000000Z';
    expect(
      (await call('PUT', 'traitements/REC-0001', { body: { vueLe: seen, fields: FIELDS } })).status,
    ).toBe(200);
    expect(calls[0]!.slice(2, 4)).toEqual(['REC-0001', seen]);
    failure = new TreatmentLockedError();
    expect(
      await (
        await call('PUT', 'traitements/REC-0001', { body: { vueLe: seen, fields: FIELDS } })
      ).json(),
    ).toMatchObject({ error: 'locked' });
    failure = new TreatmentStaleError();
    expect(
      await (
        await call('PUT', 'traitements/REC-0001', { body: { vueLe: seen, fields: FIELDS } })
      ).json(),
    ).toMatchObject({ error: 'stale' });
  });

  it('code mal formé : 400', async () => {
    expect((await call('GET', 'traitements/1;DROP')).status).toBe(400);
  });
});

describe('Critère : raison de l’attente lue sur le traitement (US-046)', () => {
  it('le détail renvoie la raison enregistrée sur le traitement', async () => {
    const response = await call('GET', 'traitements/REC-0001');
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('attenteRaison');
  });
});
