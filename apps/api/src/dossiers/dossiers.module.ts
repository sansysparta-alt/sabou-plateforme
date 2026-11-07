import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ENV, type Env } from '../config/env';
import { JournalSmsSender, SMS_SENDER } from '../signup/sms';
import { DossiersController, PractitionerGuard } from './dossiers.controller';
import { DossiersRepository } from './dossiers.repository';
import { DossiersService } from './dossiers.service';
import { PIECE_STORAGE, S3PieceStorage } from './piece-storage';

// Dossier de certification soumis par le praticien (US-040a, §2.26)
@Module({
  imports: [AuthModule],
  controllers: [DossiersController],
  providers: [
    DossiersRepository,
    DossiersService,
    PractitionerGuard,
    {
      provide: PIECE_STORAGE,
      inject: [ENV],
      useFactory: async (env: Env) => {
        const storage = new S3PieceStorage({
          endpoint: env.S3_ENDPOINT,
          bucket: env.S3_PIECES_BUCKET,
          accessKey: env.S3_ACCESS_KEY,
          secretKey: env.S3_SECRET_KEY,
          region: env.S3_REGION,
        });
        if (env.S3_CREATE_BUCKET) await storage.ensureBucket();
        return storage;
      },
    },
    // Même interface d'envoi que l'inscription (SMS_PROVIDER=journal) ; agrégateur avec US-031
    { provide: SMS_SENDER, useClass: JournalSmsSender },
  ],
})
export class DossiersModule {}
