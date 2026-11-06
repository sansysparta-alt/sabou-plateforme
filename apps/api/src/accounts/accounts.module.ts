import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ENV, type Env } from '../config/env';
import { AccountsController, DirectorGuard, InvitationController } from './accounts.controller';
import { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { IDENTITY_ADMIN, KeycloakIdentityAdmin } from './identity-admin';

// Gestion des comptes par la DG (lot A : US-012, US-013)
@Module({
  imports: [AuthModule],
  controllers: [AccountsController, InvitationController],
  providers: [
    AccountsRepository,
    AccountsService,
    DirectorGuard,
    {
      provide: IDENTITY_ADMIN,
      inject: [ENV],
      useFactory: (env: Env) => new KeycloakIdentityAdmin(env),
    },
  ],
})
export class AccountsModule {}
