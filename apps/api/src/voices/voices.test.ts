// US-070 : dépôt d'une voix (accès, consentement, format, taille) et traitement de la file
// (fichiers publiés, durée, taille, empreinte ; échec réessayé). Base, stockage et FFmpeg
// simulés ; la file est prouvée sur un vrai PostgreSQL (packages/db/test/traitement-voix.test.ts)
// et la chaîne sur le vrai FFmpeg (voice-processing.test.ts).
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { PIECE_STORAGE } from '../dossiers/piece-storage';
import type { FfmpegRunner } from './voice-processing';
import { VoiceProcessor } from './voice-processor';
import { VoicesController } from './voices.controller';
import {
  VoiceDepositNotAllowedError,
  VoicesRepository,
  type PendingVoice,
} from './voices.repository';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '66666666-6666-4666-8666-666666666666';
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 7)]);

const calls: unknown[][] = [];
let depositFailure: Error | null = null;
let pending: PendingVoice[] = [];
const repository = {
  async deposit(sub: string, _ip: unknown, file: unknown, consent: boolean) {
    calls.push(['deposit', sub, file, consent]);
    if (depositFailure) throw depositFailure;
    return {
      depot: 7,
      statut: 'en_attente',
      erreur: null,
      dureeSec: null,
      tailleOctets: null,
      sha256: null,
    };
  },
  async state(sub: string, depot: number) {
    calls.push(['state', sub, depot]);
    return depot === 7
      ? {
          depot,
          statut: 'traitee',
          erreur: null,
          dureeSec: 90.4,
          tailleOctets: 271000,
          sha256: 'd'.repeat(64),
        }
      : null;
  },
  async take() {
    const taken = pending;
    pending = [];
    return taken;
  },
  async complete(id: number, result: unknown) {
    calls.push(['complete', id, result]);
  },
  async fail(id: number, reason: string) {
    calls.push(['fail', id, reason]);
    return 'en_attente';
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
// FFmpeg simulé : écrit les deux fichiers attendus et un journal avec la durée
let ffmpegFails = false;
const ffmpeg: FfmpegRunner = {
  async run(_args, workDir) {
    if (ffmpegFails)
      return { code: 1, log: 'origine.webm: Invalid data found when processing input' };
    await writeFile(join(workDir, 'voix.webm'), Buffer.from('opus'));
    await writeFile(join(workDir, 'voix.m4a'), Buffer.from('aac!!'));
    return { code: 0, log: 'size=10kB time=00:00:12.30 bitrate=8kbits/s' };
  },
};
const session = (roles: string[]): SessionData => ({
  sub: SUB,
  username: 'prefectoral.labe@sabou-sante.gn',
  name: 'Ibrahima Sow',
  roles,
  secondFactor: true,
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
let processor: VoiceProcessor;

beforeAll(async () => {
  const env = {
    ADMIN_APP_URL: `${APP_ORIGIN}/`,
    AUDIO_POLL_SECONDS: 0,
    AUDIO_MODEL_PATH: join(process.cwd(), '../../packages/audio/models/cb.rnnn'),
  } as Env;
  @Module({
    controllers: [VoicesController],
    providers: [
      { provide: VoicesRepository, useValue: repository },
      { provide: PIECE_STORAGE, useValue: storage },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: ENV, useValue: env },
      AdministratorGuard,
    ],
  })
  class TestModule {}
  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  processor = new VoiceProcessor(env, repository as unknown as VoicesRepository, storage, ffmpeg);
});

afterAll(() => app.close());

beforeEach(() => {
  calls.length = 0;
  stored.clear();
  removed.length = 0;
  depositFailure = null;
  ffmpegFails = false;
  pending = [];
  sessions.data = new Map([
    ['admin', session(['admin_prefectoral', 'administrateur'])],
    ['praticien', session(['praticien'])],
  ]);
});

const post = (query: string, body: Buffer, cookie = 'admin') =>
  fetch(`${base}/api/voix${query}`, {
    method: 'POST',
    headers: {
      'content-type': 'audio/webm',
      cookie: `${SESSION_COOKIE}=${cookie}`,
      origin: APP_ORIGIN,
    },
    body: new Uint8Array(body),
  });

describe('Dépôt d’une voix', () => {
  it('un administrateur dépose une voix ; l’original est gardé sous une clé tirée au hasard', async () => {
    const response = await post('?consentement=true', WEBM);
    expect(response.status).toBe(202);
    const [key] = [...stored.keys()];
    expect(key).toMatch(/^voix\/originaux\/[0-9a-f-]{36}\.webm$/);
    expect(calls[0]).toMatchObject([
      'deposit',
      SUB,
      { key, mime: 'audio/webm', size: WEBM.length },
      true,
    ]);
  });

  it('le consentement doit être indiqué', async () => {
    const response = await post('', WEBM);
    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/consent/);
    expect(stored.size).toBe(0);
  });

  it('refuse un fichier qui n’est pas un enregistrement, et plus de 3 Mo', async () => {
    expect((await post('?consentement=true', Buffer.from('%PDF-1.7 pas une voix'))).status).toBe(
      415,
    );
    const big = Buffer.concat([WEBM, Buffer.alloc(3 * 1024 * 1024)]);
    expect((await post('?consentement=true', big)).status).toBe(413);
    expect(stored.size).toBe(0);
  });

  it('réservé aux administrateurs avec second facteur ; refus de la base : fichier retiré', async () => {
    expect((await post('?consentement=true', WEBM, 'praticien')).status).toBe(403);
    depositFailure = new VoiceDepositNotAllowedError();
    expect((await post('?consentement=true', WEBM)).status).toBe(403);
    expect(removed).toEqual([...stored.keys()]);
  });

  it('état du dépôt : durée, taille et empreinte ; le dépôt d’un autre est introuvable', async () => {
    const response = await fetch(`${base}/api/voix/depots/7`, {
      headers: { cookie: `${SESSION_COOKIE}=admin` },
    });
    expect(await response.json()).toMatchObject({
      statut: 'traitee',
      dureeSec: 90.4,
      tailleOctets: 271000,
    });
    const other = await fetch(`${base}/api/voix/depots/8`, {
      headers: { cookie: `${SESSION_COOKIE}=admin` },
    });
    expect(other.status).toBe(404);
  });
});

describe('Critère : durée, taille et empreinte calculées automatiquement', () => {
  it('la voix traitée est publiée en Opus et AAC, avec sa durée, sa taille et son empreinte', async () => {
    stored.set('voix/originaux/a.webm', WEBM);
    pending = [{ id: 3, key: 'voix/originaux/a.webm', mime: 'audio/webm', attempts: 1 }];
    expect(await processor.processPending()).toBe(1);
    const published = [...stored.keys()].filter((key) => !key.includes('originaux'));
    expect(published).toHaveLength(2);
    const result = calls.find(([name]) => name === 'complete')![2];
    expect(result).toMatchObject({
      key: expect.stringMatching(/^voix\/[0-9a-f-]{36}\.webm$/),
      fallbackKey: expect.stringMatching(/^voix\/[0-9a-f-]{36}\.m4a$/),
      duration: 12.3,
      size: 4,
      fallbackSize: 5,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('échec de FFmpeg : le dépôt est remis en file avec la raison, sans rien publier', async () => {
    stored.set('voix/originaux/b.webm', WEBM);
    pending = [{ id: 4, key: 'voix/originaux/b.webm', mime: 'audio/webm', attempts: 1 }];
    ffmpegFails = true;
    await processor.processPending();
    expect(calls).toEqual([['fail', 4, expect.stringMatching(/^FFmpeg a échoué \(1\)/)]]);
    expect([...stored.keys()]).toEqual(['voix/originaux/b.webm']);
  });

  it('original introuvable : échec explicite', async () => {
    pending = [{ id: 5, key: 'voix/originaux/absent.webm', mime: 'audio/webm', attempts: 1 }];
    await processor.processPending();
    expect(calls).toEqual([['fail', 5, 'Fichier d’origine introuvable']]);
  });
});
