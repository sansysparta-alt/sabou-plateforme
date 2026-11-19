import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { keycloakMobileTokenVerifier, MOBILE_TOKEN_VERIFIER } from '../auth/mobile-token';
import { ENV } from '../config/env';
import { AdministratorGuard } from '../certification/certification.controller';
import { PractitionerGuard } from '../dossiers/dossiers.controller';
import { pieceStorageProvider } from '../dossiers/piece-storage';
import { CircuitController } from './circuit.controller';
import { CircuitRepository } from './circuit.repository';
import { StudioController } from './studio.controller';
import { StudioRepository } from './studio.repository';
import { StudioVoicesController } from './studio-voices.controller';
import { StudioVoicesRepository } from './studio-voices.repository';

// Traitements : Studio du praticien (US-060) et ses voix (US-081), circuit côté administrateurs
// (US-061)
@Module({
  imports: [AuthModule],
  controllers: [StudioController, StudioVoicesController, CircuitController],
  providers: [
    StudioRepository,
    StudioVoicesRepository,
    pieceStorageProvider,
    CircuitRepository,
    PractitionerGuard,
    AdministratorGuard,
    { provide: MOBILE_TOKEN_VERIFIER, inject: [ENV], useFactory: keycloakMobileTokenVerifier },
  ],
})
export class TreatmentsModule {}
