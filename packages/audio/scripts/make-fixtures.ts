// Fabrique l'échantillon versionné de US-005 (fixtures/) à partir d'enregistrements
// LibriVox du domaine public (voir fixtures/SOURCES.md) :
//   voix-propre.flac   90 s de lecture en français, sans bruit (référence d'intelligibilité)
//   voix-bruitee.flac  la même voix dans un « marché » : brouhaha de trois autres voix
//                      + bruit grave continu, à 5 dB de rapport signal sur bruit
// Reproductible : sources vérifiées par leur SHA-1, découpes et bruit fixés.
// Usage (une seule fois, Docker démarré) : node scripts/make-fixtures.ts
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeToMono, packageDir, runFfmpeg } from '../src/ffmpeg.ts';

const RATE = 16_000;
const DURATION_S = 90;
const SNR_DB = 5;

interface Source {
  item: string;
  file: string;
  sha1: string;
}

const PERRAULT: Source = {
  item: 'contes_temps_passe_librivox',
  file: 'contes_du_temps_passe_03_perrault_64kb.mp3',
  sha1: '682db93e1340ba373bd77778147ab1d3ca334e2e',
};
const BECASSE_01: Source = {
  item: 'les_contes_de_la_becasse_0809_librivox',
  file: 'lescontesdelabecasse_01_maupassant_64kb.mp3',
  sha1: '53d494409893879e34ae5a24a2986b3a341620a0',
};
const BECASSE_03: Source = {
  item: 'les_contes_de_la_becasse_0809_librivox',
  file: 'lescontesdelabecasse_03_maupassant_64kb.mp3',
  sha1: '51c50d1eae583aa5eee00d71a73e60bc5a073162',
};

async function download(source: Source, dir: string): Promise<string> {
  const url = `https://archive.org/download/${source.item}/${source.file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} : ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha1 = createHash('sha1').update(bytes).digest('hex');
  if (sha1 !== source.sha1)
    throw new Error(`${source.file} : SHA-1 ${sha1}, attendu ${source.sha1}`);
  const path = join(dir, source.file);
  writeFileSync(path, bytes);
  return path;
}

function slice(samples: Float32Array, startS: number): Float32Array {
  const start = Math.round(startS * RATE);
  const out = samples.slice(start, start + DURATION_S * RATE);
  if (out.length !== DURATION_S * RATE) throw new Error('Source trop courte');
  return out;
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

function scaled(samples: Float32Array, gain: number): Float32Array {
  return samples.map((s) => s * gain);
}

function sum(...signals: Float32Array[]): Float32Array {
  return signals[0].map((_, i) => signals.reduce((acc, signal) => acc + signal[i], 0));
}

/** Bruit « brun » (grave, comme une circulation lointaine), graine fixe. */
function brownNoise(length: number): Float32Array {
  let seed = 20261102;
  const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  const out = new Float32Array(length);
  let value = 0;
  for (let i = 0; i < length; i++) {
    value = 0.995 * value + 0.05 * random();
    out[i] = value;
  }
  return out;
}

function writeFlac(samples: Float32Array, name: string, work: string): void {
  writeFileSync(join(work, `${name}.raw`), Buffer.from(samples.buffer));
  runFfmpeg(
    [
      '-f',
      'f32le',
      '-ar',
      String(RATE),
      '-ac',
      '1',
      '-i',
      `/work/${name}.raw`,
      '-c:a',
      'flac',
      '-sample_fmt',
      's16',
      '-map_metadata',
      '-1',
      '-y',
      `/out/${name}.flac`,
    ],
    [
      { host: work, container: '/work' },
      { host: join(packageDir, 'fixtures'), container: '/out', writable: true },
    ],
  );
}

const work = mkdtempSync(join(tmpdir(), 'sabou-audio-'));
try {
  const [perrault, becasse01, becasse03] = await Promise.all(
    [PERRAULT, BECASSE_01, BECASSE_03].map((source) => download(source, work)),
  );
  const decodedPerrault = decodeToMono(perrault, RATE);
  // Voix : après l'annonce LibriVox ; brouhaha : trois autres passages, autres lecteurs
  const clean = slice(decodedPerrault, 36);
  const babbleVoices = [
    slice(decodeToMono(becasse01, RATE), 40),
    slice(decodeToMono(becasse03, RATE), 30),
    slice(decodedPerrault, 200),
  ].map((voice) => scaled(voice, 1 / rms(voice)));
  const babble = sum(...babbleVoices);
  const rumble = brownNoise(clean.length);
  const noise = sum(scaled(babble, 1 / rms(babble)), scaled(rumble, 0.5 / rms(rumble)));
  // Rapport signal sur bruit exact : 5 dB
  const noiseGain = rms(clean) / (rms(noise) * 10 ** (SNR_DB / 20));
  let noisy = sum(clean, scaled(noise, noiseGain));
  // Pas d'écrêtage : même gain pour tout le mélange (la voix propre reste la référence)
  const peak = noisy.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
  if (peak > 0.95) noisy = scaled(noisy, 0.95 / peak);

  writeFlac(clean, 'voix-propre', work);
  writeFlac(noisy, 'voix-bruitee', work);
  for (const name of ['voix-propre', 'voix-bruitee']) {
    const bytes = readFileSync(join(packageDir, 'fixtures', `${name}.flac`));
    console.log(
      `${name}.flac  ${bytes.length} octets  sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
