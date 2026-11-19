import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AuthModule, VALKEY } from '../auth/auth.module';
import { AdministratorGuard } from '../certification/certification.controller';
import { ValkeySignupStore } from '../signup/signup.store';
import {
  HEALTH_REPORT_STORE,
  HealthReportsController,
  PublicHealthReportsController,
} from './health-reports.controller';
import { HealthReportsRepository } from './health-reports.repository';

// Signalements de danger et d'effets indésirables (US-100) : dépôt public, file du Comité
@Module({
  imports: [AuthModule],
  controllers: [PublicHealthReportsController, HealthReportsController],
  providers: [
    HealthReportsRepository,
    AdministratorGuard,
    {
      provide: HEALTH_REPORT_STORE,
      inject: [VALKEY],
      useFactory: (v: Redis) => new ValkeySignupStore(v, 'signalement'),
    },
  ],
})
export class HealthReportsModule {}
