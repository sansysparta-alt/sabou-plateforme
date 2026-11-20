import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdministratorGuard } from '../certification/certification.controller';
import { CertificatesController } from './certificates.controller';
import { CertificatesRepository } from './certificates.repository';
import { CERTIFICATE_SIGNER, VaultSigner } from './vault-signer';

// Approbation par la DG et certificat signé par le coffre (US-045)
@Module({
  imports: [AuthModule],
  controllers: [CertificatesController],
  providers: [
    CertificatesRepository,
    AdministratorGuard,
    { provide: CERTIFICATE_SIGNER, useClass: VaultSigner },
  ],
  // US-101 : le recours accepté fait signer un nouveau certificat par le même coffre
  exports: [CERTIFICATE_SIGNER],
})
export class CertificatesModule {}
