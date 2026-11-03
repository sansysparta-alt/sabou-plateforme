// Traitement d'une voix enregistrée (UC-73, CdC §8, 05_Choix_Techniques §2.7), côté serveur :
// réduction du bruit (RNNoise, filtre arnndn), normalisation du volume (EBU R128,
// loudnorm), puis Opus mono 24 kbit/s dans un conteneur WebM, index et durée en tête de
// fichier : la lecture démarre dès les premiers octets, sans aller lire la fin du fichier. Les métadonnées de l'appareil
// (nom du téléphone, date, position éventuelle) sont retirées.
import { basename, dirname, join } from 'node:path';
import { packageDir, runFfmpeg } from './ffmpeg.ts';

/** Modèle RNNoise retenu : voir models/SOURCES.md (choisi par la mesure d'intelligibilité). */
export const DEFAULT_MODEL = join(packageDir, 'models', 'cb.rnnn');

/**
 * Part de la voix débruitée dans le résultat (0 à 1). À pleine force (1), RNNoise abîme la
 * voix et l'intelligibilité baisse ; à mi-force, le bruit est réduit sans perte mesurable.
 * Voir 05_Choix_Techniques.md §2.17.
 */
export const DEFAULT_STRENGTH = 0.5;

/** Volume cible pour l'écoute sur téléphone (podcasts parlés : -16 LUFS), crête à -1,5 dBTP. */
const LOUDNESS = 'loudnorm=I=-16:TP=-1.5:LRA=11';

export interface ProcessOptions {
  /** Modèle RNNoise (.rnnn) ; celui du paquet par défaut. */
  model?: string;
  /** Force de la réduction du bruit, de 0 (aucune) à 1 (pleine) ; 0,5 par défaut. */
  strength?: number;
  /** Débit Opus en kbit/s ; 24 par défaut (CdC §8). */
  bitrateKbps?: number;
}

/** Traite `input` et écrit la voix prête à publier dans `output` (.webm, ou .ogg). */
export function processVoice(input: string, output: string, options: ProcessOptions = {}): void {
  const model = options.model ?? DEFAULT_MODEL;
  const strength = options.strength ?? DEFAULT_STRENGTH;
  if (!(strength >= 0 && strength <= 1))
    throw new Error('Force de réduction du bruit entre 0 et 1');
  // WebM : index (Cues) en tête. Ogg : n'indique pas sa durée, le navigateur va lire la fin
  // du fichier avant de jouer (mesuré : 5,3 s au lieu de moins de 3 s en 3G)
  const container = output.endsWith('.webm')
    ? ['-f', 'webm', '-cues_to_front', '1']
    : ['-f', 'ogg'];
  runFfmpeg(
    [
      '-i',
      `/in/${basename(input)}`,
      '-af',
      `arnndn=m=/model/${basename(model)}:mix=${strength},${LOUDNESS}`,
      '-ac',
      '1',
      '-ar',
      '48000',
      '-c:a',
      'libopus',
      '-b:a',
      `${options.bitrateKbps ?? 24}k`,
      // Débit variable borné : la taille reste prévisible (90 s ≈ 270 Ko)
      '-vbr',
      'constrained',
      '-application',
      'voip',
      // Trames de 60 ms (20 par défaut) : trois fois moins d'en-têtes de conteneur, sans effet
      // sur la latence d'un fichier enregistré ; tient le WebM sous 300 Ko
      '-frame_duration',
      '60',
      '-map_metadata',
      '-1',
      ...container,
      '-y',
      `/out/${basename(output)}`,
    ],
    [
      { host: dirname(input), container: '/in' },
      { host: dirname(model), container: '/model' },
      { host: dirname(output), container: '/out', writable: true },
    ],
  );
}
