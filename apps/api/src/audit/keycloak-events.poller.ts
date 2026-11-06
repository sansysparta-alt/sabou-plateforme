import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { AUDIT_LOG, type AuditLog } from './audit.log';
import { KEYCLOAK_EVENTS, type KeycloakEventSource } from './keycloak-events';

// Recouvrement avec la relève précédente : un événement écrit dans Keycloak pendant la
// relève n'est pas perdu ; le doublon est écarté par son identifiant.
export const OVERLAP_MS = 60_000;

// Relève périodique des événements de connexion de Keycloak (échecs, blocages, double
// facteur) vers le journal d'audit (US-030, R-ACC-05). Keycloak les garde 90 jours :
// une panne de l'API plus courte ne fait perdre aucun événement.
@Injectable()
export class KeycloakEventsPoller implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Audit');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(KEYCLOAK_EVENTS) private readonly source: KeycloakEventSource,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.AUDIT_POLL_SECONDS === 0) return;
    this.timer = setInterval(() => void this.poll(), this.env.AUDIT_POLL_SECONDS * 1000);
    // N'empêche pas le processus de s'arrêter
    this.timer.unref();
    void this.poll();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  // Une seule relève à la fois ; une erreur est journalisée et la relève suivante reprend
  poll(): Promise<number> {
    this.running ??= this.pollOnce()
      .catch((error: unknown) => {
        this.logger.warn(`Relève des événements Keycloak impossible : ${(error as Error).message}`);
        return 0;
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async pollOnce(): Promise<number> {
    const last = await this.audit.lastKeycloakEventTime();
    const events = await this.source.since(last === null ? null : last - OVERLAP_MS);
    const added = await this.audit.importKeycloakEvents(events);
    if (added > 0) this.logger.log(`${added} événement(s) Keycloak versé(s) au journal d'audit`);
    return added;
  }
}
