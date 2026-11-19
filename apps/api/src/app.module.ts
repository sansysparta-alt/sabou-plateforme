import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { DossiersModule } from './dossiers/dossiers.module';
import { FieldDossiersModule } from './field-dossiers/field-dossiers.module';
import { HealthController } from './health/health.controller';
import { AccountsModule } from './accounts/accounts.module';
import { AnnotationsModule } from './annotations/annotations.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CertificatesModule } from './certificates/certificates.module';
import { CertificationModule } from './certification/certification.module';
import { DiseasesModule } from './diseases/diseases.module';
import { VoicesModule } from './voices/voices.module';
import { PlantsModule } from './plants/plants.module';
import { ReferentialsModule } from './referentials/referentials.module';
import { RejectionsModule } from './rejections/rejections.module';
import { SignupModule } from './signup/signup.module';
import { SmsModule } from './sms/sms.module';
import { SyncModule } from './sync/sync.module';
import { TreatmentsModule } from './treatments/treatments.module';
import { VisitsModule } from './visits/visits.module';

// Module racine : chaque domaine (certification, dictionnaire, traitements…) y sera importé
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuditModule,
    AuthModule,
    AccountsModule,
    AnnotationsModule,
    CertificationModule,
    CertificatesModule,
    RejectionsModule,
    PlantsModule,
    DiseasesModule,
    VoicesModule,
    VisitsModule,
    DashboardModule,
    DossiersModule,
    // US-040c
    FieldDossiersModule,
    ReferentialsModule,
    SignupModule,
    SmsModule,
    SyncModule,
    TreatmentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
