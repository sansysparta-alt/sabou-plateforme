// US-040c : dossier terrain de l'admin préfectoral, à travers l'API. Base, Keycloak et
// stockage simulés ; les règles elles-mêmes (préfectoral de la préfecture, auteur du dossier,
// pièces, soumission, SMS en file) sont prouvées sur un vrai PostgreSQL
// (packages/db/test/dossier-terrain.test.ts) et de bout en bout (apps/admin/e2e/dossier-terrain.spec.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { FieldDossierCreate } from '@sabou/types';
import { AccountExistsError } from '../accounts/identity-admin';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { PIECE_STORAGE } from '../dossiers/piece-storage';
import {
  CITIZEN_IDENTITY,
  type CitizenIdentity,
  type NewCitizen,
} from '../signup/citizen-identity';
import { FieldDossiersController } from './field-dossiers.controller';
import {
  AgentNotDesignableError,
  DesignationForbiddenError,
  FieldDossierForbiddenError,
  FieldDossierNotFoundError,
  FieldDossiersRepository,
  PhoneTakenError,
  type FieldSubmitResult,
} from './field-dossiers.repository';
import { FieldDossiersService } from './field-dossiers.service';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '33333333-3333-4333-8333-333333333333';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const CODE = 'DS-000042';

const calls: unknown[][] = [];
let failure: Error | null = null;
let submitResult: FieldSubmitResult = {
  status: 'submitted',
  code: CODE,
  submittedAt: '2026-11-18T10:00:00.000Z',
};
const repository = {
  async open(sub: string, _ip: unknown, keycloakId: string, input: FieldDossierCreate) {
    calls.push(['open', sub, keycloakId, input]);
    if (failure) throw failure;
    return { code: CODE };
  },
  async list(sub: string) {
    calls.push(['list', sub]);
    return [];
  },
  async addPiece(sub: string, code: string, piece: { type: string; mime: string }) {
    calls.push(['addPiece', sub, code, piece.type, piece.mime]);
    if (failure) throw failure;
    return { id: 7 };
  },
  async removePiece(sub: string, code: string, id: number) {
    calls.push(['removePiece', sub, code, id]);
    if (failure) throw failure;
    return id === 7 ? 'pieces/x.jpg' : null;
  },
  async submit(sub: string, _ip: unknown, code: string) {
    calls.push(['submit', sub, code]);
    if (failure) throw failure;
    return submitResult;
  },
  async designations(sub: string) {
    calls.push(['designations', sub]);
    if (failure) throw failure;
    return { dossiers: [], agents: [{ id: 9, nom: 'Oumar Baldé', prefecture: 'Mali' }] };
  },
  async designate(sub: string, _ip: unknown, code: string, agentId: number) {
    calls.push(['designate', sub, code, agentId]);
    if (failure) throw failure;
  },
};
const identity = {
  existing: false,
  createAccount: vi.fn(async (citizen: NewCitizen) => {
    if (identity.existing) throw new AccountExistsError();
    expect(citizen).toBeTruthy();
    return 'kc-praticien';
  }),
  deleteAccount: vi.fn(async () => undefined),
  resetPassword: vi.fn(async () => undefined),
  signOutEverywhere: vi.fn(async () => undefined),
} satisfies CitizenIdentity & Record<string, unknown>;
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
    controllers: [FieldDossiersController],
    providers: [
      FieldDossiersService,
      { provide: FieldDossiersRepository, useValue: repository },
      { provide: CITIZEN_IDENTITY, useValue: identity },
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
  stored.length = 0;
  removed.length = 0;
  failure = null;
  identity.existing = false;
  identity.createAccount.mockClear();
  identity.deleteAccount.mockClear();
  submitResult = { status: 'submitted', code: CODE, submittedAt: '2026-11-18T10:00:00.000Z' };
  sessions.data = new Map([
    ['admin', session(['prefectoral', 'administrateur'])],
    ['sans-facteur', session(['prefectoral', 'administrateur'], false)],
    ['praticien', session(['praticien'])],
  ]);
});

const send = (
  method: string,
  path: string,
  body?: unknown,
  { cookie = 'admin', origin = APP_ORIGIN, type = 'application/json' } = {},
) =>
  fetch(`${base}/api/dossiers-terrain${path}`, {
    method,
    headers: {
      'content-type': type,
      cookie: `${SESSION_COOKIE}=${cookie}`,
      ...(origin ? { origin } : {}),
    },
    ...(body === undefined
      ? {}
      : { body: Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) }),
  });

const DOSSIER = {
  telephone: '+224 661 23 45 67',
  prenom: 'Mamadou',
  nom: 'Barry',
  specialiteId: 1,
  sousPrefectureId: null,
  languePrincipale: 'pul',
  anneesExperience: 20,
};

describe('Accès réservé à l’administrateur connecté depuis l’application de gestion', () => {
  it('refuse sans session, sans second facteur, d’une autre origine ou à un praticien', async () => {
    expect((await send('POST', '', DOSSIER, { cookie: 'aucune' })).status).toBe(401);
    expect((await send('POST', '', DOSSIER, { cookie: 'sans-facteur' })).status).toBe(403);
    expect((await send('POST', '', DOSSIER, { origin: 'https://autre.example' })).status).toBe(403);
    expect((await send('POST', '', DOSSIER, { cookie: 'praticien' })).status).toBe(403);
    expect(identity.createAccount).not.toHaveBeenCalled();
  });

  it('un autre administrateur que le préfectoral est refusé par la base', async () => {
    failure = new FieldDossierForbiddenError();
    const refused = await send('POST', '', DOSSIER);
    expect(refused.status).toBe(403);
    // Pas de compte Keycloak orphelin
    expect(identity.deleteAccount).toHaveBeenCalledWith('kc-praticien');
  });
});

describe('Critère 1 : identité, téléphone, spécialité ; préfecture de l’agent', () => {
  it('crée le compte du praticien sans mot de passe, puis le dossier dans la base', async () => {
    const created = await send('POST', '', DOSSIER);
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ code: CODE });
    expect(identity.createAccount).toHaveBeenCalledWith({
      username: '661234567',
      firstName: 'Mamadou',
      lastName: 'Barry',
      role: 'praticien',
    });
    // Aucune préfecture n'est acceptée du client : c'est celle de l'agent, lue en base
    expect(calls).toEqual([['open', SUB, 'kc-praticien', { ...DOSSIER, telephone: '661234567' }]]);
  });

  it('refuse une préfecture envoyée par le client et les champs inconnus', async () => {
    expect((await send('POST', '', { ...DOSSIER, prefectureId: 7 })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('refuse un numéro non guinéen ou un nom qui n’est pas un nom', async () => {
    for (const body of [
      { ...DOSSIER, telephone: '721234567' },
      { ...DOSSIER, nom: 'Barry2' },
      { ...DOSSIER, prenom: '' },
    ]) {
      expect((await send('POST', '', body)).status).toBe(400);
    }
    expect(identity.createAccount).not.toHaveBeenCalled();
  });

  it('numéro qui a déjà un compte : 409, rien n’est créé', async () => {
    identity.existing = true;
    const refused = await send('POST', '', DOSSIER);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe('phone_taken');
    expect(calls).toHaveLength(0);
  });

  it('numéro déjà en base : 409 et compte Keycloak retiré', async () => {
    failure = new PhoneTakenError();
    expect((await send('POST', '', DOSSIER)).status).toBe(409);
    expect(identity.deleteAccount).toHaveBeenCalledWith('kc-praticien');
  });

  it('dépose une pièce reconnue au contenu ; refuse un autre format', async () => {
    const added = await send('POST', `/${CODE}/pieces/identite`, JPEG, { type: 'image/jpeg' });
    expect(added.status).toBe(201);
    expect(calls).toEqual([['addPiece', SUB, CODE, 'identite', 'image/jpeg']]);
    expect(stored).toHaveLength(1);
    const text = await send('POST', `/${CODE}/pieces/identite`, Buffer.from('bonjour'), {
      type: 'application/octet-stream',
    });
    expect(text.status).toBe(415);
    expect(
      (await send('POST', `/${CODE}/pieces/compte_rendu`, JPEG, { type: 'image/jpeg' })).status,
    ).toBe(400);
  });

  it('pièce refusée par la base : fichier retiré du stockage', async () => {
    failure = new FieldDossierNotFoundError();
    const refused = await send('POST', `/${CODE}/pieces/photo`, JPEG, { type: 'image/jpeg' });
    expect(refused.status).toBe(404);
    expect(removed).toEqual(stored);
  });

  it('retire une pièce de son dossier ; 404 sinon', async () => {
    expect((await send('DELETE', `/${CODE}/pieces/7`)).status).toBe(204);
    expect(removed).toEqual(['pieces/x.jpg']);
    expect((await send('DELETE', `/${CODE}/pieces/8`)).status).toBe(404);
  });

  it('soumet : le dossier entre dans le circuit (étape 2)', async () => {
    const receipt = await send('POST', `/${CODE}/soumission`);
    expect(receipt.status).toBe(200);
    expect(await receipt.json()).toEqual({
      code: CODE,
      etape: 2,
      soumisLe: '2026-11-18T10:00:00.000Z',
    });
  });

  it('soumission incomplète : 422 avec la liste des pièces manquantes', async () => {
    submitResult = { status: 'missing', missing: ['photo'] };
    const refused = await send('POST', `/${CODE}/soumission`);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({
      error: 'missing_pieces',
      piecesManquantes: ['photo'],
    });
  });

  it('dossier introuvable, d’un autre agent ou déjà soumis : 404', async () => {
    failure = new FieldDossierNotFoundError();
    expect((await send('POST', `/${CODE}/soumission`)).status).toBe(404);
  });
});

// US-040d : désignation de l'agent de vérification par l'admin régional. Les règles (rôle,
// région, auteur exclu, étapes 1 et 2, visibilité, étape 2) sont prouvées sur un vrai
// PostgreSQL (packages/db/test/verificateur-designe.test.ts).
describe('US-040d : désignation de l’agent de vérification', () => {
  it('liste des dossiers et des agents de la région, dans le contexte du compte', async () => {
    const res = await send('GET', '/designations');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).agents).toHaveLength(1);
    expect(calls).toEqual([['designations', SUB]]);
  });

  it('désignation transmise à la base avec le compte connecté (204)', async () => {
    const res = await send('POST', `/${CODE}/verificateur`, { agentId: 9 });
    expect(res.status).toBe(204);
    expect(calls).toEqual([['designate', SUB, CODE, 9]]);
  });

  it('corps invalide refusé avant la base', async () => {
    for (const body of [{}, { agentId: 'neuf' }, { agentId: 9, autre: 1 }, { agentId: -1 }]) {
      expect((await send('POST', `/${CODE}/verificateur`, body)).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('refus de la base traduits : 403, 404, 409', async () => {
    const cases: [Error, number, string][] = [
      [new DesignationForbiddenError(), 403, 'not_allowed'],
      [new FieldDossierNotFoundError(), 404, 'not_found'],
      [new AgentNotDesignableError(), 409, 'not_designable'],
    ];
    for (const [error, status, code] of cases) {
      failure = error;
      const res = await send('POST', `/${CODE}/verificateur`, { agentId: 9 });
      expect(res.status).toBe(status);
      expect((await res.json()).error).toBe(code);
    }
    failure = new DesignationForbiddenError();
    expect((await send('GET', '/designations')).status).toBe(403);
  });

  it('sans second facteur, ou hors de l’application de gestion : refusé', async () => {
    expect((await send('GET', '/designations', undefined, { cookie: 'sans-facteur' })).status).toBe(
      403,
    );
    expect((await send('GET', '/designations', undefined, { cookie: 'praticien' })).status).toBe(
      403,
    );
    expect(calls).toEqual([]);
  });
});
