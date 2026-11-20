import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  AdminIndicators,
  DashboardEvent,
  DashboardSummary,
  PractitionerDashboard,
  SmsFailure,
} from '@sabou/types';
import { DATABASE, type Database } from '../database/database';
import { inZone, ZoneContextError, type ZoneTrx } from '../database/zone';

// Nombre de transitions affichées dans « Activité récente »
export const RECENT_ACTIVITY = 5;
// Nombre de SMS non remis détaillés (le total est toujours donné)
export const RECENT_SMS_FAILURES = 5;

// Chiffres du tableau de bord (US-016, US-090). Indicateurs, praticiens et historique sont
// filtrés par les règles RLS de la base, dans le contexte ouvert par inZone.
@Injectable()
export class DashboardRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  summary(sub: string): Promise<DashboardSummary> {
    return inZone(this.db, sub, async (trx) => {
      // Indicateurs du profil (US-090) : fonction SQL soumise aux règles RLS de la zone
      const { rows } = await sql<{
        zone: string;
        dg: boolean;
        praticiens: number;
        indicateurs: AdminIndicators;
      }>`
        SELECT coalesce(p.nom, r.nom, 'National') AS zone, u.role_code = 'dg' AS dg,
               (SELECT count(*)::int FROM sabou.praticien) AS praticiens,
               sabou.tableau_de_bord() AS indicateurs
          FROM sabou.utilisateur u
          LEFT JOIN sabou.prefecture p   ON p.id = u.prefecture_id
          LEFT JOIN sabou.region_admin r ON r.id = u.region_admin_id
         WHERE u.id = current_setting('sabou.utilisateur_id')::bigint`.execute(trx);
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
      const { dg, ...summary } = rows[0]!;
      return { ...summary, activite, smsNonRemis: dg ? await this.smsFailures(trx) : null };
    });
  }

  // Tableau de bord du praticien (US-090, §6.6), lu par l'application mobile : ses
  // traitements, la frise de son dernier dossier, son certificat (règles RLS du praticien)
  practitioner(sub: string): Promise<PractitionerDashboard> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<{ t: PractitionerDashboard }>`
        SELECT sabou.tableau_de_bord() AS t`.execute(trx);
      const board = rows[0]!.t;
      // Garde-fou : un compte d'un autre profil n'a rien à lire ici
      if (board.profil !== 'praticien') throw new ZoneContextError();
      return board;
    });
  }

  // SMS non remis (US-031, décision du maître d'œuvre du 12 novembre 2026) : la file n'est
  // pas cloisonnée par zone, elle n'est lue que pour la DG (niveau national)
  private async smsFailures(trx: ZoneTrx): Promise<NonNullable<DashboardSummary['smsNonRemis']>> {
    const { rows } = await sql<SmsFailure & { total: number }>`
      SELECT n.objet_id AS objet, u.prenom || ' ' || u.nom AS destinataire,
             coalesce(n.derniere_erreur, 'Erreur inconnue') AS raison,
             to_char(n.echouee_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS le,
             count(*) OVER ()::int AS total
        FROM sabou.notification n
        JOIN sabou.utilisateur u ON u.id = n.destinataire_id
       WHERE n.statut = 'echec' AND n.canal = 'sms'
       ORDER BY n.echouee_le DESC, n.id DESC
       LIMIT ${RECENT_SMS_FAILURES}`.execute(trx);
    return {
      total: rows[0]?.total ?? 0,
      derniers: rows.map(({ objet, destinataire, raison, le }) => ({
        objet,
        destinataire,
        raison,
        le,
      })),
    };
  }
}
