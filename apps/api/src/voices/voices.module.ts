import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { pieceStorageProvider } from '../dossiers/piece-storage';
import { LocalFfmpegRunner } from './voice-processing';
import { FFMPEG_RUNNER, VoiceProcessor } from './voice-processor';
import { VoicesController } from './voices.controller';
import { VoicesRepository } from './voices.repository';

// Voix déposées et leur traitement (US-070). FFmpeg est celui de l'image de l'API.
@Module({
  imports: [AuthModule],
  controllers: [VoicesController],
  providers: [
    VoicesRepository,
    VoiceProcessor,
    AdministratorGuard,
    pieceStorageProvider,
    {
      provide: FFMPEG_RUNNER,
      inject: [ENV],
      useFactory: (env: Env) => new LocalFfmpegRunner(env.FFMPEG_PATH),
    },
  ],
})
export class VoicesModule {}
