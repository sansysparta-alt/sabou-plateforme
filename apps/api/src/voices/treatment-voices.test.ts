// US-075 : accès aux voix des traitements, contrôle des saisies, traduction des refus de la
// base, écoute. Base et stockage simulés ; les règles (zone, statut du traitement, droits par
// langue, historique, journal) sont prouvées sur un vrai PostgreSQL
// (packages/db/test/resume-voix-locale.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { TreatmentVoices } from '@sabou/types';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { PIECE_STORAGE } from '../dossiers/piece-storage';
import {
  NameVoiceDepositError,
  NameVoiceNotAllowedError,
  NameVoiceNotFoundError,
  NameVoiceSelfValidationError,
  NameVoiceTransitionError,
} from './name-voices.repository';
import { TreatmentVoicesController } from './treatment-voices.controller';
import {
  TreatmentNotRevisableError,
  TreatmentTextError,
  TreatmentVoicesRepository,
} from './treatment-voices.repository';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '33333333-3333-4333-8333-333333333333';

const VOICES: TreatmentVoices = {
  code: 'REC-0001',
  titre: 'Infusion',
  statut: 'soumise',
  praticien: 'Mamadou Diallo',
  peutReviser: true,
  prefectoral: true,
  comite: false,
  sections: [],
  nomsPlantes: [],
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
  async coverage(sub: string) {
    calls.push(['coverage', sub]);
    fail();
    return { langues: [], retards: [] };
  },
  async publish(sub: string, _ip: unknown, langue: string | null) {
    calls.push(['publish', sub, langue]);
    fail();
    return { publiees: 2, bloquees: 1 };
  },
  async detail(sub: string, code: string) {
    calls.push(['detail', sub, code]);
    fail();
    return VOICES;
  },
  async revise(sub: string, _ip: unknown, code: string, type: string, text: unknown) {
    calls.push(['revise', sub, code, type, text]);
    fail();
    return VOICES;
  },
  async record(
    sub: string,
    _ip: unknown,
    code: string,
    type: string,
    langue: string,
    depot: number,
  ) {
    calls.push(['record', sub, code, type, langue, depot]);
    fail();
    return VOICES;
  },
  async move(sub: string, _ip: unknown, code: string, type: string, langue: string, move: unknown) {
    calls.push(['move', sub, code, type, langue, move]);
    fail();
    return VOICES;
  },
  async plantFile(sub: string, code: string, plante: string, fallback: boolean) {
    calls.push(['plantFile', sub, code, plante, fallback]);
    fail();
    return { key: 'voix/a.webm', mime: 'audio/webm' };
  },
  async file(sub: string, code: string, type: string, langue: string, fallback: boolean) {
    calls.push(['file', sub, code, type, langue, fallback]);
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
    controllers: [TreatmentVoicesController],
    providers: [
      { provide: TreatmentVoicesRepository, useValue: repository },
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

const BASE = '/api/voix-des-traitements';

describe('Accès aux voix des traitements', () => {
  it('administrateur avec second facteur : la liste et le détail', async () => {
    expect((await request('GET', BASE)).status).toBe(200);
    expect((await request('GET', `${BASE}/REC-0001`)).status).toBe(200);
    expect(calls).toEqual([
      ['targets', SUB],
      ['detail', SUB, 'REC-0001'],
    ]);
  });

  it('sans second facteur, praticien, sans session : refusé, la base n’est pas appelée', async () => {
    expect((await request('GET', BASE, undefined, { cookie: 'sans-facteur' })).status).toBe(403);
    expect((await request('GET', BASE, undefined, { cookie: 'praticien' })).status).toBe(403);
    expect((await request('GET', BASE, undefined, { cookie: 'inconnu' })).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('code, section et langue contrôlés avant la base', async () => {
    expect((await request('GET', `${BASE}/PL-001`)).status).toBe(400);
    expect((await request('POST', `${BASE}/REC-0001/posologie/pul`, { depot: 1 })).status).toBe(
      400,
    );
    expect((await request('POST', `${BASE}/REC-0001/cycle/PULAAR`, { depot: 1 })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('Critère : texte français par section', () => {
  it('révision : texte nettoyé, anglais vide ramené à null', async () => {
    const response = await request('PATCH', `${BASE}/REC-0001/preparation`, {
      texteFr: '  Faire bouillir  ',
      texteEn: '',
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      ['revise', SUB, 'REC-0001', 'preparation', { texteFr: 'Faire bouillir', texteEn: null }],
    ]);
  });

  it('texte vide ou trop long refusé avant la base', async () => {
    expect((await request('PATCH', `${BASE}/REC-0001/cycle`, { texteFr: '  ' })).status).toBe(400);
    expect(
      (await request('PATCH', `${BASE}/REC-0001/cycle`, { texteFr: 'a'.repeat(4001) })).status,
    ).toBe(400);
    expect(calls).toEqual([]);
  });

  it('refus de la base traduits en clair', async () => {
    const cases: [Error, number, string][] = [
      [new NameVoiceNotAllowedError(), 403, 'not_allowed'],
      [new TreatmentNotRevisableError(), 409, 'not_revisable'],
      [new TreatmentTextError(), 400, 'invalid_text'],
      [new NameVoiceNotFoundError(), 404, 'not_found'],
    ];
    for (const [error, status, code] of cases) {
      failure = error;
      const response = await request('PATCH', `${BASE}/REC-0001/cycle`, { texteFr: 'Trois jours' });
      expect(response.status).toBe(status);
      expect(((await response.json()) as { error: string }).error).toBe(code);
    }
  });
});

describe('Critère : voix locale par section, envoi au régional', () => {
  it('enregistrer : le dépôt traité ; envoyer : statut « traduit »', async () => {
    expect(
      (await request('POST', `${BASE}/REC-0001/effets_indesirables/pul`, { depot: 42 })).status,
    ).toBe(200);
    expect(
      (
        await request('POST', `${BASE}/REC-0001/effets_indesirables/pul/statut`, {
          vers: 'traduit',
        })
      ).status,
    ).toBe(200);
    expect(calls).toEqual([
      ['record', SUB, 'REC-0001', 'effets_indesirables', 'pul', 42],
      ['move', SUB, 'REC-0001', 'effets_indesirables', 'pul', { vers: 'traduit', motif: null }],
    ]);
  });

  it('statut inconnu refusé ; refus de la base traduits', async () => {
    expect(
      (await request('POST', `${BASE}/REC-0001/cycle/pul/statut`, { vers: 'archive' })).status,
    ).toBe(400);
    const cases: [Error, number, string][] = [
      [new NameVoiceTransitionError(), 409, 'stale'],
      [new NameVoiceDepositError(), 409, 'voice_not_ready'],
    ];
    for (const [error, status, code] of cases) {
      failure = error;
      const response = await request('POST', `${BASE}/REC-0001/cycle/pul`, { depot: 3 });
      expect(response.status).toBe(status);
      expect(((await response.json()) as { error: string }).error).toBe(code);
    }
  });
});

describe('Critère US-072 : validation ou renvoi motivé', () => {
  it('valider, renvoyer avec motif ; renvoi sans motif refusé avant la base', async () => {
    const path = `${BASE}/REC-0001/cycle/pul/statut`;
    expect((await request('POST', path, { vers: 'valide' })).status).toBe(200);
    expect((await request('POST', path, { vers: 'brouillon' })).status).toBe(400);
    expect((await request('POST', path, { vers: 'brouillon', motif: ' Mal dit ' })).status).toBe(
      200,
    );
    expect(calls.map((c) => c[5])).toEqual([
      { vers: 'valide', motif: null },
      { vers: 'brouillon', motif: 'Mal dit' },
    ]);
  });

  it('valideur qui a enregistré ou envoyé la voix : refus traduit en clair', async () => {
    failure = new NameVoiceSelfValidationError();
    const response = await request('POST', `${BASE}/REC-0001/cycle/pul/statut`, { vers: 'valide' });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe('self_validation');
  });
});

describe('Critère US-073 : contrôle des effets indésirables par le Comité', () => {
  it('contrôler, ou renvoyer avec motif obligatoire ; seulement sur les effets indésirables', async () => {
    const path = `${BASE}/REC-0001/effets_indesirables/pul/statut`;
    expect((await request('POST', path, { vers: 'controle' })).status).toBe(200);
    expect((await request('POST', path, { vers: 'controle_refuse' })).status).toBe(400);
    expect(
      (await request('POST', path, { vers: 'controle_refuse', motif: 'Contre-indication omise' }))
        .status,
    ).toBe(200);
    expect(calls.map((c) => [c[3], c[5]])).toEqual([
      ['effets_indesirables', { vers: 'controle', motif: null }],
      ['effets_indesirables', { vers: 'controle_refuse', motif: 'Contre-indication omise' }],
    ]);
  });
});

describe('Critères US-074 : couverture par langue, publication groupée', () => {
  it('couverture : pas prise pour un code de traitement', async () => {
    expect((await request('GET', `${BASE}/couverture`)).status).toBe(200);
    expect(calls).toEqual([['coverage', SUB]]);
  });

  it('publication groupée : toutes les langues ou une seule ; langue contrôlée', async () => {
    const all = await request('POST', `${BASE}/publication`, {});
    expect(await all.json()).toEqual({ publiees: 2, bloquees: 1 });
    await request('POST', `${BASE}/publication`, { langue: 'pul' });
    expect((await request('POST', `${BASE}/publication`, { langue: 'PULAAR' })).status).toBe(400);
    expect(calls).toEqual([
      ['publish', SUB, null],
      ['publish', SUB, 'pul'],
    ]);
  });

  it('publication par un autre profil : refus de la base traduit', async () => {
    failure = new NameVoiceNotAllowedError();
    expect((await request('POST', `${BASE}/publication`, {})).status).toBe(403);
  });
});

describe('Écoute', () => {
  it('Opus par défaut, AAC en secours ; en-têtes stricts', async () => {
    const opus = await request('GET', `${BASE}/REC-0001/cycle/pul/audio`);
    expect(opus.status).toBe(200);
    expect(opus.headers.get('content-type')).toBe('audio/webm');
    expect(opus.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await opus.text()).toBe('opus');
    const aac = await request('GET', `${BASE}/REC-0001/cycle/pul/audio?format=aac`);
    expect(aac.headers.get('content-type')).toBe('audio/mp4');
  });

  // US-081 : nom d'une plante dit par le praticien (préfectoral et Comité, contrôle en base)
  it('nom d’une plante dit par le praticien ; code de plante contrôlé ; absent : 404', async () => {
    const ok = await request('GET', `${BASE}/REC-0001/plante/PL-003/audio`);
    expect(ok.status).toBe(200);
    expect(calls.at(-1)).toEqual(['plantFile', SUB, 'REC-0001', 'PL-003', false]);
    calls.length = 0;
    expect((await request('GET', `${BASE}/REC-0001/plante/..%2Fx/audio`)).status).toBe(400);
    expect(calls).toEqual([]);
    failure = new NameVoiceNotFoundError();
    expect((await request('GET', `${BASE}/REC-0001/plante/PL-003/audio`)).status).toBe(404);
  });
});
