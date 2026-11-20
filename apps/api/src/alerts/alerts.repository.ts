import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { AlertDeclareInput, AlertReferentials, TerritorialAlert } from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone, type ZoneTrx } from '../database/zone';

export class AlertNotFoundError extends Error {}
export class AlertNotAllowedError extends Error {}
// Alerte close, accusé déjà donné, relance de moins d'un jour : message dit tel quel
export class AlertRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Messages des fonctions alerte_* (migration 20261120030000) ; chaque branche est couverte
// par un test sur un vrai PostgreSQL (packages/db/test/alertes.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (/Alerte \d+ introuvable/.test(message)) throw new AlertNotFoundError();
  if (message.includes('réservée')) throw new AlertNotAllowedError();
  if (message.includes('close : aucune action')) {
    throw new AlertRefusedError('closed', 'Cette alerte est close.');
  }
  if (message.includes('déjà donné')) {
    throw new AlertRefusedError('acknowledged', 'L’accusé de réception est déjà donné.');
  }
  if (message.includes('moins d')) {
    throw new AlertRefusedError(
      'too_soon',
      'Cette alerte a déjà été relancée il y a moins d’un jour.',
    );
  }
  if (message.includes('préfecture inconnue') || message.includes('maladie inconnue')) {
    throw new AlertRefusedError('invalid', 'Préfecture ou maladie inconnue.');
  }
  throw error;
}

const STAMP = (column: string) =>
  sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

// Alertes territoriales (US-102). La base choisit les alertes visibles (RLS) et contrôle
// chaque action ; la détection automatique est appelée par la relève des SMS.
@Injectable()
export class AlertsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private act<T>(sub: string, ip: string | undefined, work: (trx: ZoneTrx) => Promise<T>) {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      try {
        return await work(trx);
      } catch (error) {
        translate(error);
      }
    });
  }

  // Alertes ouvertes de la zone : à traiter d'abord (nouvelles, relancées), puis les autres
  list(sub: string): Promise<TerritorialAlert[]> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<TerritorialAlert>`
        SELECT a.id::int, a.type, a.statut, ra.nom AS region, pf.nom AS prefecture,
               m.nom_fr AS maladie, d.code AS dossier, a.description,
               ${STAMP('a.created_at')} AS "creeLe", ${STAMP('a.accusee_le')} AS "accuseeLe",
               a.relances::int, ${STAMP('a.relancee_le')} AS "relanceeLe"
          FROM sabou.alerte_territoriale a
          JOIN sabou.region_admin ra ON ra.id = a.region_admin_id
          LEFT JOIN sabou.prefecture pf ON pf.id = a.prefecture_id
          LEFT JOIN sabou.maladie m ON m.id = a.maladie_id
          LEFT JOIN sabou.dossier_certification d ON d.id = a.dossier_id
         WHERE a.statut <> 'close'
         ORDER BY a.statut = 'accusee', a.created_at DESC, a.id DESC
         LIMIT 500`.execute(trx);
      return rows;
    });
  }

  referentials(sub: string): Promise<AlertReferentials> {
    return inZone(this.db, sub, async (trx) => {
      // Préfectures de la zone du compte (zone_visible), actives
      const { rows: prefectures } = await sql<{ id: number; nom: string }>`
        SELECT id::int, nom FROM sabou.prefecture
         WHERE active AND sabou.zone_visible(id) ORDER BY nom`.execute(trx);
      const { rows: maladies } = await sql<{ code: string; nomFr: string }>`
        SELECT code, nom_fr AS "nomFr" FROM sabou.maladie ORDER BY nom_fr`.execute(trx);
      return { prefectures, maladies };
    });
  }

  declare(sub: string, ip: string | undefined, input: AlertDeclareInput): Promise<{ id: number }> {
    return this.act(sub, ip, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        SELECT sabou.alerte_declarer(${input.prefectureId}::smallint, ${input.maladie},
                                     ${input.description})::int AS id`.execute(trx);
      return rows[0]!;
    });
  }

  acknowledge(sub: string, ip: string | undefined, id: number): Promise<void> {
    return this.act(sub, ip, async (trx) => {
      await sql`SELECT sabou.alerte_accuser(${id})`.execute(trx);
    });
  }

  // Renvoie le nombre de responsables prévenus
  relaunch(sub: string, ip: string | undefined, id: number): Promise<{ prevenus: number }> {
    return this.act(sub, ip, async (trx) => {
      const { rows } = await sql<{ prevenus: number }>`
        SELECT sabou.alerte_relancer(${id}) AS prevenus`.execute(trx);
      return rows[0]!;
    });
  }

  close(sub: string, ip: string | undefined, id: number, motif: string): Promise<void> {
    return this.act(sub, ip, async (trx) => {
      await sql`SELECT sabou.alerte_clore(${id}, ${motif})`.execute(trx);
    });
  }
}
