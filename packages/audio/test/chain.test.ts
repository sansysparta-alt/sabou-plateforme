// US-005, critère 1 : 90 s enregistrées dans un lieu bruyant, une fois traitées (RNNoise,
// normalisation, Opus 24 kbit/s), pèsent au plus 300 Ko et restent compréhensibles.
// Compréhensible = indice STOI d'au moins 0,75 par rapport à la voix propre, et perte
// d'au plus 0,02 par rapport à la même voix compressée sans traitement (05_Choix_Techniques §2.17).
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeToMono, packageDir, runFfmpeg } from '../src/ffmpeg.ts';
import { DEFAULT_MODEL, processVoice } from '../src/process.ts';
import { align, findLag, stoi, STOI_RATE } from '../src/stoi.ts';

const MAX_BYTES = 300_000;
const MIN_STOI = 0.75;
const MAX_STOI_LOSS = 0.02;

const fixtures = join(packageDir, 'fixtures');
const noisyInput = join(fixtures, 'voix-bruitee.flac');
let work: string;

function stoiAgainstClean(file: string): number {
  const clean = decodeToMono(join(fixtures, 'voix-propre.flac'), STOI_RATE);
  const degraded = decodeToMono(file, STOI_RATE);
  return stoi(clean, align(clean, degraded, findLag(clean, degraded, 2000)));
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'sabou-audio-test-'));
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('Chaîne audio (US-005, UC-73)', () => {
  it('le modèle RNNoise versionné est bien celui de la source (SHA-256)', () => {
    const sha256 = createHash('sha256').update(readFileSync(DEFAULT_MODEL)).digest('hex');
    expect(sha256).toBe('f1357c4e5be9dee8467bead486dfced2d75b640c26ad0b594fa7f102322371d9');
  });

  describe('90 s de voix dans un marché, traitées', () => {
    let output: string;
    let processedStoi: number;

    beforeAll(() => {
      output = join(work, 'voix-traitee.ogg');
      processVoice(noisyInput, output);
      processedStoi = stoiAgainstClean(output);
    });

    it(`pèsent au plus ${MAX_BYTES / 1000} Ko`, () => {
      expect(statSync(output).size).toBeLessThanOrEqual(MAX_BYTES);
    });

    it('durent toujours 90 s (rien de coupé)', () => {
      const seconds = decodeToMono(output, STOI_RATE).length / STOI_RATE;
      expect(seconds).toBeGreaterThan(89.9);
      expect(seconds).toBeLessThan(90.1);
    });

    it(`restent compréhensibles : STOI d’au moins ${MIN_STOI}`, () => {
      expect(processedStoi).toBeGreaterThanOrEqual(MIN_STOI);
    });

    it(`le traitement coûte au plus ${MAX_STOI_LOSS} d’intelligibilité, par rapport à la compression seule`, () => {
      const compressedOnly = join(work, 'compression-seule.ogg');
      // Même voix, même codec et même débit, sans réduction du bruit ni normalisation
      runFfmpeg(
        [
          '-i',
          '/in/voix-bruitee.flac',
          '-ac',
          '1',
          '-ar',
          '48000',
          '-c:a',
          'libopus',
          '-b:a',
          '24k',
          '-vbr',
          'constrained',
          '-application',
          'voip',
          '-y',
          '/out/compression-seule.ogg',
        ],
        [
          { host: fixtures, container: '/in' },
          { host: work, container: '/out', writable: true },
        ],
      );
      expect(stoiAgainstClean(compressedOnly) - processedStoi).toBeLessThanOrEqual(MAX_STOI_LOSS);
    });
  });

  it('retire les métadonnées du téléphone (nom de l’appareil, position)', () => {
    const tagged = join(work, 'avec-metadonnees.ogg');
    runFfmpeg(
      [
        '-i',
        '/in/voix-bruitee.flac',
        '-t',
        '5',
        '-metadata',
        'title=Essai',
        '-metadata',
        'location=+09.5092-013.7122/',
        '-metadata',
        'encoder=REDMI Note 15',
        '-c:a',
        'libopus',
        '-y',
        '/out/avec-metadonnees.ogg',
      ],
      [
        { host: fixtures, container: '/in' },
        { host: work, container: '/out', writable: true },
      ],
    );
    const output = join(work, 'sans-metadonnees.ogg');
    processVoice(tagged, output);
    const metadata = runFfmpeg(
      ['-i', '/w/sans-metadonnees.ogg', '-f', 'ffmetadata', '-'],
      [{ host: work, container: '/w' }],
    ).toString('utf8');
    expect(metadata).not.toMatch(/title|location|REDMI|Essai/i);
  });

  it('refuse une force de réduction du bruit hors de 0 à 1', () => {
    expect(() => processVoice(noisyInput, join(work, 'x.ogg'), { strength: 2 })).toThrow();
  });
});
