// US-064 : annotations du Comité à travers l'API (accès, contrôle des saisies, traduction des
// refus). Base simulée ; rôle, lecture réservée au Comité et à la DG, historique non modifiable
// sont prouvés sur un vrai PostgreSQL (packages/db/test/annotations-comite.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import {
  AnnotationNotAllowedError,
  AnnotationsController,
  AnnotationsRepository,
  AnnotationTargetNotFoundError,
} from './annotations.controller';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '64646464-6464-4464-8464-646464646464';
const NOTE = {
  id: 7,
  avis: 'reserve',
  contenu: 'Posologie à préciser.',
  auteur: 'Aboubacar Diakité',
  le: '2026-11-16T10:00:00Z',
};

const calls: unknown[][] = [];
let failure: Error | null = null;
const repository = {
  async list(sub: string, target: unknown) {
    calls.push(['list', sub, target]);
    if (failure) throw failure;
    return [NOTE];
  },
  async add(sub: string, _ip: unknown, input: unknown) {
    calls.push(['add', sub, input]);
    if (failure) throw failure;
    return [NOTE];
  },
};
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
    controllers: [AnnotationsController],
    providers: [
      AdministratorGuard,
      { provide: AnnotationsRepository, useValue: repository },
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
    [
      'comite',
      {
        sub: SUB,
        username: 'comite@sabou-sante.gn',
        name: 'Aboubacar Diakité',
        roles: ['scientifique', 'administrateur'],
        secondFactor: true,
        refreshToken: 'r',
        createdAt: Date.now(),
      },
    ],
  ]);
});

const get = (query: string) =>
  fetch(`${base}/api/annotations?${query}`, {
    headers: { origin: APP_ORIGIN, cookie: `${SESSION_COOKIE}=comite` },
  });
const post = (body: unknown, origin = APP_ORIGIN) =>
  fetch(`${base}/api/annotations`, {
    method: 'POST',
    headers: {
      origin,
      cookie: `${SESSION_COOKIE}=comite`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
const NEW = { type: 'recette', code: 'REC-0001', avis: 'reserve', contenu: ' Posologie. ' };

describe('Critère : annotation datée avec avis', () => {
  it('ajout : saisie nettoyée transmise, historique renvoyé', async () => {
    const response = await post(NEW);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual([NOTE]);
    expect(calls).toEqual([['add', SUB, { ...NEW, contenu: 'Posologie.' }]]);
  });

  it.each([
    ['sans avis', { avis: undefined }],
    ['avis inconnu', { avis: 'mitige' }],
    ['texte vide', { contenu: '  ' }],
    ['texte trop long', { contenu: 'x'.repeat(2001) }],
    ['objet inconnu', { type: 'maladie' }],
    ['code d’un autre objet', { type: 'plante', code: 'REC-0001' }],
  ])('%s : 400 sans appel à la base', async (_label, change) => {
    expect((await post({ ...NEW, ...change })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('hors Comité : 403 ; objet introuvable : 404 ; autre origine : 403', async () => {
    failure = new AnnotationNotAllowedError();
    expect((await post(NEW)).status).toBe(403);
    failure = new AnnotationTargetNotFoundError();
    expect((await post(NEW)).status).toBe(404);
    expect((await post(NEW, 'https://evil.example')).status).toBe(403);
  });
});

describe('Critère : historique consultable par la DG', () => {
  it('lecture de l’historique d’un traitement ou d’une plante, jamais en cache', async () => {
    const response = await get('type=plante&code=PL-005');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(calls).toEqual([['list', SUB, { type: 'plante', code: 'PL-005' }]]);
    expect((await get('type=plante&code=REC-0001')).status).toBe(400);
  });
});
