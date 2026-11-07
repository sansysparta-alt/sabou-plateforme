// US-040a : critères de US-040 et protections, à travers l'API. Base, stockage et SMS
// simulés ; les règles de la base (pièces obligatoires, 12 mois, champs fermés au praticien)
// sont prouvées sur un vrai PostgreSQL (packages/db/test/dossier-praticien.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PractitionerPieceType, PractitionerProfile } from '@sabou/types';
import { CITIZEN_SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { ENV } from '../config/env';
import { ZoneContextError } from '../database/zone';
import { SMS_SENDER } from '../signup/sms';
import { DossiersController, PractitionerGuard } from './dossiers.controller';
import {
  DossierLockedError,
  DossiersRepository,
  RejectionDelayError,
  type NewPiece,
  type SubmitResult,
} from './dossiers.repository';
import { DossiersService } from './dossiers.service';
import { PIECE_STORAGE } from './piece-storage';

const SITE = 'http://localhost:3000';
const SUB = '40404040-4040-4040-8040-404040404040';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n');

// Base simulée : un praticien et son dossier à l'étape 1
const db = {
  profile: null as PractitionerProfile | null,
  pieces: new Map<number, NewPiece>(),
  submitted: false,
  failure: null as Error | null,
  calls: [] as string[],
};
const missing = (): PractitionerPieceType[] =>
  (['identite', 'photo'] as const).filter(
    (type) => ![...db.pieces.values()].some((piece) => piece.type === type),
  );
const repository = {
  async view(sub: string) {
    db.calls.push(`view:${sub}`);
    return db.profile
      ? { praticien: { code: 'PR-2001', statut: 'en_attente', ...db.profile }, dossier: null }
      : null;
  },
  async saveProfile(sub: string, profile: PractitionerProfile) {
    db.calls.push(`saveProfile:${sub}`);
    if (db.failure) throw db.failure;
    db.profile = profile;
  },
  async addPiece(sub: string, piece: NewPiece) {
    db.calls.push(`addPiece:${sub}`);
    if (db.failure) throw db.failure;
    const id = db.pieces.size + 1;
    db.pieces.set(id, piece);
    return { id, dossierCode: 'DS-2001' };
  },
  async removePiece(sub: string, id: number) {
    db.calls.push(`removePiece:${sub}`);
    const piece = db.pieces.get(id);
    db.pieces.delete(id);
    return piece?.key ?? null;
  },
  async submit(sub: string): Promise<SubmitResult> {
    db.calls.push(`submit:${sub}`);
    if (db.failure) throw db.failure;
    const absent = missing();
    if (absent.length > 0) return { status: 'missing', missing: absent };
    db.submitted = true;
    return {
      status: 'submitted',
      code: 'DS-2001',
      submittedAt: '2026-11-07T10:00:00.000Z',
      phone: '+224661234567',
    };
  },
};
const storage = {
  objects: new Map<string, { body: Buffer; contentType: string }>(),
  async put(key: string, body: Buffer, contentType: string) {
    storage.objects.set(key, { body, contentType });
  },
  async remove(key: string) {
    storage.objects.delete(key);
  },
};
const sms = {
  sent: [] as { to: string; text: string }[],
  async send(to: string, text: string) {
    sms.sent.push({ to, text });
  },
};
const session = (roles: string[]): SessionData => ({
  sub: SUB,
  username: '661234567',
  name: 'Mariama',
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

let app: INestApplication;
let base: string;

beforeAll(async () => {
  @Module({
    controllers: [DossiersController],
    providers: [
      DossiersService,
      PractitionerGuard,
      { provide: DossiersRepository, useValue: repository },
      { provide: PIECE_STORAGE, useValue: storage },
      { provide: SMS_SENDER, useValue: sms },
      { provide: SESSION_STORE, useValue: sessions },
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
  db.profile = null;
  db.pieces.clear();
  db.submitted = false;
  db.failure = null;
  db.calls = [];
  storage.objects.clear();
  sms.sent = [];
  sessions.data = new Map([
    ['praticien', session(['praticien'])],
    ['citoyen', session(['citoyen'])],
  ]);
});

const PROFILE = {
  specialiteId: 1,
  prefectureId: 4,
  languePrincipale: 'pul',
  anneesExperience: 10,
};

function call(
  method: string,
  path: string,
  options: { cookie?: string | null; origin?: string | null; body?: BodyInit; type?: string } = {},
) {
  const { cookie = 'praticien', origin = SITE, body, type } = options;
  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = `${CITIZEN_SESSION_COOKIE}=${cookie}`;
  if (origin) headers['origin'] = origin;
  if (type) headers['content-type'] = type;
  return fetch(`${base}/api/praticien/${path}`, { method, headers, body });
}
const upload = (type: string, body: Buffer, contentType = 'image/jpeg') =>
  call('POST', `dossier/pieces/${type}`, { body: new Uint8Array(body), type: contentType });
const saveProfile = (profile: unknown = PROFILE) =>
  call('PUT', 'fiche', { body: JSON.stringify(profile), type: 'application/json' });

describe('Critère 1 : un dossier complet soumis passe à l’étape 2, avec un accusé de réception', () => {
  it('enregistre la fiche, les pièces, puis soumet : étape 2, accusé à l’écran et par SMS', async () => {
    expect((await saveProfile()).status).toBe(204);
    expect((await upload('identite', PDF, 'application/pdf')).status).toBe(201);
    expect((await upload('photo', JPEG)).status).toBe(201);

    const response = await call('POST', 'dossier/soumission');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 'DS-2001',
      etape: 2,
      soumisLe: '2026-11-07T10:00:00.000Z',
    });
    expect(sms.sent).toEqual([
      {
        to: '+224661234567',
        text: expect.stringMatching(/^SABOU : votre dossier DS-2001 est bien reçu\./),
      },
    ]);
  });

  it('range chaque pièce sous une clé tirée au hasard, avec son format réel et son empreinte', async () => {
    await upload('photo', JPEG, 'application/octet-stream');
    const [piece] = [...db.pieces.values()];
    expect(piece).toMatchObject({ type: 'photo', mime: 'image/jpeg', size: JPEG.length });
    expect(piece!.key).toMatch(/^pieces\/[0-9a-f-]{36}\.jpg$/);
    expect(piece!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(storage.objects.get(piece!.key)).toEqual({ body: JPEG, contentType: 'image/jpeg' });
  });

  it('n’envoie pas de SMS si la soumission échoue', async () => {
    db.failure = new DossierLockedError();
    expect((await call('POST', 'dossier/soumission')).status).toBe(409);
    expect(sms.sent).toEqual([]);
  });
});

describe('Critère 2 : une pièce obligatoire manquante bloque la soumission', () => {
  it('refuse en 422 avec la liste des pièces manquantes, sans SMS', async () => {
    await upload('identite', PDF, 'application/pdf');
    const response = await call('POST', 'dossier/soumission');
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'missing_pieces',
      message: 'Pièces obligatoires manquantes : photo du praticien.',
      piecesManquantes: ['photo'],
    });
    expect(db.submitted).toBe(false);
    expect(sms.sent).toEqual([]);
  });

  it('liste toutes les pièces manquantes, dans l’ordre', async () => {
    const response = await call('POST', 'dossier/soumission');
    expect(await response.json()).toMatchObject({ piecesManquantes: ['identite', 'photo'] });
  });
});

describe('Critère 3 : moins de 12 mois après un rejet définitif, le dossier est refusé', () => {
  it('refuse en 409 l’ouverture du dossier, avec la raison', async () => {
    db.failure = new RejectionDelayError();
    const response = await saveProfile();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'rejection_delay',
      message: expect.stringContaining('12 mois après un rejet définitif'),
    });
  });
});

describe('Pièces : formats et tailles', () => {
  it('refuse un fichier dont le contenu n’est ni JPEG, ni PNG, ni PDF, quel que soit l’en-tête', async () => {
    const response = await upload('photo', Buffer.from('<svg onload="alert(1)"/>'), 'image/jpeg');
    expect(response.status).toBe(415);
    expect(storage.objects.size).toBe(0);
    expect(db.calls).toEqual([]);
  });

  it('refuse un envoi de plus de 5 Mo sans le garder', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    const response = await upload('photo', big);
    expect(response.status).toBe(413);
    expect(storage.objects.size).toBe(0);
  });

  it('refuse un type de pièce inconnu, et le compte rendu de visite (réservé au préfectoral)', async () => {
    expect((await upload('diplome', JPEG)).status).toBe(400);
    expect((await upload('compte_rendu_visite', PDF, 'application/pdf')).status).toBe(400);
    expect(storage.objects.size).toBe(0);
  });

  it('refuse un formulaire JSON ou multipart à la place du fichier', async () => {
    const response = await call('POST', 'dossier/pieces/photo', {
      body: '{}',
      type: 'application/json',
    });
    expect(response.status).toBe(415);
  });

  it('retire le fichier déposé si la base refuse la pièce (dossier en cours d’examen)', async () => {
    db.failure = new DossierLockedError();
    const response = await upload('photo', JPEG);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'locked' });
    expect(storage.objects.size).toBe(0);
  });

  it('retire une pièce et son fichier ; 404 pour une pièce qui n’est pas la sienne', async () => {
    await upload('photo', JPEG);
    expect((await call('DELETE', 'dossier/pieces/1')).status).toBe(204);
    expect(storage.objects.size).toBe(0);
    expect((await call('DELETE', 'dossier/pieces/99')).status).toBe(404);
  });
});

describe('Fiche', () => {
  it('refuse une fiche incomplète ou des champs inconnus', async () => {
    expect((await saveProfile({ ...PROFILE, anneesExperience: 81 })).status).toBe(400);
    expect((await saveProfile({ ...PROFILE, statut: 'certifie' })).status).toBe(400);
    expect((await saveProfile({ specialiteId: 1 })).status).toBe(400);
    expect(db.calls).toEqual([]);
  });

  it('renvoie 404 tant que la fiche n’existe pas, puis la fiche', async () => {
    expect((await call('GET', 'dossier')).status).toBe(404);
    await saveProfile();
    const response = await call('GET', 'dossier');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      praticien: { code: 'PR-2001', prefectureId: 4 },
    });
  });
});

describe('Accès', () => {
  it('refuse une requête sans session', async () => {
    expect((await call('GET', 'dossier', { cookie: null })).status).toBe(401);
    expect(db.calls).toEqual([]);
  });

  it('refuse un compte qui n’est pas praticien (citoyen)', async () => {
    expect((await call('GET', 'dossier', { cookie: 'citoyen' })).status).toBe(403);
    expect((await call('POST', 'dossier/soumission', { cookie: 'citoyen' })).status).toBe(403);
    expect(db.calls).toEqual([]);
  });

  it('refuse une écriture venue d’une autre origine, ou sans origine', async () => {
    for (const origin of ['https://exemple.com', null]) {
      expect((await call('POST', 'dossier/soumission', { origin })).status).toBe(403);
    }
    expect((await call('PUT', 'fiche', { origin: 'https://exemple.com' })).status).toBe(403);
    expect(db.calls.filter((c) => c.startsWith('submit'))).toEqual([]);
  });

  it('refuse un compte suspendu entre-temps, sans dire pourquoi', async () => {
    db.failure = new ZoneContextError();
    expect((await call('POST', 'dossier/soumission')).status).toBe(403);
  });

  it('agit toujours sur le compte de la session, jamais sur un identifiant envoyé', async () => {
    await saveProfile();
    await call('POST', 'dossier/soumission');
    expect(new Set(db.calls.map((c) => c.split(':')[1]))).toEqual(new Set([SUB]));
  });
});
