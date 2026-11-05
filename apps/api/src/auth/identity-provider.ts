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

export interface IdentityProvider {
  // Ouvre une connexion : PKCE, state et nonce tirés au hasard
  startLogin(
    returnTo: string,
    action?: 'configure-totp',
  ): Promise<{ url: string; tx: LoginTransaction }>;
  // Échange le code reçu sur /auth/callback ; le jeton d'identité est vérifié (signature,
  // émetteur, audience, nonce, expiration) par openid-client
  finishLogin(
    callbackUrl: URL,
    tx: LoginTransaction,
  ): Promise<{ claims: IdentityClaims; refreshToken: string }>;
  // Ferme la session Keycloak (déconnexion côté serveur, sans passer par le navigateur)
  logout(refreshToken: string): Promise<void>;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export class KeycloakIdentityProvider implements IdentityProvider {
  private config?: Promise<oidc.Configuration>;
  private readonly redirectUri: string;

  constructor(private readonly env: Env) {
    this.redirectUri = new URL('/auth/callback', env.ADMIN_APP_URL).href;
  }

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
    const { env } = this;
    const issuer = new URL(env.KEYCLOAK_ISSUER);
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
      env.ADMIN_CLIENT_ID,
      undefined,
      oidc.ClientSecretBasic(env.ADMIN_CLIENT_SECRET),
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
    action?: 'configure-totp',
  ): Promise<{ url: string; tx: LoginTransaction }> {
    const config = await this.configuration();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const tx: LoginTransaction = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      codeVerifier,
      returnTo,
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
      prompt: 'login',
      // Action demandée par l'application (« activer le double facteur »)
      ...(action === 'configure-totp' ? { kc_action: 'CONFIGURE_TOTP' } : {}),
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
          `${encodeURIComponent(this.env.ADMIN_CLIENT_ID)}:${encodeURIComponent(this.env.ADMIN_CLIENT_SECRET)}`,
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
