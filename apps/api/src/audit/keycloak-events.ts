import { z } from 'zod';
import type { Env } from '../config/env';
import { KeycloakAdminError, KeycloakServiceAccount } from '../keycloak/service-account';

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
  private readonly client: KeycloakServiceAccount;

  constructor(env: Env) {
    this.client = new KeycloakServiceAccount(env, env.AUDIT_CLIENT_ID, env.AUDIT_CLIENT_SECRET);
  }

  async since(since: number | null): Promise<KeycloakEvent[]> {
    const events: KeycloakEvent[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const query: Record<string, string> = {
        direction: 'asc',
        first: String(page * PAGE_SIZE),
        max: String(PAGE_SIZE),
      };
      if (since !== null) query.dateFrom = String(since);
      let response: Response;
      try {
        response = await this.client.request('/events', { query });
      } catch (error) {
        if (error instanceof KeycloakAdminError) {
          throw new Error(`événements Keycloak : HTTP ${error.status}`, { cause: error });
        }
        throw error;
      }
      const batch = z.array(eventSchema).parse(await response.json());
      events.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return events;
  }
}
