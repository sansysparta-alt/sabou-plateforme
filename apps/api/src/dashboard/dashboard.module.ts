import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdministratorGuard } from '../certification/certification.controller';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';

// Tableau de bord d'accueil de l'application de gestion (US-016)
@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
  providers: [DashboardRepository, AdministratorGuard],
})
export class DashboardModule {}
