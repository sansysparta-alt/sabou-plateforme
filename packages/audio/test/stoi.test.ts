import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeToMono, packageDir } from '../src/ffmpeg.ts';
import { align, findLag, stoi, STOI_RATE } from '../src/stoi.ts';

const fixture = (name: string) => decodeToMono(join(packageDir, 'fixtures', name), STOI_RATE);
const first30s = (samples: Float32Array) => samples.slice(0, 30 * STOI_RATE);

describe('STOI', () => {
  const clean = first30s(fixture('voix-propre.flac'));
  const noisy = first30s(fixture('voix-bruitee.flac'));

  // Valeurs de référence calculées par pystoi 0.4.1 (implémentation de référence, MIT)
  // sur exactement les mêmes échantillons à 10 kHz, le 2 novembre 2026
  it.each([
    ['la voix elle-même', () => clean, 1],
    ['la voix bruitée de l’échantillon', () => noisy, 0.875301],
    ['la voix deux fois plus bruitée', () => noisy.map((v, i) => 2 * v - clean[i]), 0.758761],
  ])('donne la même valeur que pystoi pour %s', (_, degraded, expected) => {
    expect(stoi(clean, degraded())).toBeCloseTo(expected, 4);
  });

  it('retrouve un décalage connu et réaligne le signal', () => {
    const delayed = new Float32Array(clean.length);
    delayed.set(clean.subarray(0, clean.length - 37), 37);
    const lag = findLag(clean, delayed, 200);
    expect(lag).toBe(37);
    expect(stoi(clean, align(clean, delayed, lag))).toBeGreaterThan(0.99);
  });

  it('refuse des signaux de longueurs différentes', () => {
    expect(() => stoi(clean, clean.subarray(1))).toThrow();
  });
});
