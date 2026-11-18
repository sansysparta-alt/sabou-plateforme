import { z } from 'zod';
import { KeycloakServiceAccount } from '../keycloak/service-account';
import * as oidc from 'openid-client';
import type { Env } from '../config/env';
import type { LoginTransaction } from './session.store';

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

export interface IdentityClaims {
  sub: string;
  username: string;
  name: string;
  roles: string[];
  // Méthodes d'authentification utilisées (RFC 8176) : « pwd », « otp »…
  amr: string[];
}

export type LoginAction = 'configure-totp' | 'step-up';

export interface IdentityProvider {
  // Ouvre une connexion : PKCE, state et nonce tirés au hasard
  // loginHint : identifiant pré-rempli sur la page de connexion (citoyen après inscription)
  // « step-up » : niveau 2 seul, sur la session Keycloak qui vient d'activer le second facteur
  startLogin(
    returnTo: string,
    action?: LoginAction,
    loginHint?: string,
  ): Promise<{ url: string; tx: LoginTransaction }>;
  // Échange le code reçu sur /auth/callback ; le jeton d'identité est vérifié (signature,
  // émetteur, audience, nonce, expiration) par openid-client
  finishLogin(
    callbackUrl: URL,
    tx: LoginTransaction,
  ): Promise<{ claims: IdentityClaims; refreshToken: string }>;
  // Ferme la session Keycloak (déconnexion côté serveur, sans passer par le navigateur)
  logout(refreshToken: string): Promise<void>;
  // Code à usage unique enregistré depuis `since` (ms) : Keycloak ne l'enregistre qu'après la
  // saisie d'un code valide, le second facteur a donc été prouvé pendant cette connexion.
  // Absent : pas de vérification possible (la relance de niveau 2 s'applique).
  otpConfiguredSince?(sub: string, since: number): Promise<boolean>;
}

const credentialsSchema = z.array(z.object({ type: z.string(), createdDate: z.number() }).loose());

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

// Client OIDC d'un espace : « sabou-admin » (domaine sabou) ou « sabou-site » (sabou-public)
export interface OidcClient {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export const adminClient = (env: Env): OidcClient => ({
  issuer: env.KEYCLOAK_ISSUER,
  clientId: env.ADMIN_CLIENT_ID,
  clientSecret: env.ADMIN_CLIENT_SECRET,
  redirectUri: new URL('/auth/callback', env.ADMIN_APP_URL).href,
});

export const citizenClient = (env: Env): OidcClient => ({
  issuer: env.PUBLIC_KEYCLOAK_ISSUER,
  clientId: env.SITE_CLIENT_ID,
  clientSecret: env.SITE_CLIENT_SECRET,
  redirectUri: new URL('/auth/citoyen/callback', env.SITE_URL).href,
});

export class KeycloakIdentityProvider implements IdentityProvider {
  private config?: Promise<oidc.Configuration>;
  private readonly redirectUri: string;

  constructor(
    private readonly env: Env,
    private readonly client: OidcClient,
    // Compte de service qui lit les comptes (view-users) : administration seulement
    private readonly users?: KeycloakServiceAccount,
  ) {
    this.redirectUri = client.redirectUri;
    if (!users) this.otpConfiguredSince = undefined;
  }

  // Écart d'horloge toléré entre l'API et Keycloak
  private static readonly CLOCK_SKEW_MS = 5_000;

  otpConfiguredSince? = async (sub: string, since: number): Promise<boolean> => {
    if (!/^[0-9a-f-]{36}$/.test(sub)) return false;
    const response = await this.users!.request(`/users/${sub}/credentials`);
    const credentials = credentialsSchema.parse(await response.json());
    return credentials.some(
      (c) => c.type === 'otp' && c.createdDate >= since - KeycloakIdentityProvider.CLOCK_SKEW_MS,
    );
  };

  // Découverte paresseuse : l'API démarre même si Keycloak n'est pas encore prêt ;
  // un échec n'est pas mis en cache, la tentative suivante recommence.
  private configuration(): Promise<oidc.Configuration> {
    this.config ??= this.discover().catch((error: unknown) => {
      this.config = undefined;
      throw error;
    });
    return this.config;
  }

  private async discover(): Promise<oidc.Configuration> {
    const { env, client } = this;
    const issuer = new URL(client.issuer);
    const internal = env.KEYCLOAK_INTERNAL_URL ? new URL(env.KEYCLOAK_INTERNAL_URL) : undefined;
    // Les échanges de serveur à serveur passent par l'adresse interne (réseau Docker) ;
    // l'émetteur attendu dans les jetons reste l'adresse publique.
    const fetchViaInternal: oidc.CustomFetch = (url, options) => {
      const target = new URL(url);
      if (internal && target.origin === issuer.origin) {
        target.protocol = internal.protocol;
        target.host = internal.host;
      }
      return fetch(target, options as RequestInit);
    };
    const config = await oidc.discovery(
      issuer,
      client.clientId,
      undefined,
      oidc.ClientSecretBasic(client.clientSecret),
      {
        [oidc.customFetch]: fetchViaInternal,
        execute: env.KEYCLOAK_ALLOW_HTTP ? [oidc.allowInsecureRequests] : [],
        timeout: 10,
      },
    );
    config[oidc.customFetch] = fetchViaInternal;
    return config;
  }

  async startLogin(
    returnTo: string,
    action?: LoginAction,
    loginHint?: string,
  ): Promise<{ url: string; tx: LoginTransaction }> {
    const config = await this.configuration();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const tx: LoginTransaction = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      codeVerifier,
      returnTo,
      startedAt: Date.now(),
    };
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.redirectUri,
      scope: 'openid',
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state: tx.state,
      nonce: tx.nonce,
      // Identification demandée à chaque connexion, sans reprise d'une session Keycloak
      // antérieure : le claim « amr » décrit toujours les facteurs réellement saisis, et
      // l'activation du double facteur exige de retaper le mot de passe.
      // Exception, la relance de niveau 2 (§2.28) : elle reprend la session ouverte à
      // l'instant même par le mot de passe (niveau 1 valable 10 minutes) ; Keycloak ne demande
      // que le second facteur, qu'il exige toujours, quel que soit le niveau demandé.
      ...(action === 'step-up' ? { acr_values: '2' } : { prompt: 'login' }),
      // Action demandée par l'application (« activer le double facteur »)
      ...(action === 'configure-totp' ? { kc_action: 'CONFIGURE_TOTP' } : {}),
      ...(loginHint ? { login_hint: loginHint } : {}),
    });
    return { url: url.href, tx };
  }

  async finishLogin(
    callbackUrl: URL,
    tx: LoginTransaction,
  ): Promise<{ claims: IdentityClaims; refreshToken: string }> {
    const config = await this.configuration();
    const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: tx.codeVerifier,
      expectedState: tx.state,
      expectedNonce: tx.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims || !tokens.refresh_token) throw new Error('Réponse de Keycloak incomplète');
    const username = typeof claims.preferred_username === 'string' ? claims.preferred_username : '';
    return {
      claims: {
        sub: claims.sub,
        username,
        name: typeof claims.name === 'string' && claims.name ? claims.name : username,
        roles: stringArray(claims.roles),
        amr: stringArray(claims.amr),
      },
      refreshToken: tokens.refresh_token,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const config = await this.configuration();
    const endpoint = config.serverMetadata().end_session_endpoint;
    if (!endpoint) throw new Error('Keycloak ne publie pas de point de déconnexion');
    const response = await config[oidc.customFetch]!(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(
          `${encodeURIComponent(this.client.clientId)}:${encodeURIComponent(this.client.clientSecret)}`,
        ).toString('base64')}`,
      },
      body: new URLSearchParams({ refresh_token: refreshToken }).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    } as oidc.CustomFetchOptions);
    // 204 attendu ; 400 si la session était déjà close à Keycloak (expirée, suspendue)
    if (response.status !== 204 && response.status !== 400) {
      throw new Error(`Déconnexion Keycloak : statut ${response.status}`);
    }
  }
}
