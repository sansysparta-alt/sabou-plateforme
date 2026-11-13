import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { keycloakMobileTokenVerifier, MOBILE_TOKEN_VERIFIER } from '../auth/mobile-token';
import { ENV } from '../config/env';
import { DossiersController, PractitionerGuard } from './dossiers.controller';
import { DossiersRepository } from './dossiers.repository';
import { DossiersService } from './dossiers.service';
import { pieceStorageProvider } from './piece-storage';

// Dossier de certification soumis par le praticien (US-040a, §2.26)
@Module({
  imports: [AuthModule],
  controllers: [DossiersController],
  providers: [
    DossiersRepository,
    DossiersService,
    PractitionerGuard,
    // Jetons de l'application mobile (US-040b, §2.29)
    { provide: MOBILE_TOKEN_VERIFIER, inject: [ENV], useFactory: keycloakMobileTokenVerifier },
    pieceStorageProvider,
  ],
})
export class DossiersModule {}
