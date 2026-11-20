import { Module } from '@nestjs/common';
import { DirectorGuard } from '../accounts/accounts.controller';
import { AuthModule } from '../auth/auth.module';
import { keycloakMobileTokenVerifier, MOBILE_TOKEN_VERIFIER } from '../auth/mobile-token';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV } from '../config/env';
import { PractitionerGuard } from '../dossiers/dossiers.controller';
import { DashboardController, PractitionerDashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { FunnelController } from './funnel.controller';
import { FunnelRepository } from './funnel.repository';

// Tableau de bord d'accueil de l'application de gestion (US-016, US-090), entonnoir de la DG
// (US-048) et tableau de bord du praticien dans l'application mobile (US-090)
@Module({
  imports: [AuthModule],
  controllers: [DashboardController, PractitionerDashboardController, FunnelController],
  providers: [
    DashboardRepository,
    FunnelRepository,
    AdministratorGuard,
    DirectorGuard,
    PractitionerGuard,
    // Jeton de l'application du praticien (client « sabou-mobile »), comme le dossier et le Studio
    { provide: MOBILE_TOKEN_VERIFIER, inject: [ENV], useFactory: keycloakMobileTokenVerifier },
  ],
})
export class DashboardModule {}
