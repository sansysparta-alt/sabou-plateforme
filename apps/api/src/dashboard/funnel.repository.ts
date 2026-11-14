import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { BlockedDossier, CertificationFunnel, FunnelStep } from '@sabou/types';
import { DATABASE, type Database } from '../database/database';
import { inZone } from '../database/zone';

// Dossiers bloqués détaillés à l'écran ; au-delà, le total suffit à alerter
export const BLOCKED_LIMIT = 100;

// Entonnoir des 6 étapes et dossiers bloqués (US-048). Calculs dans la base
// (certification_entonnoir, certification_dossiers_bloques), aux droits de l'appelant :
// le cloisonnement par zone s'applique dans le contexte ouvert par inZone.
@Injectable()
export class FunnelRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  funnel(sub: string): Promise<CertificationFunnel> {
    return inZone(this.db, sub, async (trx) => {
      const { rows: etapes } = await sql<FunnelStep>`
        SELECT etape, en_cours AS "enCours", bloques, passages,
               delai_moyen_jours::float AS "delaiMoyenJours"
          FROM sabou.certification_entonnoir()`.execute(trx);
      const { rows } = await sql<BlockedDossier & { total: number }>`
        SELECT dossier, praticien, nom, etape, prefecture, region, jours,
               to_char(depuis AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS depuis,
               count(*) OVER ()::int AS total
          FROM sabou.certification_dossiers_bloques()
         LIMIT ${BLOCKED_LIMIT}`.execute(trx);
      return {
        delaiCibleJours: 3,
        seuilBlocageJours: 15,
        etapes,
        bloques: {
          total: rows[0]?.total ?? 0,
          dossiers: rows.map(({ total: _total, ...dossier }) => dossier),
        },
      };
    });
  }
}
