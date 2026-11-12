import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AuthModule, VALKEY } from '../auth/auth.module';
import { ENV, type Env } from '../config/env';
import { CITIZEN_IDENTITY, KeycloakCitizenIdentity } from './citizen-identity';
import { SignupController } from './signup.controller';
import { SignupRepository } from './signup.repository';
import { SignupService } from './signup.service';
import { SIGNUP_STORE, ValkeySignupStore } from './signup.store';

// Inscription des citoyens par leur numéro de téléphone (lot D : US-014, §2.25)
@Module({
  imports: [AuthModule],
  controllers: [SignupController],
  providers: [
    SignupRepository,
    SignupService,
    { provide: SIGNUP_STORE, inject: [VALKEY], useFactory: (v: Redis) => new ValkeySignupStore(v) },
    {
      provide: CITIZEN_IDENTITY,
      inject: [ENV],
      useFactory: (env: Env) => new KeycloakCitizenIdentity(env),
    },
  ],
})
export class SignupModule {}
