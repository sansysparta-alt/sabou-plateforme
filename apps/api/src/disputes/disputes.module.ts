import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdministratorGuard } from '../certification/certification.controller';
import { CertificatesModule } from '../certificates/certificates.module';
import { PractitionerGuard } from '../dossiers/dossiers.controller';
import { pieceStorageProvider } from '../dossiers/piece-storage';
import { DisputesController, PractitionerDisputesController } from './disputes.controller';
import { DisputesRepository } from './disputes.repository';

// Litiges et recours (US-101) : espace du praticien (mobile) et instruction (gestion). Le
// recours accepté fait signer le nouveau certificat par le coffre de US-045.
@Module({
  imports: [AuthModule, CertificatesModule],
  controllers: [PractitionerDisputesController, DisputesController],
  providers: [DisputesRepository, AdministratorGuard, PractitionerGuard, pieceStorageProvider],
})
export class DisputesModule {}
