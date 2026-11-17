import { Module } from '@nestjs/common';
import { DirectorGuard } from '../accounts/accounts.controller';
import { AuthModule } from '../auth/auth.module';
import { AdministratorGuard } from '../certification/certification.controller';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { FunnelController } from './funnel.controller';
import { FunnelRepository } from './funnel.repository';

// Tableau de bord d'accueil de l'application de gestion (US-016) et entonnoir de la DG (US-048)
@Module({
  imports: [AuthModule],
  controllers: [DashboardController, FunnelController],
  providers: [DashboardRepository, FunnelRepository, AdministratorGuard, DirectorGuard],
})
export class DashboardModule {}
