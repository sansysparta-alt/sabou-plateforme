import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  ExportEntry,
  ExportRequest,
  MonthlyReport,
  MonthlyReportList,
  MonthlyReportSummary,
} from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone, type ZoneTrx } from '../database/zone';
import { formatMonth, type DashboardSnapshot, type MonthlyReportSnapshot } from './document';

// Rapports mensuels et exports (US-091) : toutes les règles sont dans la base (fonctions
// rapport_mensuel_*, export_creer, règles RLS) ; ce dépôt les appelle et traduit leurs refus.

// Mois proposés à la rédaction : les 12 derniers mois écoulés
export const REPORT_MONTHS = 12;
// Lignes de l'historique des exports renvoyées (les plus récentes)
export const EXPORT_HISTORY_LIMIT = 100;

export class ReportNotFoundError extends Error {}
export class ReportNotAllowedError extends Error {}
export class ReportRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (/Rapport \d+ introuvable/.test(message)) throw new ReportNotFoundError();
  if (/réservée?|seul son auteur|Export : réservé/.test(message)) throw new ReportNotAllowedError();
  if (message.includes('mois écoulé')) {
    throw new ReportRefusedError('month', 'Seul un mois écoulé peut être rapporté.');
  }
  if (message.includes('ne peut plus être modifié')) {
    throw new ReportRefusedError('sent', 'Ce rapport est envoyé : il ne peut plus être modifié.');
  }
  if (message.includes('ont changé depuis votre lecture')) {
    throw new ReportRefusedError(
      'stale',
      'Les chiffres ont été recalculés depuis votre lecture : relisez le rapport avant de l’envoyer.',
    );
  }
  if (message.includes('seul un rapport envoyé')) {
    throw new ReportRefusedError('not_sent', 'Seul un rapport envoyé peut être renvoyé.');
  }
  if (message.includes('motif du renvoi')) {
    throw new ReportRefusedError('motif', 'Indiquez ce qui doit être revu.');
  }
  throw error;
}

const STAMP = (column: string) =>
  sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

// Colonnes du résumé d'un rapport (alias r)
const SUMMARY = sql.raw(`
  r.id::int, r.niveau, coalesce(pf.nom, ra.nom) AS zone, r.mois::text AS mois, r.version::int,
  r.statut, u.prenom || ' ' || u.nom AS auteur,
  to_char(r.envoye_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "envoyeLe",
  to_char(r.renvoye_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "renvoyeLe"`);
const FROM = sql.raw(`
  FROM sabou.rapport_mensuel r
  JOIN sabou.region_admin ra ON ra.id = r.region_admin_id
  LEFT JOIN sabou.prefecture pf ON pf.id = r.prefecture_id
  JOIN sabou.utilisateur u ON u.id = r.redige_par`);

// Liste blanche des champs exposés d'un rapport
const strip = (r: MonthlyReportSummary): MonthlyReportSummary => ({
  id: r.id,
  niveau: r.niveau,
  zone: r.zone,
  mois: r.mois,
  version: r.version,
  statut: r.statut,
  auteur: r.auteur,
  envoyeLe: r.envoyeLe,
  renvoyeLe: r.renvoyeLe,
});

export interface ExportFile {
  type: ExportRequest['type'];
  format: ExportRequest['format'];
  contenu: DashboardSnapshot | MonthlyReportSnapshot;
  auteur: string;
  le: string;
}

@Injectable()
export class ReportsRepository {
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

  list(sub: string): Promise<MonthlyReportList> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<MonthlyReportSummary & { mien: boolean }>`
        SELECT DISTINCT ON (r.niveau, r.region_admin_id, coalesce(r.prefecture_id, 0), r.mois)
               ${SUMMARY}, r.niveau = sabou.contexte_role() AS mien
          ${FROM}
         WHERE r.mois >= (date_trunc('month', now()) - interval '24 months')::date
         ORDER BY r.niveau, r.region_admin_id, coalesce(r.prefecture_id, 0), r.mois, r.version DESC`.execute(
        trx,
      );
      const { rows: meta } = await sql<{ redacteur: boolean; mois: string[] }>`
        SELECT sabou.contexte_role() IN ('prefectoral', 'regional') AS redacteur,
               array(SELECT (date_trunc('month', now() AT TIME ZONE 'Africa/Conakry')
                             - make_interval(months => n))::date::text
                       FROM generate_series(1, ${REPORT_MONTHS}) AS n ORDER BY n) AS mois`.execute(
        trx,
      );
      const recent = (a: MonthlyReportSummary, b: MonthlyReportSummary) =>
        b.mois.localeCompare(a.mois) || a.zone.localeCompare(b.zone, 'fr');
      return {
        miens: rows
          .filter((r) => r.mien)
          .map(strip)
          .sort(recent),
        recus: rows
          .filter((r) => !r.mien)
          .map(strip)
          .sort(recent),
        peutRediger: meta[0]!.redacteur,
        moisPossibles: meta[0]!.redacteur ? meta[0]!.mois : [],
      };
    });
  }

  detail(sub: string, id: number): Promise<MonthlyReport> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<
        Omit<MonthlyReport, 'versions'> & { cle: { r: number; p: number; n: string; m: string } }
      >`
        SELECT ${SUMMARY}, r.contenu, r.commentaire, ${STAMP('r.calcule_le')} AS "calculeLe",
               r.renvoi_motif AS "renvoiMotif",
               r.statut = 'brouillon' AND r.niveau = sabou.contexte_role() AS "peutModifier",
               r.statut = 'envoye' AND ((r.niveau = 'prefectoral' AND sabou.contexte_role() = 'regional')
                                        OR (r.niveau = 'regional' AND sabou.contexte_role() = 'dg')) AS "peutRenvoyer",
               jsonb_build_object('r', r.region_admin_id, 'p', coalesce(r.prefecture_id, 0),
                                  'n', r.niveau, 'm', r.mois) AS cle
          ${FROM}
         WHERE r.id = ${id}`.execute(trx);
      const report = rows[0];
      if (!report) throw new ReportNotFoundError();
      const { rows: versions } = await sql<MonthlyReport['versions'][number]>`
        SELECT r.id::int, r.version::int, r.renvoi_motif AS "renvoiMotif",
               ${STAMP('r.renvoye_le')} AS "renvoyeLe"
          FROM sabou.rapport_mensuel r
         WHERE r.region_admin_id = ${report.cle.r} AND coalesce(r.prefecture_id, 0) = ${report.cle.p}
           AND r.niveau = ${report.cle.n} AND r.mois = ${report.cle.m}::date AND r.id <> ${id}
         ORDER BY r.version DESC`.execute(trx);
      // Liste blanche : la clé de recherche des versions reste interne
      return {
        ...strip(report),
        contenu: report.contenu,
        commentaire: report.commentaire,
        calculeLe: report.calculeLe,
        renvoiMotif: report.renvoiMotif,
        peutModifier: report.peutModifier,
        peutRenvoyer: report.peutRenvoyer,
        versions,
      };
    });
  }

  prepare(sub: string, ip: string | undefined, mois: string): Promise<{ id: number }> {
    return this.act(sub, ip, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        SELECT sabou.rapport_mensuel_preparer(${mois}::date)::int AS id`.execute(trx);
      return rows[0]!;
    });
  }

  comment(sub: string, ip: string | undefined, id: number, text: string): Promise<void> {
    return this.act(sub, ip, async (trx) => {
      await sql`SELECT sabou.rapport_mensuel_commenter(${id}, ${text})`.execute(trx);
    });
  }

  send(sub: string, ip: string | undefined, id: number, computedAt: string): Promise<void> {
    return this.act(sub, ip, async (trx) => {
      await sql`SELECT sabou.rapport_mensuel_envoyer(${id}, ${computedAt}::timestamptz)`.execute(
        trx,
      );
    });
  }

  giveBack(sub: string, ip: string | undefined, id: number, motif: string): Promise<void> {
    return this.act(sub, ip, async (trx) => {
      await sql`SELECT sabou.rapport_mensuel_renvoyer(${id}, ${motif})`.execute(trx);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------------------------------
  history(sub: string): Promise<ExportEntry[]> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<
        Omit<ExportEntry, 'objet'> & { zone: string; mois: string | null }
      >`
        SELECT e.id::int, e.type, e.format, e.contenu ->> 'zone' AS zone, e.contenu ->> 'mois' AS mois,
               u.prenom || ' ' || u.nom AS auteur, ${STAMP('e.created_at')} AS le
          FROM sabou.rapport_export e
          JOIN sabou.utilisateur u ON u.id = e.demande_par
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT ${EXPORT_HISTORY_LIMIT}`.execute(trx);
      return rows.map(({ zone, mois, ...entry }) => ({
        ...entry,
        objet:
          entry.type === 'tableau_de_bord'
            ? `Tableau de bord · ${zone}`
            : `Rapport mensuel · ${zone} · ${formatMonth(mois!)}`,
      }));
    });
  }

  create(sub: string, ip: string | undefined, request: ExportRequest): Promise<{ id: number }> {
    return this.act(sub, ip, async (trx) => {
      const rapport = request.type === 'rapport_mensuel' ? request.rapport : null;
      const { rows } = await sql<{ id: number }>`
        SELECT sabou.export_creer(${request.type}, ${request.format}, ${rapport}::bigint)::int AS id`.execute(
        trx,
      );
      return rows[0]!;
    });
  }

  // Export visible (RLS) : sa photographie, pour régénérer le fichier
  file(sub: string, id: number): Promise<ExportFile> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<ExportFile>`
        SELECT e.type, e.format, e.contenu, u.prenom || ' ' || u.nom AS auteur,
               ${STAMP('e.created_at')} AS le
          FROM sabou.rapport_export e
          JOIN sabou.utilisateur u ON u.id = e.demande_par
         WHERE e.id = ${id}`.execute(trx);
      if (!rows[0]) throw new ReportNotFoundError();
      return rows[0];
    });
  }
}
