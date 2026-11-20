import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdministratorGuard } from '../certification/certification.controller';
import { AlertsController } from './alerts.controller';
import { AlertsRepository } from './alerts.repository';

// Alertes territoriales (US-102). La détection automatique passe par la relève des SMS
// (sms/sms-dispatcher.ts), comme les rappels de visite.
@Module({
  imports: [AuthModule],
  controllers: [AlertsController],
  providers: [AlertsRepository, AdministratorGuard],
})
export class AlertsModule {}
