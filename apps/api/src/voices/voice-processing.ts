import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Traitement d'une voix déposée (US-070, UC-73, CdC §8). Réglages mesurés par le prototype
// US-005 (packages/audio, 05_Choix_Techniques §2.17) : RNNoise à mi-force (modèle « cb »),
// volume à -16 LUFS, Opus mono 24 kbit/s en WebM (index en tête, trames de 60 ms) ; plus un
// secours AAC (MP4, « faststart ») pour les navigateurs qui lisent mal Opus. Un seul passage
// FFmpeg : les deux versions viennent du même son nettoyé. Métadonnées de l'appareil retirées.

// FFmpeg 9.0.2 statique (un seul binaire, sans bibliothèque du système), image épinglée par
// empreinte : copié dans l'image de l'API (apps/api/Dockerfile), lancé tel quel par les tests
export const FFMPEG_IMAGE =
  'mwader/static-ffmpeg@sha256:7d9bdaaf887f7e6ce6151f67325c344074b5ff1fb75316011c3376503e449a7b';

export const VOICE_MAX_BYTES = 3 * 1024 * 1024;
// Au-delà, la voix n'est pas traitée (une section dure 90 s en visée, R-REC-14)
export const VOICE_MAX_SECONDS = 300;

export type VoiceMime = 'audio/webm' | 'audio/ogg' | 'audio/mp4' | 'audio/wav' | 'audio/mpeg';

// Formats des téléphones et navigateurs, reconnus à leur contenu (jamais au type annoncé)
export function inspectVoice(body: Buffer): { mime: VoiceMime; extension: string } | null {
  if (body.length < 16) return null;
  const ascii = (start: number, end: number) => body.toString('latin1', start, end);
  if (body.readUInt32BE(0) === 0x1a45dfa3) return { mime: 'audio/webm', extension: 'webm' };
  if (ascii(0, 4) === 'OggS') return { mime: 'audio/ogg', extension: 'ogg' };
  if (ascii(4, 8) === 'ftyp') return { mime: 'audio/mp4', extension: 'm4a' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')
    return { mime: 'audio/wav', extension: 'wav' };
  if (ascii(0, 3) === 'ID3' || (body[0] === 0xff && (body[1]! & 0xe0) === 0xe0)) {
    return { mime: 'audio/mpeg', extension: 'mp3' };
  }
  return null;
}

const LOUDNESS = 'loudnorm=I=-16:TP=-1.5:LRA=11';
const STRENGTH = 0.5;

// Arguments FFmpeg, chemins relatifs au dossier de travail
export function voiceArgs(input: string, model: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    input,
    '-t',
    String(VOICE_MAX_SECONDS),
    '-filter_complex',
    `[0:a:0]arnndn=m=${model}:mix=${STRENGTH},${LOUDNESS},aresample=48000,asplit=2[opus][aac]`,
    '-map_metadata',
    '-1',
    // Opus mono 24 kbit/s, débit variable borné, trames de 60 ms, WebM index en tête
    '-map',
    '[opus]',
    '-ac',
    '1',
    '-c:a',
    'libopus',
    '-b:a',
    '24k',
    '-vbr',
    'constrained',
    '-application',
    'voip',
    '-frame_duration',
    '60',
    '-f',
    'webm',
    '-cues_to_front',
    '1',
    'voix.webm',
    // Secours AAC mono 32 kbit/s, 24 kHz suffisent à la parole ; métadonnées en tête
    '-map',
    '[aac]',
    '-map_metadata',
    '-1',
    '-ac',
    '1',
    '-ar',
    '24000',
    '-c:a',
    'aac',
    '-b:a',
    '32k',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    'voix.m4a',
  ];
}

// Durée lue dans le journal de FFmpeg : dernière position atteinte (« time=00:01:02.35 »)
export function parseDuration(log: string): number | null {
  const times = [...log.matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
  const last = times.at(-1);
  if (!last) return null;
  const seconds = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
  return seconds > 0 ? seconds : null;
}

// Lance FFmpeg dans un dossier de travail (binaire local en production ; conteneur Docker
// pour les tests du poste, voir voices.test-support.ts)
export interface FfmpegRunner {
  run(args: string[], workDir: string): Promise<{ code: number; log: string }>;
}

export class LocalFfmpegRunner implements FfmpegRunner {
  constructor(private readonly binary: string) {}

  run(args: string[], workDir: string): Promise<{ code: number; log: string }> {
    return new Promise((resolve, reject) => {
      // Aucun shell : les arguments ne sont jamais interprétés
      const child = spawn(this.binary, args, { cwd: workDir, stdio: ['ignore', 'ignore', 'pipe'] });
      let log = '';
      child.stderr.on('data', (chunk: Buffer) => {
        // Seule la fin du journal sert (durée, erreur)
        log = (log + chunk.toString('utf8')).slice(-20_000);
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? 1, log }));
    });
  }
}

export interface ProcessedVoice {
  opus: Buffer;
  aac: Buffer;
  durationSeconds: number;
  sha256: string;
}

export class VoiceProcessingError extends Error {}

// Traite une voix : fichiers dans un dossier temporaire propre à ce traitement, retiré ensuite
export async function processVoice(
  runner: FfmpegRunner,
  original: Buffer,
  extension: string,
  modelFile: string,
): Promise<ProcessedVoice> {
  const work = await mkdtemp(join(tmpdir(), 'sabou-voix-'));
  try {
    const input = `origine.${extension}`;
    await writeFile(join(work, input), original);
    await writeFile(join(work, 'modele.rnnn'), await readFile(modelFile));
    const { code, log } = await runner.run(voiceArgs(input, 'modele.rnnn'), work);
    if (code !== 0) {
      // Dernière ligne du journal : la raison, sans chemin du poste
      const reason = log.trim().split('\n').at(-1)?.slice(0, 200) ?? 'erreur inconnue';
      throw new VoiceProcessingError(`FFmpeg a échoué (${code}) : ${reason}`);
    }
    const durationSeconds = parseDuration(log);
    if (durationSeconds === null) throw new VoiceProcessingError('Voix vide ou illisible');
    const opus = await readFile(join(work, 'voix.webm'));
    const aac = await readFile(join(work, 'voix.m4a'));
    return {
      opus,
      aac,
      durationSeconds,
      sha256: createHash('sha256').update(opus).digest('hex'),
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
