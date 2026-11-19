import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { pieceStorageProvider } from '../dossiers/piece-storage';
import { LocalFfmpegRunner } from './voice-processing';
import { NameVoicesController } from './name-voices.controller';
import { NameVoicesRepository } from './name-voices.repository';
import { TreatmentVoicesController } from './treatment-voices.controller';
import { TreatmentVoicesRepository } from './treatment-voices.repository';
import { FFMPEG_RUNNER, VoiceProcessor } from './voice-processor';
import { VoicesController } from './voices.controller';
import { VoicesRepository } from './voices.repository';

// Voix déposées et leur traitement (US-070). FFmpeg est celui de l'image de l'API. Voix du nom
// des plantes et des maladies, avec leurs statuts par langue (US-071) ; voix des sections des
// traitements (US-075, US-072 à US-074).
@Module({
  imports: [AuthModule],
  controllers: [VoicesController, NameVoicesController, TreatmentVoicesController],
  providers: [
    VoicesRepository,
    NameVoicesRepository,
    TreatmentVoicesRepository,
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
