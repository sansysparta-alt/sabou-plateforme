import { z } from 'zod';
import type { Env } from '../config/env';

export const KEYCLOAK_EVENTS = Symbol('KEYCLOAK_EVENTS');

// Événement de connexion tel que l'API d'administration de Keycloak le renvoie
const eventSchema = z.object({
  id: z.string().min(1).optional(),
  time: z.number().int().nonnegative(),
  type: z.string().regex(/^[A-Z_]{1,64}$/),
  clientId: z.string().optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  ipAddress: z.string().optional(),
  error: z.string().optional(),
  details: z.record(z.string(), z.string()).optional(),
});
export type KeycloakEvent = z.infer<typeof eventSchema>;

export interface KeycloakEventSource {
  // Tous les événements survenus depuis « since » (millisecondes, inclus)
  since(since: number | null): Promise<KeycloakEvent[]>;
}

const PAGE_SIZE = 100;
// Garde-fou : au-delà, la relève suivante reprend où celle-ci s'est arrêtée
const MAX_PAGES = 50;

// Lecture des événements par le compte de service « sabou-audit » (rôle view-events,
// lecture seule), distinct du client de connexion des utilisateurs.
export class KeycloakAdminEventSource implements KeycloakEventSource {
  private readonly base: URL;
  private readonly realm: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly env: Env) {
    const issuer = new URL(env.KEYCLOAK_ISSUER);
    // Échanges de serveur à serveur par l'adresse interne quand elle existe (réseau Docker)
    this.base = new URL(env.KEYCLOAK_INTERNAL_URL ?? issuer.origin);
    const match = /\/realms\/([^/]+)\/?$/.exec(issuer.pathname);
    if (!match) throw new Error('KEYCLOAK_ISSUER : domaine introuvable');
    this.realm = match[1]!;
  }

  async since(since: number | null): Promise<KeycloakEvent[]> {
    const events: KeycloakEvent[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(`/admin/realms/${this.realm}/events`, this.base);
      if (since !== null) url.searchParams.set('dateFrom', String(since));
      url.searchParams.set('direction', 'asc');
      url.searchParams.set('first', String(page * PAGE_SIZE));
      url.searchParams.set('max', String(PAGE_SIZE));
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${await this.accessToken()}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 401) this.token = null;
      if (!response.ok) throw new Error(`événements Keycloak : HTTP ${response.status}`);
      const batch = z.array(eventSchema).parse(await response.json());
      events.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return events;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const credentials = Buffer.from(
      `${encodeURIComponent(this.env.AUDIT_CLIENT_ID)}:${encodeURIComponent(this.env.AUDIT_CLIENT_SECRET)}`,
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
