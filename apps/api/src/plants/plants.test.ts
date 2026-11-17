// US-050 : accès aux fiches plantes, contrôle des saisies et des photos, traduction des refus
// de la base. Base et stockage simulés ; les règles (rôle, unicité du nom scientifique, photo
// principale, journal) sont prouvées sur un vrai PostgreSQL (packages/db/test/fiche-plante.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PlantDetail } from '@sabou/types';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { ENV, type Env } from '../config/env';
import { PIECE_STORAGE } from '../dossiers/piece-storage';
import { inspectImage, PlantEditorGuard, PlantsController } from './plants.controller';
import {
  PlantAlreadyValidatedError,
  PlantNameTakenError,
  PlantNotAllowedError,
  PlantPrincipalImageError,
  PlantsRepository,
  PlantStaleError,
  PlantValidationNotAllowedError,
  type StoredImage,
} from './plants.repository';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '44444444-4444-4444-8444-444444444444';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(20, 1)]);

const PLANT: PlantDetail = {
  code: 'PL-006',
  nomScientifique: 'Combretum micranthum',
  famille: 'Combretaceae',
  nomFr: 'Kinkéliba',
  nomEn: null,
  statut: 'en_revue',
  modifieLe: '2026-11-15T10:00:00.000000Z',
  validation: null,
  images: [],
};

const calls: unknown[][] = [];
let failure: Error | null = null;
const fail = () => {
  if (failure) throw failure;
};
const repository = {
  async list(sub: string, q?: string) {
    calls.push(['list', sub, q]);
    return [];
  },
  async detail(sub: string, code: string) {
    calls.push(['detail', sub, code]);
    fail();
    return PLANT;
  },
  async create(sub: string, _ip: unknown, fields: unknown) {
    calls.push(['create', sub, fields]);
    fail();
    return PLANT;
  },
  async update(sub: string, _ip: unknown, code: string, input: unknown) {
    calls.push(['update', sub, code, input]);
    fail();
    return PLANT;
  },
  async validate(sub: string, _ip: unknown, code: string, vueLe: string) {
    calls.push(['validate', sub, code, vueLe]);
    fail();
    return PLANT;
  },
  async addImage(sub: string, _ip: unknown, code: string, file: StoredImage, fields: unknown) {
    calls.push(['addImage', sub, code, file, fields]);
    fail();
    return PLANT;
  },
  async updateImage(sub: string, _ip: unknown, code: string, image: number, fields: unknown) {
    calls.push(['updateImage', sub, code, image, fields]);
    fail();
    return PLANT;
  },
  async removeImage(sub: string, _ip: unknown, code: string, image: number) {
    calls.push(['removeImage', sub, code, image]);
    fail();
    return { plant: PLANT, key: 'plantes/retiree.jpg' };
  },
  async imageFile(sub: string, code: string, image: number) {
    calls.push(['imageFile', sub, code, image]);
    fail();
    return { key: 'plantes/a.jpg', mime: 'image/jpeg' };
  },
};

const stored = new Map<string, Buffer>();
const removed: string[] = [];
const storage = {
  async put(key: string, body: Buffer) {
    stored.set(key, body);
  },
  async get(key: string) {
    return stored.get(key) ?? null;
  },
  async remove(key: string) {
    removed.push(key);
  },
};

const session = (roles: string[], secondFactor = true): SessionData => ({
  sub: SUB,
  username: 'comite@sabou-sante.gn',
  name: 'Aboubacar Diakité',
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
    controllers: [PlantsController],
    providers: [
      { provide: PlantsRepository, useValue: repository },
      { provide: PIECE_STORAGE, useValue: storage },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: ENV, useValue: { ADMIN_APP_URL: `${APP_ORIGIN}/` } as Env },
      PlantEditorGuard,
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
  removed.length = 0;
  failure = null;
  sessions.data = new Map([
    ['comite', session(['comite', 'administrateur'])],
    ['dg', session(['dg', 'administrateur'])],
    ['dg-sans-facteur', session(['dg', 'administrateur'], false)],
    ['regional', session(['admin_regional', 'administrateur'])],
  ]);
});

const request = (
  method: string,
  path: string,
  body?: unknown,
  { cookie = 'comite', origin = APP_ORIGIN, type = 'application/json' } = {},
) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': type }),
      cookie: `${SESSION_COOKIE}=${cookie}`,
      ...(origin ? { origin } : {}),
    },
    body:
      body === undefined
        ? undefined
        : Buffer.isBuffer(body)
          ? new Uint8Array(body)
          : JSON.stringify(body),
  });

const fields = {
  nomScientifique: 'Combretum micranthum',
  famille: 'Combretaceae',
  nomFr: 'Kinkéliba',
};
const imageQuery = '?alt=Feuilles%20s%C3%A9ch%C3%A9es&type=feuille&principale=true';

describe('Accès : DG et Comité scientifique avec second facteur', () => {
  it('refuse sans session, un autre profil, la DG sans second facteur', async () => {
    expect((await request('GET', '/api/plantes', undefined, { cookie: 'aucune' })).status).toBe(
      401,
    );
    expect((await request('GET', '/api/plantes', undefined, { cookie: 'regional' })).status).toBe(
      403,
    );
    expect(
      (await request('GET', '/api/plantes', undefined, { cookie: 'dg-sans-facteur' })).status,
    ).toBe(403);
    expect(calls).toEqual([]);
  });

  it('le Comité et la DG lisent la liste, sans cache', async () => {
    const response = await request('GET', '/api/plantes?q=kinke');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await request('GET', '/api/plantes', undefined, { cookie: 'dg' })).status).toBe(200);
    expect(calls).toEqual([
      ['list', SUB, 'kinke'],
      ['list', SUB, undefined],
    ]);
  });

  it('une modification venue d’une autre origine est refusée', async () => {
    const response = await request('POST', '/api/plantes', fields, {
      origin: 'https://evil.example',
    });
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('refus de rôle par la base : message en français', async () => {
    failure = new PlantNotAllowedError();
    const response = await request('POST', '/api/plantes', fields);
    expect(response.status).toBe(403);
    expect((await response.json()).message).toMatch(/réservées à la DG et au Comité/);
  });
});

describe('Critère : nom scientifique unique, famille, nom français obligatoire, nom anglais', () => {
  it('crée une fiche ; le nom anglais absent devient null', async () => {
    const response = await request('POST', '/api/plantes', fields);
    expect(response.status).toBe(201);
    expect(calls).toEqual([['create', SUB, { ...fields, nomEn: null }]]);
  });

  it('refuse une fiche sans nom français, avec le message de la saisie', async () => {
    const response = await request('POST', '/api/plantes', { ...fields, nomFr: ' ' });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('Nom français : champ obligatoire.');
    expect(calls).toEqual([]);
  });

  it('nom scientifique déjà pris : 409, avec la fiche qui le porte', async () => {
    failure = new PlantNameTakenError('PL-001');
    const response = await request('POST', '/api/plantes', fields);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'name_taken',
      message: 'Ce nom scientifique est déjà celui de la fiche PL-001.',
    });
  });

  it('modification d’une fiche changée entre-temps : 409', async () => {
    failure = new PlantStaleError();
    const response = await request('PATCH', '/api/plantes/PL-005', {
      ...fields,
      vueLe: '2026-11-15T10:00:00.000000Z',
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('stale');
  });

  it('code de fiche invalide : refusé avant la base', async () => {
    expect((await request('GET', "/api/plantes/PL-1'")).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('Critère : une seule photo principale, texte alternatif obligatoire', () => {
  it('reconnaît JPEG, PNG et WebP à leur contenu, et rien d’autre', () => {
    expect(inspectImage(JPEG)?.mime).toBe('image/jpeg');
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(8),
    ]);
    expect(inspectImage(png)?.mime).toBe('image/png');
    const webp = Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'), Buffer.alloc(8)]);
    expect(inspectImage(webp)?.mime).toBe('image/webp');
    expect(inspectImage(PDF)).toBeNull();
  });

  it('enregistre la photo sous une clé tirée au hasard, avec sa description', async () => {
    const response = await request('POST', `/api/plantes/PL-001/images${imageQuery}`, JPEG, {
      type: 'image/jpeg',
    });
    expect(response.status).toBe(200);
    const [key] = [...stored.keys()];
    expect(key).toMatch(/^plantes\/[0-9a-f-]{36}\.jpg$/);
    expect(calls).toEqual([
      [
        'addImage',
        SUB,
        'PL-001',
        { key, sha256: inspectImage(JPEG)!.sha256, mime: 'image/jpeg', size: JPEG.length },
        { alt: 'Feuilles séchées', altEn: null, type: 'feuille', principale: true },
      ],
    ]);
  });

  it('refuse une photo sans texte alternatif, avant tout stockage', async () => {
    const response = await request('POST', '/api/plantes/PL-001/images?type=feuille', JPEG, {
      type: 'image/jpeg',
    });
    expect(response.status).toBe(400);
    expect(stored.size).toBe(0);
  });

  it('refuse un fichier qui n’est pas une photo, même annoncé comme tel', async () => {
    const response = await request('POST', `/api/plantes/PL-001/images${imageQuery}`, PDF, {
      type: 'image/jpeg',
    });
    expect(response.status).toBe(415);
    expect(stored.size).toBe(0);
  });

  it('refuse une photo de plus de 5 Mo', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    const response = await request('POST', `/api/plantes/PL-001/images${imageQuery}`, big, {
      type: 'image/jpeg',
    });
    expect(response.status).toBe(413);
    expect(stored.size).toBe(0);
  });

  it('refus de la base : le fichier déposé est retiré du stockage', async () => {
    failure = new PlantNotAllowedError();
    const response = await request('POST', `/api/plantes/PL-001/images${imageQuery}`, JPEG, {
      type: 'image/jpeg',
    });
    expect(response.status).toBe(403);
    expect(removed).toEqual([...stored.keys()]);
  });

  it('retirer la marque de principale sans la donner : 409 expliqué', async () => {
    failure = new PlantPrincipalImageError();
    const response = await request('PATCH', '/api/plantes/PL-001/images/3', {
      alt: 'Écorce',
      type: 'ecorce',
      principale: false,
    });
    expect(response.status).toBe(409);
    expect((await response.json()).message).toMatch(/marquez une autre photo comme principale/);
  });

  it('retirer une photo retire aussi son fichier', async () => {
    const response = await request('DELETE', '/api/plantes/PL-001/images/3');
    expect(response.status).toBe(200);
    expect(removed).toEqual(['plantes/retiree.jpg']);
  });

  it('sert la photo par l’API, sans exécution possible', async () => {
    stored.set('plantes/a.jpg', JPEG);
    const response = await request('GET', '/api/plantes/PL-001/images/3');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(response.headers.get('cache-control')).toBe('private, max-age=86400, immutable');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(JPEG);
  });
});

describe('US-051 : validation par le Comité', () => {
  const vueLe = '2026-11-15T10:00:00.000000Z';

  it('transmet la date de lecture ; le refus de la DG par la base est expliqué', async () => {
    expect((await request('POST', '/api/plantes/PL-005/validation', { vueLe })).status).toBe(200);
    expect(calls).toEqual([['validate', SUB, 'PL-005', vueLe]]);
    failure = new PlantValidationNotAllowedError();
    const refused = await request(
      'POST',
      '/api/plantes/PL-005/validation',
      { vueLe },
      { cookie: 'dg' },
    );
    expect(refused.status).toBe(403);
    expect((await refused.json()).message).toBe(
      'Seul le Comité scientifique valide une fiche plante.',
    );
  });

  it('fiche déjà validée : 409 ; date de lecture absente : 400', async () => {
    failure = new PlantAlreadyValidatedError();
    expect((await request('POST', '/api/plantes/PL-001/validation', { vueLe })).status).toBe(409);
    failure = null;
    expect((await request('POST', '/api/plantes/PL-001/validation', {})).status).toBe(400);
  });
});
