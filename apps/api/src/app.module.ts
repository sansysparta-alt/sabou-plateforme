import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { DossiersModule } from './dossiers/dossiers.module';
import { HealthController } from './health/health.controller';
import { AccountsModule } from './accounts/accounts.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CertificationModule } from './certification/certification.module';
import { ReferentialsModule } from './referentials/referentials.module';
import { SignupModule } from './signup/signup.module';
import { SmsModule } from './sms/sms.module';
import { SyncModule } from './sync/sync.module';
import { VisitsModule } from './visits/visits.module';

// Module racine : chaque domaine (certification, dictionnaire, traitements…) y sera importé
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuditModule,
    AuthModule,
    AccountsModule,
    CertificationModule,
    VisitsModule,
    DashboardModule,
    DossiersModule,
    ReferentialsModule,
    SignupModule,
    SmsModule,
    SyncModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
