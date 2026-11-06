import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdministratorGuard, CertificationController } from './certification.controller';
import { CertificationRepository } from './certification.repository';

// Certification : pour l'instant, les listes cloisonnées par zone (lot B : US-011)
@Module({
  imports: [AuthModule],
  controllers: [CertificationController],
  providers: [CertificationRepository, AdministratorGuard],
})
export class CertificationModule {}
