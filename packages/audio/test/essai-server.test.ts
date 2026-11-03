// Banc d'essai sur téléphone : il accepte une voix de l'application, la traite et la sert ;
// il refuse le reste (format, taille, chemins).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clearEssai,
  MAX_UPLOAD_BYTES,
  startEssaiServer,
  type EssaiResult,
} from '../src/essai-server.ts';
import { packageDir, runFfmpeg } from '../src/ffmpeg.ts';

let work: string;
let recordings: string;
let server: Server;
let base: string;
let recording: Buffer;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'sabou-essai-test-'));
  recordings = join(work, 'voix');
  // 10 s de l'échantillon, au format de l'application sur Android 10 et plus (Opus 32 kbit/s, Ogg)
  runFfmpeg(
    [
      '-i',
      '/in/voix-bruitee.flac',
      '-t',
      '10',
      '-ac',
      '1',
      '-c:a',
      'libopus',
      '-b:a',
      '32k',
      '-y',
      '/out/enregistrement.ogg',
    ],
    [
      { host: join(packageDir, 'fixtures'), container: '/in' },
      { host: work, container: '/out', writable: true },
    ],
  );
  recording = readFileSync(join(work, 'enregistrement.ogg'));
  server = await startEssaiServer(0, recordings);
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
  clearEssai(recordings);
  rmSync(work, { recursive: true, force: true });
});

describe('Banc d’essai sur téléphone', () => {
  let result: EssaiResult;

  it('traite une voix envoyée par l’application, en deux versions', async () => {
    const response = await fetch(`${base}/voix`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/ogg' },
      body: new Uint8Array(recording),
    });
    expect(response.status).toBe(201);
    result = (await response.json()) as EssaiResult;
    expect(result.receivedBytes).toBe(recording.length);
    expect(result.receivedSeconds).toBeCloseTo(10, 0);
    expect(result.versions.map((v) => v.name)).toEqual(['mi-force', 'pleine-force']);
  });

  it('sert la version traitée par morceaux (lecture avant la fin du téléchargement)', async () => {
    const version = result.versions[0];
    const response = await fetch(`${base}${version.url}`, { headers: { Range: 'bytes=0-999' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('audio/webm');
    expect(response.headers.get('content-range')).toBe(`bytes 0-999/${version.bytes}`);
    expect((await response.arrayBuffer()).byteLength).toBe(1000);
  });

  it('refuse un format qui n’est pas de l’audio attendu', async () => {
    const response = await fetch(`${base}/voix`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/html' },
      body: '<script></script>',
    });
    expect(response.status).toBe(415);
  });

  it(`refuse un envoi de plus de ${MAX_UPLOAD_BYTES / 1024 / 1024} Mo`, async () => {
    const response = await fetch(`${base}/voix`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/ogg' },
      body: new Uint8Array(MAX_UPLOAD_BYTES + 1),
    }).catch(() => null);
    // Le serveur coupe la connexion ou répond 413 : dans les deux cas, rien n'est traité
    expect(response === null || response.status === 413).toBe(true);
  });

  it.each([
    '/voix/00000000-0000-0000-0000-000000000000/mi-force.webm',
    '/voix/..%2F..%2Fetc/mi-force.webm',
    '/voix/x/recu.ogg',
  ])('ne sert rien d’autre que les versions traitées : %s', async (path) => {
    const response = await fetch(`${base}${path}`);
    expect(response.status).toBe(404);
  });
});
