import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdministratorGuard } from '../certification/certification.controller';
import { ExportsController, MonthlyReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';

// Rapports mensuels préfectoral → régional → DG et exports PDF et XLSX avec leur historique
// (US-091, 05 §2.91)
@Module({
  imports: [AuthModule],
  controllers: [MonthlyReportsController, ExportsController],
  providers: [ReportsRepository, AdministratorGuard],
  exports: [ReportsRepository],
})
export class ReportsModule {}
