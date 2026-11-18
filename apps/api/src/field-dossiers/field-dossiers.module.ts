import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdministratorGuard } from '../certification/certification.controller';
import { ENV, type Env } from '../config/env';
import { pieceStorageProvider } from '../dossiers/piece-storage';
import { CITIZEN_IDENTITY, KeycloakCitizenIdentity } from '../signup/citizen-identity';
import { FieldDossiersController } from './field-dossiers.controller';
import { FieldDossiersRepository } from './field-dossiers.repository';
import { FieldDossiersService } from './field-dossiers.service';

// Dossier terrain de l'admin préfectoral (US-040c). Le compte du praticien est créé dans le
// domaine public par le compte de service de l'inscription (« sabou-inscription »).
@Module({
  imports: [AuthModule],
  controllers: [FieldDossiersController],
  providers: [
    FieldDossiersRepository,
    FieldDossiersService,
    AdministratorGuard,
    pieceStorageProvider,
    {
      provide: CITIZEN_IDENTITY,
      inject: [ENV],
      useFactory: (env: Env) => new KeycloakCitizenIdentity(env),
    },
  ],
})
export class FieldDossiersModule {}
