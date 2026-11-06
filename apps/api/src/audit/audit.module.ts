import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { AUDIT_LOG, PgAuditLog } from './audit.log';
import { KEYCLOAK_EVENTS, KeycloakAdminEventSource } from './keycloak-events';
import { KeycloakEventsPoller } from './keycloak-events.poller';

// Journal d'audit des décisions et connexions (US-030), utilisable par tous les domaines
@Global()
@Module({
  providers: [
    { provide: AUDIT_LOG, useClass: PgAuditLog },
    {
      provide: KEYCLOAK_EVENTS,
      inject: [ENV],
      useFactory: (env: Env) => new KeycloakAdminEventSource(env),
    },
    KeycloakEventsPoller,
  ],
  exports: [AUDIT_LOG],
})
export class AuditModule {}
