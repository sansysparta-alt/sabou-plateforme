import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AuthModule, VALKEY } from '../auth/auth.module';
import { ENV, type Env } from '../config/env';
import { CITIZEN_IDENTITY, KeycloakCitizenIdentity } from './citizen-identity';
import { PasswordResetController } from './password-reset.controller';
import { PASSWORD_RESET_STORE, PasswordResetService } from './password-reset.service';
import { SignupController } from './signup.controller';
import { SignupRepository } from './signup.repository';
import { SignupService } from './signup.service';
import { SIGNUP_STORE, ValkeySignupStore } from './signup.store';

// Inscription des citoyens par leur numéro de téléphone (lot D : US-014, §2.25) et mot de
// passe oublié par SMS (US-069)
@Module({
  imports: [AuthModule],
  controllers: [SignupController, PasswordResetController],
  providers: [
    SignupRepository,
    SignupService,
    PasswordResetService,
    { provide: SIGNUP_STORE, inject: [VALKEY], useFactory: (v: Redis) => new ValkeySignupStore(v) },
    {
      provide: PASSWORD_RESET_STORE,
      inject: [VALKEY],
      useFactory: (v: Redis) => new ValkeySignupStore(v, 'mot-de-passe'),
    },
    {
      provide: CITIZEN_IDENTITY,
      inject: [ENV],
      useFactory: (env: Env) => new KeycloakCitizenIdentity(env),
    },
  ],
})
export class SignupModule {}
