import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { DashboardEvent, DashboardSummary } from '@sabou/types';
import { DATABASE, type Database } from '../database/database';
import { inZone } from '../database/zone';

// Nombre de transitions affichées dans « Activité récente »
export const RECENT_ACTIVITY = 5;

// Chiffres du tableau de bord (US-016). Praticiens, dossiers et historique sont filtrés par
// les règles RLS de la base, dans le contexte ouvert par inZone. Les comptes ne sont pas
// cloisonnés par RLS : leur zone est appliquée ici, d'après le compte lu en base.
@Injectable()
export class DashboardRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  summary(sub: string): Promise<DashboardSummary> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<Omit<DashboardSummary, 'activite'>>`
        WITH moi AS (
          SELECT u.role_code, u.region_admin_id, u.prefecture_id,
                 coalesce(p.nom, r.nom, 'National') AS zone
            FROM sabou.utilisateur u
            LEFT JOIN sabou.prefecture p   ON p.id = u.prefecture_id
            LEFT JOIN sabou.region_admin r ON r.id = u.region_admin_id
           WHERE u.id = current_setting('sabou.utilisateur_id')::bigint)
        SELECT moi.zone,
               (SELECT count(*)::int FROM sabou.praticien) AS praticiens,
               (SELECT count(*)::int FROM sabou.dossier_certification
                 WHERE statut = 'en_cours' AND etape_courante >= 2) AS "dossiersSoumis",
               (SELECT count(*)::int
                  FROM sabou.utilisateur a
                  LEFT JOIN sabou.prefecture ap ON ap.id = a.prefecture_id
                 WHERE a.statut = 'actif'
                   AND a.role_code IN ('dg', 'regional', 'prefectoral', 'scientifique')
                   AND (moi.region_admin_id IS NULL AND moi.prefecture_id IS NULL
                        OR moi.prefecture_id IS NOT NULL AND a.prefecture_id = moi.prefecture_id
                        OR moi.prefecture_id IS NULL
                           AND (a.region_admin_id = moi.region_admin_id
                                OR ap.region_admin_id = moi.region_admin_id))) AS comptes,
               (SELECT count(*)::int FROM sabou.specialite) AS specialites
          FROM moi`.execute(trx);
      const { rows: activite } = await sql<DashboardEvent>`
        SELECT d.code AS dossier, u.prenom || ' ' || u.nom AS "praticienNom", h.decision,
               h.etape_arrivee::int AS etape,
               to_char(h.decide_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS le
          FROM sabou.dossier_historique h
          JOIN sabou.dossier_certification d ON d.id = h.dossier_id
          JOIN sabou.praticien p             ON p.id = d.praticien_id
          JOIN sabou.utilisateur u           ON u.id = p.utilisateur_id
         ORDER BY h.decide_le DESC, h.id DESC
         LIMIT ${RECENT_ACTIVITY}`.execute(trx);
      return { ...rows[0]!, activite };
    });
  }
}
