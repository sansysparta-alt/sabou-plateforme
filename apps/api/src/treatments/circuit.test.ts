// US-061 : circuit d'un traitement à travers l'API (accès, contrôle des saisies, traduction des
// refus). Base simulée ; rôles, zones, motif, historique et SMS sont prouvés sur un vrai
// PostgreSQL (packages/db/test/circuit-traitement.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { CircuitController } from './circuit.controller';
import {
  CircuitRepository,
  TreatmentCertificationBlockedError,
  TreatmentChangedError,
  TreatmentDecisionNotAllowedError,
  TreatmentNotInZoneError,
  TreatmentPractitionerRejectedError,
} from './circuit.repository';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '61616161-6161-4161-8161-616161616161';

const calls: unknown[][] = [];
let failure: Error | null = null;
const repository = {
  async queue(sub: string, query: unknown) {
    calls.push(['queue', sub, query]);
    if (failure) throw failure;
    return { elements: [], suivant: null, total: 0 };
  },
  async decide(sub: string, _ip: unknown, code: string, decision: unknown) {
    calls.push(['decide', sub, code, decision]);
    if (failure) throw failure;
    return { code, statut: 'transmise' };
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
    controllers: [CircuitController],
    providers: [
      AdministratorGuard,
      { provide: CircuitRepository, useValue: repository },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: ENV, useValue: { ADMIN_APP_URL: `${APP_ORIGIN}/` } as Env },
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
    ['admin', session(['regional', 'administrateur'])],
    ['sans-facteur', session(['regional', 'administrateur'], false)],
    ['praticien', session(['praticien'])],
  ]);
});

function call(path: string, body?: unknown, cookie: string | null = 'admin', origin = APP_ORIGIN) {
  const headers: Record<string, string> = { origin };
  if (cookie) headers['cookie'] = `${SESSION_COOKIE}=${cookie}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${base}/api/traitements/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const decide = (body: unknown, cookie?: string | null) => call('REC-0001/decision', body, cookie);

describe('Accès : administrateurs avec second facteur, depuis l’application de gestion', () => {
  it('sans session : 401 ; sans second facteur ou praticien : 403 ; décision d’une autre origine : 403', async () => {
    expect((await call('a-decider', undefined, null)).status).toBe(401);
    expect((await call('a-decider', undefined, 'sans-facteur')).status).toBe(403);
    expect((await call('a-decider', undefined, 'praticien')).status).toBe(403);
    // Décision envoyée depuis une autre page : refusée (les lectures ne changent rien)
    const forged = await call(
      'REC-0001/decision',
      { statut: 'soumise', decision: 'avance' },
      'admin',
      'https://evil.example',
    );
    expect(forged.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('file paginée et recherche transmises à la base, jamais mise en cache', async () => {
    const response = await call('a-decider?limite=10&decalage=10&q=Diallo');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(calls).toEqual([['queue', SUB, { limite: 10, decalage: 10, q: 'Diallo' }]]);
  });
});

describe('Critère : seul le rôle prévu, dans sa zone, peut faire chaque transition', () => {
  it('avance : statut vu et décision transmis', async () => {
    const response = await decide({ statut: 'soumise', decision: 'avance' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 'REC-0001', statut: 'transmise' });
    expect(calls).toEqual([['decide', SUB, 'REC-0001', { statut: 'soumise', decision: 'avance' }]]);
  });

  it.each([
    [new TreatmentNotInZoneError(), 404, 'not_found'],
    [new TreatmentDecisionNotAllowedError(), 403, 'not_allowed'],
    [new TreatmentChangedError(), 409, 'stale'],
    [new TreatmentPractitionerRejectedError(), 409, 'rejected'],
    [new TreatmentCertificationBlockedError(null), 409, 'blocked'],
  ])('refus de la base %s : %i', async (error, status, code) => {
    failure = error;
    const response = await decide({ statut: 'soumise', decision: 'avance' });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: code });
  });

  it('statut hors circuit ou code mal formé : 400', async () => {
    expect((await decide({ statut: 'brouillon', decision: 'avance' })).status).toBe(400);
    expect((await call('x/decision', { statut: 'soumise', decision: 'avance' })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('Critère : un rejet exige un motif', () => {
  it('renvoi sans motif (ou motif vide) : 400 sans appel à la base', async () => {
    for (const motif of [undefined, '   ']) {
      const response = await decide({ statut: 'soumise', decision: 'renvoi', motif });
      expect(response.status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('renvoi avec motif : motif nettoyé transmis', async () => {
    await decide({ statut: 'transmise', decision: 'renvoi', motif: '  Partie à préciser. ' });
    expect(calls[0]![3]).toEqual({
      statut: 'transmise',
      decision: 'renvoi',
      motif: 'Partie à préciser.',
    });
  });
});

describe('US-062 : certification refusée, motif expliqué', () => {
  it.each([
    ['plante_en_revue', 'une plante n’est pas encore validée par le Comité scientifique'],
    ['sections', 'une section obligatoire manque'],
    ['certificat', 'le praticien n’a pas de certificat actif'],
    ['quota', 'la formule gratuite du praticien est limitée à 3 traitements certifiés'],
  ] as const)('%s : 409 avec le motif', async (blocker, text) => {
    failure = new TreatmentCertificationBlockedError(blocker);
    const response = await decide({ statut: 'expertisee', decision: 'avance' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'blocked',
      blocker,
      message: `Certification impossible : ${text}.`,
    });
  });
});
