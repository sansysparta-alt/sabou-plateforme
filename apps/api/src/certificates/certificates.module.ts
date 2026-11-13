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
})
export class CertificatesModule {}
