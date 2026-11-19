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
  PlantProposalLimitError,
  PlantProposalRefusedError,
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
  voix: [],
  contreIndications: [],
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
  async propose(sub: string, input: unknown) {
    calls.push(['propose', sub, input]);
    if (failure) throw failure;
    return { code: 'PL-007', nomFr: 'Kinkéliba rouge', nomScientifique: null, validee: false };
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
const TOKENS: Record<string, string[]> = {
  'jeton.praticien.ok': ['praticien'],
  'jeton.citoyen.ok': ['citoyen'],
};
const mobileTokens = {
  async verify(token: string) {
    const roles = TOKENS[token];
    if (!roles) throw new InvalidMobileTokenError();
    return { sub: SUB, roles };
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
  options: {
    cookie?: string | null;
    origin?: string | null;
    token?: string | null;
    body?: unknown;
  } = {},
) {
  // Par défaut : l'application mobile, avec le jeton du praticien (seule voie, US-068)
  const { cookie = null, origin = null, token = 'jeton.praticien.ok', body } = options;
  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
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
  it('sans jeton : 401 ; jeton d’un citoyen : 403', async () => {
    expect((await call('GET', 'traitements', { token: null })).status).toBe(401);
    expect((await call('GET', 'traitements', { token: 'jeton.citoyen.ok' })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  // US-068, critère 3 : le Studio n'est plus sur le site ; son cookie n'ouvre plus l'API
  it('refuse le cookie de session du site, même d’un praticien et depuis le site', async () => {
    const site = { token: null, cookie: 'praticien', origin: SITE };
    expect((await call('GET', 'traitements', site)).status).toBe(401);
    expect((await call('POST', 'traitements', { ...site, body: FIELDS })).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('application mobile : jeton du praticien accepté', async () => {
    const response = await call('GET', 'traitements');
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
          contreIndications: [],
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
    ['contre-indication mal formée', { contreIndications: ['Grossesse!'] }],
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

// US-054 : proposer une plante qui manque au Dictionnaire
describe('US-054 : proposition d’une plante par le praticien', () => {
  it('nom français seul : transmis à la base avec le compte du jeton, fiche en revue', async () => {
    const response = await call('POST', 'plantes', {
      body: { nomFr: '  Kinkéliba rouge ', description: 'Arbuste des savanes' },
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      code: 'PL-007',
      nomFr: 'Kinkéliba rouge',
      nomScientifique: null,
      validee: false,
    });
    expect(calls).toEqual([
      [
        'propose',
        SUB,
        {
          nomFr: 'Kinkéliba rouge',
          nomScientifique: null,
          famille: null,
          description: 'Arbuste des savanes',
        },
      ],
    ]);
  });

  it('nom français absent, champ inconnu ou auteur imposé : refusé avant la base', async () => {
    expect((await call('POST', 'plantes', { body: { nomFr: ' ' } })).status).toBe(400);
    expect(
      (await call('POST', 'plantes', { body: { nomFr: 'Plante', proposeePar: 'PR-1042' } })).status,
    ).toBe(400);
    expect(calls).toEqual([]);
  });

  it('nom scientifique déjà pris, ou trop de propositions en attente : 409 expliqué', async () => {
    failure = new PlantProposalRefusedError('Ce nom scientifique est déjà utilisé.');
    const duplicate = await call('POST', 'plantes', { body: { nomFr: 'Plante' } });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: 'duplicate' });
    failure = new PlantProposalLimitError('10 en attente.');
    const tooMany = await call('POST', 'plantes', { body: { nomFr: 'Plante' } });
    expect(tooMany.status).toBe(409);
    expect(await tooMany.json()).toMatchObject({ error: 'too_many' });
  });

  it('réservée au praticien : sans jeton 401, citoyen 403', async () => {
    expect((await call('POST', 'plantes', { token: null, body: { nomFr: 'P' } })).status).toBe(401);
    expect(
      (await call('POST', 'plantes', { token: 'jeton.citoyen.ok', body: { nomFr: 'P' } })).status,
    ).toBe(403);
    expect(calls).toEqual([]);
  });
});
