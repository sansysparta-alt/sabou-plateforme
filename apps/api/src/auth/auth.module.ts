import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env';
import { AuthController } from './auth.controller';
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
  ],
})
export class AuthModule implements OnApplicationShutdown {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  onApplicationShutdown(): void {
    this.valkey.disconnect();
  }
}
