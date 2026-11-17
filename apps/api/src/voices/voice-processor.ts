import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { PIECE_STORAGE, type PieceStorage } from '../dossiers/piece-storage';
import {
  type FfmpegRunner,
  inspectVoice,
  processVoice,
  VoiceProcessingError,
} from './voice-processing';
import { VoicesRepository } from './voices.repository';

export const FFMPEG_RUNNER = Symbol('FFMPEG_RUNNER');

// Une voix à la fois : FFmpeg occupe un cœur ; la file attend plutôt que de saturer l'API
const BATCH_SIZE = 1;

// Traitement des voix déposées (US-070), relevé toutes les AUDIO_POLL_SECONDS (0 : jamais).
// Un seul passage à la fois. Un échec (fichier illisible, FFmpeg) est réessayé deux fois ;
// au troisième, le dépôt passe en échec avec sa raison, visible par le dépositaire.
@Injectable()
export class VoiceProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Voix');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repository: VoicesRepository,
    @Inject(PIECE_STORAGE) private readonly storage: PieceStorage,
    @Inject(FFMPEG_RUNNER) private readonly ffmpeg: FfmpegRunner,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.AUDIO_POLL_SECONDS === 0) return;
    this.timer = setInterval(() => void this.processPending(), this.env.AUDIO_POLL_SECONDS * 1000);
    this.timer.unref();
    void this.processPending();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  processPending(): Promise<number> {
    this.running ??= this.processOnce()
      .catch((error: unknown) => {
        this.logger.warn(`Relève de la file des voix impossible : ${(error as Error).message}`);
        return 0;
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async processOnce(): Promise<number> {
    const pending = await this.repository.take(BATCH_SIZE);
    for (const voice of pending) {
      try {
        const original = await this.storage.get(voice.key);
        if (!original) throw new VoiceProcessingError('Fichier d’origine introuvable');
        const format = inspectVoice(original);
        if (!format) throw new VoiceProcessingError('Format non reconnu');
        const result = await processVoice(
          this.ffmpeg,
          original,
          format.extension,
          this.env.AUDIO_MODEL_PATH,
        );
        // Clés tirées au hasard ; les deux versions partagent le même nom
        const name = `voix/${randomUUID()}`;
        await this.storage.put(`${name}.webm`, result.opus, 'audio/webm');
        await this.storage.put(`${name}.m4a`, result.aac, 'audio/mp4');
        await this.repository.complete(voice.id, {
          key: `${name}.webm`,
          fallbackKey: `${name}.m4a`,
          duration: result.durationSeconds,
          size: result.opus.length,
          fallbackSize: result.aac.length,
          sha256: result.sha256,
        });
        this.logger.log(
          `Voix du dépôt ${voice.id} traitée (${result.durationSeconds.toFixed(1)} s)`,
        );
      } catch (error) {
        const reason =
          error instanceof VoiceProcessingError ? error.message : 'Erreur interne du traitement';
        if (!(error instanceof VoiceProcessingError)) {
          this.logger.error(`Dépôt ${voice.id} : ${(error as Error).message}`);
        }
        const status = await this.repository.fail(voice.id, reason);
        this.logger.warn(`Dépôt ${voice.id} : ${reason} (${status ?? 'état inconnu'})`);
      }
    }
    return pending.length;
  }
}
