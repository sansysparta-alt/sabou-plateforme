// US-070 : traitement d'une voix sur le vrai FFmpeg de la production (même image épinglée,
// lancée par Docker sur le poste et dans le pipeline), avec l'échantillon bruité de 90 s du
// prototype US-005 (packages/audio/fixtures).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FFMPEG_IMAGE,
  inspectVoice,
  parseDuration,
  processVoice,
  VoiceProcessingError,
  type FfmpegRunner,
} from './voice-processing';

// Les tests de l'API tournent depuis apps/api
const repo = resolve(process.cwd(), '../..') + '/';
const MODEL = `${repo}packages/audio/models/cb.rnnn`;
const NOISY = readFileSync(`${repo}packages/audio/fixtures/voix-bruitee.flac`);

// FFmpeg de l'image de production, sans réseau, dossier de travail monté
const docker: FfmpegRunner = {
  run(args, workDir) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'docker',
        [
          'run',
          '--rm',
          '--network',
          'none',
          '--volume',
          `${workDir}:/work`,
          '--workdir',
          '/work',
          '--entrypoint',
          '/ffmpeg',
          FFMPEG_IMAGE,
          ...args,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
      );
      let log = '';
      child.stderr.on('data', (chunk: Buffer) => (log += chunk.toString('utf8')));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? 1, log }));
    });
  },
};

describe('Critère : réduction du bruit, normalisation, Opus 24 kbit/s + secours AAC', () => {
  it(
    '90 s bruitées donnent un WebM Opus léger et un MP4 AAC lisible dès le début',
    { timeout: 120_000 },
    async () => {
      const voice = await processVoice(docker, NOISY, 'flac', MODEL);
      // WebM (EBML), Opus, sous 300 Ko pour 90 s (§2.17)
      expect(voice.opus.readUInt32BE(0)).toBe(0x1a45dfa3);
      expect(voice.opus.includes(Buffer.from('A_OPUS'))).toBe(true);
      expect(voice.opus.length).toBeLessThanOrEqual(300_000);
      // MP4 « faststart » : l'index (moov) avant les données (mdat), lecture dès les premiers octets
      expect(voice.aac.toString('latin1', 4, 8)).toBe('ftyp');
      expect(voice.aac.indexOf('moov')).toBeLessThan(voice.aac.indexOf('mdat'));
      expect(voice.aac.includes(Buffer.from('mp4a'))).toBe(true);
      // Durée, taille et empreinte calculées automatiquement
      expect(voice.durationSeconds).toBeGreaterThan(89);
      expect(voice.durationSeconds).toBeLessThan(91);
      expect(voice.sha256).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it(
    'un fichier illisible est refusé avec une raison, sans chemin du poste',
    { timeout: 60_000 },
    async () => {
      const error = await processVoice(
        docker,
        Buffer.from('OggS pas une voix'),
        'ogg',
        MODEL,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(VoiceProcessingError);
      expect((error as Error).message).not.toContain(repo);
    },
  );
});

describe('Formats reconnus à leur contenu', () => {
  const pad = (head: Buffer) => Buffer.concat([head, Buffer.alloc(16)]);
  it.each([
    ['WebM', pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), 'audio/webm'],
    ['Ogg', pad(Buffer.from('OggS')), 'audio/ogg'],
    ['MP4 / M4A', pad(Buffer.from('\0\0\0\x20ftypM4A ', 'latin1')), 'audio/mp4'],
    ['WAV', pad(Buffer.from('RIFF\0\0\0\0WAVE', 'latin1')), 'audio/wav'],
    ['MP3', pad(Buffer.from('ID3')), 'audio/mpeg'],
  ])('%s', (_name, body, mime) => {
    expect(inspectVoice(body)?.mime).toBe(mime);
  });

  it('refuse un fichier qui n’est pas une voix', () => {
    expect(inspectVoice(pad(Buffer.from('%PDF-1.7')))).toBeNull();
    expect(inspectVoice(Buffer.from('court'))).toBeNull();
  });

  it('durée : dernière position du journal de FFmpeg', () => {
    expect(parseDuration('size=1kB time=00:00:12.50 bitrate\nsize=2kB time=00:01:02.35 x')).toBe(
      62.35,
    );
    expect(parseDuration('aucune position')).toBeNull();
  });
});
