import { Module } from '@nestjs/common';
import { AccountsRepository } from '../accounts/accounts.repository';
import { DirectorGuard } from '../accounts/accounts.controller';
import { IDENTITY_ADMIN, KeycloakIdentityAdmin } from '../accounts/identity-admin';
import { AuthModule } from '../auth/auth.module';
import { ENV, type Env } from '../config/env';
import { ReferentialsController } from './referentials.controller';
import { ReferentialsRepository } from './referentials.repository';
import { ReferentialsService } from './referentials.service';

// Référentiels gérés par la DG (lot C : US-020, US-021)
@Module({
  imports: [AuthModule],
  controllers: [ReferentialsController],
  providers: [
    AccountsRepository,
    ReferentialsRepository,
    ReferentialsService,
    DirectorGuard,
    // US-022 : une fusion suspend des comptes préfectoraux (accès Keycloak coupé)
    {
      provide: IDENTITY_ADMIN,
      inject: [ENV],
      useFactory: (env: Env) => new KeycloakIdentityAdmin(env),
    },
  ],
})
export class ReferentialsModule {}
