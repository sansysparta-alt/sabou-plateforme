import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DATABASE, type Database } from '../database/database';
import type { KeycloakEvent } from './keycloak-events';

export const AUDIT_LOG = Symbol('AUDIT_LOG');

// Origine des événements de connexion relevés : domaine Keycloak des administrateurs
// (« sabou ») ou des citoyens (« sabou-public », lot D). Chacune a son point de reprise.
export type KeycloakAuditSource = 'keycloak' | 'keycloak-public';

// Une ligne du journal d'audit (R-DON-02, R-ACC-05). L'heure est celle de la base.
export interface AuditEntry {
  // Ce qui s'est passé, ex. « connexion.reussie »
  action: string;
  objectType: string;
  objectId?: string;
  // Identifiant du compte dans Keycloak (claim « sub »)
  account?: string;
  userId?: number;
  ip?: string;
  details?: Record<string, unknown>;
}

export interface AuditLog {
  // Écrit la ligne, dans la transaction de la décision quand elle est donnée
  record(entry: AuditEntry, trx?: Transaction<never>): Promise<void>;
  // Transaction d'une décision : les fonctions de workflow y écrivent leur ligne d'audit,
  // qui reçoit l'IP de la requête ; décision et ligne sont confirmées ou annulées ensemble.
  decide<T>(ip: string | undefined, work: (trx: Transaction<never>) => Promise<T>): Promise<T>;
  // Heure du dernier événement versé depuis ce domaine (millisecondes), point de reprise
  lastKeycloakEventTime(source: KeycloakAuditSource): Promise<number | null>;
  // Verse les événements ; un événement déjà versé est ignoré. Renvoie le nombre de lignes ajoutées.
  importKeycloakEvents(events: KeycloakEvent[], source: KeycloakAuditSource): Promise<number>;
}

// Une adresse mal formée ne doit jamais faire échouer l'écriture (ni bloquer une connexion)
export function normalizeIp(ip: string | undefined): string | null {
  if (!ip) return null;
  const plain = ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  return isIP(plain) ? plain : null;
}

// Champs libres venus de l'extérieur (identifiant saisi…) : longueur bornée
const clip = (value: string | undefined) => (value === undefined ? undefined : value.slice(0, 255));

export function keycloakEventRow(event: KeycloakEvent) {
  return {
    // Keycloak 26 donne un identifiant ; à défaut, l'empreinte de l'événement en tient lieu
    ref: event.id ?? createHash('sha256').update(JSON.stringify(event)).digest('hex'),
    occurred_at: new Date(event.time).toISOString(),
    action: `keycloak.${event.type.toLowerCase()}`,
    account: clip(event.userId),
    ip: normalizeIp(event.ipAddress),
    details: {
      client: clip(event.clientId),
      erreur: clip(event.error),
      // Identifiant saisi sur la page de connexion, y compris pour un compte inexistant
      identifiant: clip(event.details?.username),
      session: clip(event.sessionId),
    },
  };
}

@Injectable()
export class PgAuditLog implements AuditLog {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(entry: AuditEntry, trx?: Transaction<never>): Promise<void> {
    await sql`
      INSERT INTO sabou.journal_audit
        (utilisateur_id, compte, action, objet_type, objet_id, details, ip)
      VALUES (${entry.userId ?? null}, ${entry.account ?? null}, ${entry.action},
              ${entry.objectType}, ${entry.objectId ?? null},
              ${JSON.stringify(entry.details ?? {})}::jsonb, ${normalizeIp(entry.ip)}::inet)
    `.execute(trx ?? this.db);
  }

  async decide<T>(
    ip: string | undefined,
    work: (trx: Transaction<never>) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      return work(trx as unknown as Transaction<never>);
    });
  }

  async lastKeycloakEventTime(source: KeycloakAuditSource): Promise<number | null> {
    const { rows } = await sql<{ last: Date | null }>`
      SELECT max(survenu_le) AS last FROM sabou.journal_audit WHERE source = ${source}
    `.execute(this.db);
    return rows[0]?.last ? rows[0].last.getTime() : null;
  }

  async importKeycloakEvents(
    events: KeycloakEvent[],
    source: KeycloakAuditSource,
  ): Promise<number> {
    if (events.length === 0) return 0;
    // Ordre chronologique, une seule transaction : le point de reprise n'avance jamais
    // au-delà d'un événement qui n'aurait pas été versé
    const rows = [...events].sort((a, b) => a.time - b.time).map(keycloakEventRow);
    const { rows: inserted } = await sql<{ n: number }>`
      WITH ajout AS (
        INSERT INTO sabou.journal_audit
          (source, ref_externe, survenu_le, action, objet_type, objet_id, compte, ip, details)
        SELECT ${source}, e.ref, e.occurred_at, e.action, 'compte', e.account, e.account,
               e.ip, e.details
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
            AS e(ref text, occurred_at timestamptz, action text, account text, ip inet, details jsonb)
         ORDER BY e.occurred_at
        ON CONFLICT (source, ref_externe) WHERE ref_externe IS NOT NULL DO NOTHING
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM ajout
    `.execute(this.db);
    return inserted[0]?.n ?? 0;
  }
}
