// US-048 : accès à l'entonnoir des 6 étapes. Base simulée ; les calculs (nombre, délai moyen,
// dossiers bloqués, zones) sont prouvés sur un vrai PostgreSQL
// (packages/db/test/entonnoir-certification.test.ts) et l'écran de bout en bout
// (apps/admin/e2e/entonnoir.spec.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { CertificationFunnel } from '@sabou/types';
import { DirectorGuard } from '../accounts/accounts.controller';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { ENV, type Env } from '../config/env';
import { ZoneContextError } from '../database/zone';
import { FunnelController } from './funnel.controller';
import { FunnelRepository } from './funnel.repository';

const SUB = '11111111-1111-4111-8111-111111111111';
const FUNNEL: CertificationFunnel = {
  delaiCibleJours: 3,
  seuilBlocageJours: 15,
  etapes: [{ etape: 2, enCours: 1, bloques: 1, passages: 4, delaiMoyenJours: 5.5 }],
  bloques: {
    total: 1,
    dossiers: [
      {
        dossier: 'DS-1041',
        praticien: 'PR-1041',
        nom: 'Saran Kourouma',
        etape: 2,
        prefecture: 'Labé',
        region: 'Labé',
        depuis: '2026-10-20T08:00:00Z',
        jours: 25,
      },
    ],
  },
};

const calls: string[] = [];
let failure: Error | null = null;
const repository = {
  async funnel(sub: string) {
    calls.push(sub);
    if (failure) throw failure;
    return FUNNEL;
  },
};

const session = (roles: string[], secondFactor = true): SessionData => ({
  sub: SUB,
  username: 'dg@sabou-sante.gn',
  name: 'Direction Générale',
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
    controllers: [FunnelController],
    providers: [
      { provide: FunnelRepository, useValue: repository },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: ENV, useValue: { ADMIN_APP_URL: 'http://localhost:5173/' } as Env },
      DirectorGuard,
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
    ['dg', session(['dg', 'administrateur'])],
    ['dg-sans-facteur', session(['dg', 'administrateur'], false)],
    ['regional', session(['regional', 'administrateur'])],
    ['comite', session(['scientifique', 'administrateur'])],
  ]);
});

const get = (cookie?: string) =>
  fetch(`${base}/api/entonnoir`, {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });

describe('GET /api/entonnoir', () => {
  it('refuse une requête sans session', async () => {
    expect((await get()).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it.each(['regional', 'comite', 'dg-sans-facteur'])('refuse le compte « %s »', async (who) => {
    expect((await get(who)).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('renvoie l’entonnoir à la DG, sans cache', async () => {
    const response = await get('dg');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(FUNNEL);
    expect(calls).toEqual([SUB]);
  });

  it('refuse un compte suspendu ou inconnu de la base, sans dire lequel', async () => {
    failure = new ZoneContextError();
    expect((await get('dg')).status).toBe(403);
  });
});
