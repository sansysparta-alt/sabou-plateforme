// US-091 : routes des rapports mensuels et des exports. Base simulée ; les règles (mois écoulé,
// figé à l'envoi, destinataire, renvoi motivé, zone, historique en ajout seul) sont prouvées
// sur un vrai PostgreSQL (packages/db/test/rapports.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PrefectoralIndicators } from '@sabou/types';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { ExportsController, fileName, MonthlyReportsController } from './reports.controller';
import {
  ReportNotAllowedError,
  ReportNotFoundError,
  ReportRefusedError,
  ReportsRepository,
  type ExportFile,
} from './reports.repository';

const SUB = '33333333-3333-4333-8333-333333333333';
const APP = 'http://localhost:5173';

const INDICATORS: PrefectoralIndicators = {
  profil: 'prefectoral',
  enregistres: 2,
  certifies: 1,
  enAttente: 1,
  recettesNumerisees: 0,
  parSpecialite: [],
  aValider: { total: 0, dossiers: [] },
};
const BOARD_FILE: ExportFile = {
  type: 'tableau_de_bord',
  format: 'pdf',
  contenu: { zone: 'Labé', indicateurs: INDICATORS },
  auteur: 'Ibrahima Sow',
  le: '2026-11-20T10:00:00Z',
};

const calls: unknown[][] = [];
let failure: Error | null = null;
let file: ExportFile = BOARD_FILE;
const record =
  <T>(name: string, value: T) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args.filter((a) => a !== '127.0.0.1' && a !== '::ffff:127.0.0.1')]);
    if (failure) throw failure;
    return value;
  };
const repository = {
  list: record('list', { miens: [], recus: [], peutRediger: true, moisPossibles: ['2026-10-01'] }),
  detail: record('detail', { id: 7 }),
  prepare: record('prepare', { id: 7 }),
  comment: record('comment', undefined),
  send: record('send', undefined),
  giveBack: record('giveBack', undefined),
  history: record('history', []),
  create: record('create', { id: 12 }),
  file: async (...args: unknown[]) => {
    calls.push(['file', ...args]);
    if (failure) throw failure;
    return file;
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
    controllers: [MonthlyReportsController, ExportsController],
    providers: [
      { provide: ReportsRepository, useValue: repository },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: ENV, useValue: { ADMIN_APP_URL: `${APP}/` } as Env },
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
  file = BOARD_FILE;
  sessions.data = new Map([
    ['admin', session(['admin_prefectoral', 'administrateur'])],
    ['sans-facteur', session(['admin_prefectoral', 'administrateur'], false)],
    ['praticien', session(['praticien'])],
  ]);
});

const request = (method: string, path: string, body?: unknown, cookie = 'admin') =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      cookie: `${SESSION_COOKIE}=${cookie}`,
      origin: APP,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('accès', () => {
  it('sans session, sans second facteur, ou praticien : refus avant la base', async () => {
    expect((await fetch(`${base}/api/rapports-mensuels`)).status).toBe(401);
    expect((await request('GET', '/api/rapports-mensuels', undefined, 'sans-facteur')).status).toBe(
      403,
    );
    expect((await request('GET', '/api/exports', undefined, 'praticien')).status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe('rapports mensuels', () => {
  it('prépare le mois demandé (premier jour) ; tout autre format est refusé', async () => {
    const ok = await request('POST', '/api/rapports-mensuels', { mois: '2026-10-01' });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ id: 7 });
    expect(calls).toEqual([['prepare', SUB, '2026-10-01']]);
    for (const mois of ['2026-10-15', '2026-13-01', 'octobre'])
      expect((await request('POST', '/api/rapports-mensuels', { mois })).status).toBe(400);
  });

  it('commentaire, envoi avec l’heure du calcul, renvoi avec motif', async () => {
    expect(
      (
        await request('PATCH', '/api/rapports-mensuels/7/commentaire', {
          commentaire: ' Mois calme. ',
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await request('POST', '/api/rapports-mensuels/7/envoi', {
          calculeLe: '2026-11-01T08:00:00Z',
        })
      ).status,
    ).toBe(204);
    expect(
      (await request('POST', '/api/rapports-mensuels/7/renvoi', { motif: 'Délais à expliquer.' }))
        .status,
    ).toBe(204);
    expect(calls).toEqual([
      ['comment', SUB, 7, 'Mois calme.'],
      ['send', SUB, 7, '2026-11-01T08:00:00Z'],
      ['giveBack', SUB, 7, 'Délais à expliquer.'],
    ]);
  });

  it('renvoi sans motif, envoi sans heure : 400', async () => {
    expect((await request('POST', '/api/rapports-mensuels/7/renvoi', { motif: ' ' })).status).toBe(
      400,
    );
    expect((await request('POST', '/api/rapports-mensuels/7/envoi', {})).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('refus de la base traduits : introuvable 404, réservé 403, figé 409', async () => {
    failure = new ReportNotFoundError();
    expect((await request('GET', '/api/rapports-mensuels/7')).status).toBe(404);
    failure = new ReportNotAllowedError();
    expect((await request('POST', '/api/rapports-mensuels/7/renvoi', { motif: 'x' })).status).toBe(
      403,
    );
    failure = new ReportRefusedError(
      'sent',
      'Ce rapport est envoyé : il ne peut plus être modifié.',
    );
    const response = await request('PATCH', '/api/rapports-mensuels/7/commentaire', {
      commentaire: 'x',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'sent' });
  });
});

describe('exports', () => {
  it('demande validée : type, format, rapport seulement pour un rapport mensuel', async () => {
    expect(
      (await request('POST', '/api/exports', { type: 'tableau_de_bord', format: 'xlsx' })).status,
    ).toBe(201);
    expect(
      (
        await request('POST', '/api/exports', {
          type: 'rapport_mensuel',
          format: 'pdf',
          rapport: 7,
        })
      ).status,
    ).toBe(201);
    for (const body of [
      { type: 'tableau_de_bord', format: 'csv' },
      { type: 'rapport_mensuel', format: 'pdf' },
      { type: 'tableau_de_bord', format: 'pdf', rapport: 7 },
    ])
      expect((await request('POST', '/api/exports', body)).status).toBe(400);
    expect(calls).toEqual([
      ['create', SUB, { type: 'tableau_de_bord', format: 'xlsx' }],
      ['create', SUB, { type: 'rapport_mensuel', format: 'pdf', rapport: 7 }],
    ]);
  });

  it('téléchargement : PDF régénéré, pièce jointe, sans cache ni interprétation', async () => {
    const response = await request('GET', '/api/exports/12/fichier');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="sabou-tableau-de-bord-labe-12.pdf"',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.subarray(0, 8).toString('latin1')).toBe('%PDF-1.7');
  });

  it('XLSX : type de fichier du tableur', async () => {
    file = { ...BOARD_FILE, format: 'xlsx' };
    const response = await request('GET', '/api/exports/12/fichier');
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    // Archive ZIP (format OOXML)
    expect(
      Buffer.from(await response.arrayBuffer())
        .subarray(0, 2)
        .toString('latin1'),
    ).toBe('PK');
  });

  it('export hors zone : 404', async () => {
    failure = new ReportNotFoundError();
    expect((await request('GET', '/api/exports/12/fichier')).status).toBe(404);
  });

  it('nom de fichier sûr : sans accent, sans guillemet ni chemin', () => {
    const tricky: ExportFile = {
      ...BOARD_FILE,
      contenu: { zone: 'Mamou "../Dalaba"', indicateurs: INDICATORS },
    };
    expect(fileName(tricky, 3)).toBe('sabou-tableau-de-bord-mamou-dalaba-3.pdf');
    expect(
      fileName(
        {
          ...BOARD_FILE,
          type: 'rapport_mensuel',
          format: 'xlsx',
          contenu: { zone: 'Labé', mois: '2026-10-01' } as never,
        },
        4,
      ),
    ).toBe('sabou-rapport-2026-10-labe-4.xlsx');
  });
});
