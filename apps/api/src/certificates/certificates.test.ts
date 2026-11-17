// US-045 : accès et réponses de l'approbation, client du coffre (OpenBao Transit).
// Base et coffre simulés ; les règles de la base (DG seule, étape 5, 12 mois, renouvellement)
// sont prouvées sur un vrai PostgreSQL (packages/db/test/certificat-signe.test.ts), la
// signature par le vrai coffre et le QR vert de bout en bout (apps/admin/e2e/approbation.spec.ts),
// la clé non exportable par infra/ci/coffre.sh.
import 'reflect-metadata';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import {
  DecisionNotAllowedError,
  DossierNotFoundError,
  StaleDossierError,
} from '../certification/certification.repository';
import { ENV, type Env } from '../config/env';
import { CertificatesController } from './certificates.controller';
import { CertificateNotFoundError, CertificatesRepository } from './certificates.repository';
import { SignerUnavailableError, VaultSigner } from './vault-signer';

const APP_ORIGIN = 'http://localhost:5173';
const SUB = '11111111-1111-4111-8111-111111111111';

const calls: unknown[][] = [];
let failure: Error | null = null;
const repository = {
  async listApproval(sub: string, query: unknown) {
    calls.push(['list', sub, query]);
    if (failure) throw failure;
    return { elements: [], suivant: null };
  },
  async approve(sub: string, _ip: unknown, code: string) {
    calls.push(['approve', sub, code]);
    if (failure) throw failure;
    return { code, etape: 6, certificat: 'SAB-2026-PR1041-K7Q' };
  },
  async get(sub: string, numero: string) {
    calls.push(['get', sub, numero]);
    if (failure) throw failure;
    return { numero };
  },
};

const session = (roles: string[], secondFactor = true): SessionData => ({
  sub: SUB,
  username: 'dg@sabou-sante.gn',
  name: 'Mohamed Camara',
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
    controllers: [CertificatesController],
    providers: [
      { provide: CertificatesRepository, useValue: repository },
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
    ['dg', session(['dg', 'administrateur'])],
    ['sans-facteur', session(['dg', 'administrateur'], false)],
    ['praticien', session(['praticien'])],
  ]);
});

const request = (
  method: 'GET' | 'POST',
  path: string,
  { cookie = 'dg', origin = APP_ORIGIN as string | null } = {},
) =>
  fetch(`${base}${path}`, {
    method,
    headers: { cookie: `${SESSION_COOKIE}=${cookie}`, ...(origin ? { origin } : {}) },
  });

describe.each([
  ['POST', '/api/dossiers/DS-1041/approbation'],
  ['GET', '/api/dossiers/approbation'],
  ['GET', '/api/certificats/SAB-2026-PR1041-K7Q'],
] as const)('%s %s : accès', (method, path) => {
  it('refuse un compte qui n’est pas administrateur, ou sans second facteur (R-ACC-03)', async () => {
    expect((await request(method, path, { cookie: 'praticien' })).status).toBe(403);
    expect((await request(method, path, { cookie: 'sans-facteur' })).status).toBe(403);
    expect((await request(method, path, { cookie: 'inconnue' })).status).toBe(401);
    expect(calls).toEqual([]);
  });
});

it('refuse une approbation venue d’une autre origine (écriture)', async () => {
  const response = await request('POST', '/api/dossiers/DS-1041/approbation', {
    origin: 'https://ailleurs.example',
  });
  expect(response.status).toBe(403);
  expect(calls).toEqual([]);
});

describe('approbation', () => {
  it('approuve et renvoie le numéro du certificat, sans cache', async () => {
    const response = await request('POST', '/api/dossiers/DS-1041/approbation');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      code: 'DS-1041',
      etape: 6,
      certificat: 'SAB-2026-PR1041-K7Q',
    });
    expect(calls).toEqual([['approve', SUB, 'DS-1041']]);
  });

  it('refuse un code de dossier mal formé, sans appeler la base', async () => {
    expect((await request('POST', '/api/dossiers/XX-1/approbation')).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it.each([
    [new DossierNotFoundError(), 404, 'not_found'],
    [new DecisionNotAllowedError(), 403, 'not_allowed'],
    [new StaleDossierError(), 409, 'stale'],
    [new SignerUnavailableError('Coffre injoignable'), 503, 'signer_unavailable'],
  ])('traduit le refus %o', async (error, status, code) => {
    failure = error;
    const response = await request('POST', '/api/dossiers/DS-1041/approbation');
    expect(response.status).toBe(status);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe(code);
    // La cause technique ne s'affiche jamais à l'écran
    expect(body.message).not.toMatch(/Coffre injoignable/);
  });
});

describe('certificat à imprimer', () => {
  it('refuse un numéro mal formé, sans appeler la base', async () => {
    expect((await request('GET', '/api/certificats/SAB-2026-PR1041-K7%27')).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('certificat inconnu ou hors zone : 404', async () => {
    failure = new CertificateNotFoundError();
    expect((await request('GET', '/api/certificats/SAB-2026-PR1041-K7Q')).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------
// Client du coffre, face à un faux OpenBao qui détient une clé éphémère
describe('VaultSigner (Transit)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
  const dir = mkdtempSync(join(tmpdir(), 'sabou-coffre-'));
  const tokenFile = join(dir, 'jeton-api');
  const requests: { method: string; url: string; token: unknown; body: unknown }[] = [];
  let reply: ((req: IncomingMessage, body: Record<string, unknown>) => [number, unknown]) | null;
  let server: Server;
  let signer: VaultSigner;

  const transit = (req: IncomingMessage, body: Record<string, unknown>): [number, unknown] => {
    if (req.method === 'GET' && req.url === '/v1/transit/keys/sabou-dg') {
      return [
        200,
        {
          data: {
            type: 'ed25519',
            latest_version: 1,
            keys: { '1': { public_key: raw.toString('base64') } },
          },
        },
      ];
    }
    if (req.method === 'POST' && req.url === '/v1/transit/sign/sabou-dg') {
      const signature = sign(null, Buffer.from(body.input as string, 'base64'), privateKey);
      return [
        200,
        { data: { signature: `vault:v1:${signature.toString('base64')}`, key_version: 1 } },
      ];
    }
    return [404, { errors: [] }];
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let text = '';
      req.on('data', (chunk: Buffer) => (text += chunk.toString()));
      req.on('end', () => {
        const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        requests.push({
          method: req.method!,
          url: req.url!,
          token: req.headers['x-vault-token'],
          body,
        });
        const [status, payload] = (reply ?? transit)(req, body);
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    signer = new VaultSigner({
      OPENBAO_ADDR: `http://127.0.0.1:${port}`,
      OPENBAO_TOKEN_FILE: tokenFile,
      OPENBAO_KEY: 'sabou-dg',
    } as Env);
  });

  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    requests.length = 0;
    reply = null;
    writeFileSync(tokenFile, 'jeton-1\n');
  });

  it('lit la clé publique courante, puis fait signer avec cette version-là', async () => {
    const key = await signer.currentKey();
    expect(key.version).toBe(1);
    expect(Buffer.from(key.publicKey)).toEqual(raw);
    const input = new Uint8Array([1, 2, 3]);
    const signature = await signer.sign(input, key.version);
    expect(signature).toHaveLength(64);
    expect(requests.at(-1)).toEqual({
      method: 'POST',
      url: '/v1/transit/sign/sabou-dg',
      token: 'jeton-1',
      body: { input: 'AQID', key_version: 1 },
    });
  });

  it('relit le jeton à chaque appel : un jeton renouvelé sert sans redémarrer l’API', async () => {
    await signer.currentKey();
    writeFileSync(tokenFile, 'jeton-2');
    await signer.currentKey();
    expect(requests.map((r) => r.token)).toEqual(['jeton-1', 'jeton-2']);
  });

  it.each([
    ['refus du coffre', () => [403, { errors: ['permission denied'] }]],
    [
      'signature d’une autre version',
      () => [200, { data: { signature: `vault:v2:${'A'.repeat(86)}==` } }],
    ],
    ['signature tronquée', () => [200, { data: { signature: 'vault:v1:AAAA' } }]],
    ['réponse sans signature', () => [200, { data: {} }]],
  ] as const)('%s : signature refusée', async (_, answer) => {
    reply = answer as unknown as typeof reply;
    await expect(signer.sign(new Uint8Array([1]), 1)).rejects.toBeInstanceOf(
      SignerUnavailableError,
    );
  });

  it.each([
    [
      'une clé qui n’est pas Ed25519',
      {
        type: 'rsa-2048',
        latest_version: 1,
        keys: { '1': { public_key: raw.toString('base64') } },
      },
    ],
    [
      'une clé publique tronquée',
      { type: 'ed25519', latest_version: 1, keys: { '1': { public_key: 'AAAA' } } },
    ],
  ])('refuse %s', async (_, data) => {
    reply = () => [200, { data }];
    await expect(signer.currentKey()).rejects.toBeInstanceOf(SignerUnavailableError);
  });

  it('jeton absent ou coffre injoignable : indisponible, sans appel', async () => {
    rmSync(tokenFile);
    await expect(signer.currentKey()).rejects.toThrow('Jeton du coffre illisible');
    expect(requests).toEqual([]);
    const offline = new VaultSigner({
      OPENBAO_ADDR: 'http://127.0.0.1:9',
      OPENBAO_TOKEN_FILE: join(dir, 'autre'),
      OPENBAO_KEY: 'sabou-dg',
    } as Env);
    writeFileSync(join(dir, 'autre'), 'x');
    await expect(offline.currentKey()).rejects.toThrow('Coffre injoignable');
  });

  it('refuse des données à signer vides ou trop longues, sans appel', async () => {
    await expect(signer.sign(new Uint8Array(0), 1)).rejects.toBeInstanceOf(SignerUnavailableError);
    await expect(signer.sign(new Uint8Array(4096), 1)).rejects.toBeInstanceOf(
      SignerUnavailableError,
    );
    expect(requests).toEqual([]);
  });
});
