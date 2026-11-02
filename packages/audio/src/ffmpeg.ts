import { spawnSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// FFmpeg 9.0.2, image « scratch » (FFmpeg seul, sans système d'exploitation), épinglée
// par empreinte. Filtres utilisés : arnndn (RNNoise), loudnorm ; codecs : libopus, flac.
export const FFMPEG_IMAGE =
  'jrottenberg/ffmpeg@sha256:f6ca6c7df4d07d6f550a7a0321c9005f0ab4bf26633a5cca1b950fb2a7037900';

export const packageDir = fileURLToPath(new URL('..', import.meta.url));

export interface Mount {
  /** Dossier du poste */
  host: string;
  /** Chemin dans le conteneur */
  container: string;
  writable?: boolean;
}

/**
 * Lance FFmpeg dans son conteneur, sans réseau. Les chemins passés en arguments sont
 * ceux du conteneur (voir `mounts`). Renvoie la sortie standard (données binaires).
 */
export function runFfmpeg(args: string[], mounts: Mount[]): Buffer {
  const docker = ['run', '--rm', '--network', 'none'];
  for (const mount of mounts) {
    docker.push(
      '--volume',
      `${resolve(mount.host)}:${mount.container}${mount.writable ? '' : ':ro'}`,
    );
  }
  docker.push(FFMPEG_IMAGE, '-hide_banner', '-nostdin', '-loglevel', 'error', ...args);
  const result = spawnSync('docker', docker, {
    maxBuffer: 256 * 1024 * 1024,
    // Git Bash convertirait les chemins du conteneur (/in/…) en chemins Windows
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  if (result.error) throw new Error(`Docker introuvable : ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`FFmpeg a échoué (${result.status}) : ${result.stderr.toString('utf8')}`);
  }
  return result.stdout;
}

/** Décode un fichier audio en échantillons mono flottants, au débit demandé. */
export function decodeToMono(file: string, sampleRate: number): Float32Array {
  const pcm = runFfmpeg(
    ['-i', `/in/${basename(file)}`, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-'],
    [{ host: dirname(file), container: '/in' }],
  );
  // Copie alignée : le tampon renvoyé par Node peut commencer à un décalage quelconque
  return new Float32Array(new Uint8Array(pcm).buffer, 0, pcm.length / 4);
}
