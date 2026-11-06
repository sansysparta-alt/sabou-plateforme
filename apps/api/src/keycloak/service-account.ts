import { z } from 'zod';
import type { Env } from '../config/env';

// Erreur HTTP de l'API d'administration de Keycloak : le statut sert aux appelants
// (409 : compte déjà existant ; 400 : mot de passe refusé par les règles du domaine)
export class KeycloakAdminError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Keycloak ${path} : HTTP ${status}`);
    this.name = 'KeycloakAdminError';
  }
}

// Appels de l'API d'administration de Keycloak par un compte de service (client
// credentials). Un client par usage, avec ses seuls droits : « sabou-audit » (view-events),
// « sabou-comptes » (manage-users, view-users).
export class KeycloakServiceAccount {
  private readonly base: URL;
  readonly realm: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    env: Pick<Env, 'KEYCLOAK_ISSUER' | 'KEYCLOAK_INTERNAL_URL'>,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {
    const issuer = new URL(env.KEYCLOAK_ISSUER);
    // Échanges de serveur à serveur par l'adresse interne quand elle existe (réseau Docker)
    this.base = new URL(env.KEYCLOAK_INTERNAL_URL ?? issuer.origin);
    const match = /\/realms\/([^/]+)\/?$/.exec(issuer.pathname);
    if (!match) throw new Error('KEYCLOAK_ISSUER : domaine introuvable');
    this.realm = match[1]!;
  }

  // Requête vers /admin/realms/<domaine><path> ; renvoie la réponse si elle est réussie
  async request(
    path: string,
    init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
  ): Promise<Response> {
    const url = new URL(`/admin/realms/${this.realm}${path}`, this.base);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(10_000),
    });
    // Jeton révoqué ou expiré plus tôt que prévu : un nouveau sera demandé à l'appel suivant
    if (response.status === 401) this.token = null;
    if (!response.ok) {
      // Message d'erreur de Keycloak borné : il ne contient jamais le mot de passe envoyé
      const body = (await response.text()).slice(0, 500);
      throw new KeycloakAdminError(response.status, path, body);
    }
    return response;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const credentials = Buffer.from(
      `${encodeURIComponent(this.clientId)}:${encodeURIComponent(this.clientSecret)}`,
    ).toString('base64');
    const response = await fetch(
      new URL(`/realms/${this.realm}/protocol/openid-connect/token`, this.base),
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${credentials}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`jeton du compte de service : HTTP ${response.status}`);
    const body = z
      .object({ access_token: z.string().min(1), expires_in: z.number().int().positive() })
      .parse(await response.json());
    // Renouvelé 30 secondes avant son expiration
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(body.expires_in - 30, 0) * 1000,
    };
    return this.token.value;
  }
}
