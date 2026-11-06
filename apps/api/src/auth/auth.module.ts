import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AccountsRepository } from '../accounts/accounts.repository';
import { ENV, type Env } from '../config/env';
import { AuthController, LOGIN_RECORDER } from './auth.controller';
import { IDENTITY_PROVIDER, KeycloakIdentityProvider } from './identity-provider';
import { SESSION_STORE, ValkeySessionStore } from './session.store';

const VALKEY = Symbol('VALKEY');

// Connexion des utilisateurs par Keycloak, sessions dans Valkey (US-010)
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: VALKEY,
      inject: [ENV],
      // Connexion paresseuse : l'API démarre même si Valkey redémarre
      useFactory: (env: Env) =>
        new Redis(env.VALKEY_URL, { lazyConnect: true, maxRetriesPerRequest: 2 }),
    },
    {
      provide: SESSION_STORE,
      inject: [VALKEY],
      useFactory: (v: Redis) => new ValkeySessionStore(v),
    },
    {
      provide: IDENTITY_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env) => new KeycloakIdentityProvider(env),
    },
    // Lien entre la connexion et l'utilisateur de la plateforme (lot A)
    { provide: LOGIN_RECORDER, useClass: AccountsRepository },
  ],
  exports: [SESSION_STORE],
})
export class AuthModule implements OnApplicationShutdown {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  onApplicationShutdown(): void {
    this.valkey.disconnect();
  }
}
