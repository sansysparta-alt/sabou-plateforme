import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AccountsRepository } from '../accounts/accounts.repository';
import { ENV, type Env } from '../config/env';
import { KeycloakServiceAccount } from '../keycloak/service-account';
import {
  AuthController,
  CITIZEN_IDENTITY_PROVIDER,
  CitizenAuthController,
  LOGIN_RECORDER,
} from './auth.controller';
import {
  adminClient,
  citizenClient,
  IDENTITY_PROVIDER,
  KeycloakIdentityProvider,
} from './identity-provider';
import { SESSION_STORE, ValkeySessionStore } from './session.store';

export const VALKEY = Symbol('VALKEY');

// Connexion des utilisateurs par Keycloak, sessions dans Valkey (US-010) : administration
// (domaine « sabou ») et citoyens du site public (domaine « sabou-public », lot D)
@Module({
  controllers: [AuthController, CitizenAuthController],
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
      // Compte de service « sabou-comptes » (view-users) : vérifie qu'un second facteur
      // configuré pendant la connexion a bien été enregistré, sans redemander le code
      useFactory: (env: Env) =>
        new KeycloakIdentityProvider(
          env,
          adminClient(env),
          new KeycloakServiceAccount(env, env.COMPTES_CLIENT_ID, env.COMPTES_CLIENT_SECRET),
        ),
    },
    {
      provide: CITIZEN_IDENTITY_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env) => new KeycloakIdentityProvider(env, citizenClient(env)),
    },
    // Lien entre la connexion et l'utilisateur de la plateforme (lot A)
    { provide: LOGIN_RECORDER, useClass: AccountsRepository },
  ],
  exports: [SESSION_STORE, VALKEY],
})
export class AuthModule implements OnApplicationShutdown {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  onApplicationShutdown(): void {
    this.valkey.disconnect();
  }
}
