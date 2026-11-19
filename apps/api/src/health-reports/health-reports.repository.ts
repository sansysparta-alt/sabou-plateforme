import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  HealthReportDecision,
  HealthReportItem,
  HealthReportSeverity,
  HealthReportType,
  SuspendedTreatment,
  ZoneListQuery,
  ZonePage,
} from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone } from '../database/zone';

export class HealthReportUnknownObjectError extends Error {}
export class HealthReportNotFoundError extends Error {}
export class HealthReportClosedError extends Error {}
export class HealthReportNotAllowedError extends Error {}
// Décision impossible sur l'objet (suspension d'une plante, traitement déjà retiré…)
export class HealthReportDecisionRefusedError extends Error {}
// La levée remet le traitement en ligne : refusée si la certification n'est plus possible
export class SuspensionLiftBlockedError extends Error {}

// Messages des fonctions de 20261119170000_signalements.sql, prouvés sur un vrai PostgreSQL
// (packages/db/test/signalements.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (/Signalement : code .* inconnu/.test(message)) throw new HealthReportUnknownObjectError();
  if (/(Signalement|Traitement) .* introuvable/.test(message)) {
    throw new HealthReportNotFoundError();
  }
  if (message.includes('déjà clos')) throw new HealthReportClosedError();
  if (message.includes('réservée au Comité')) throw new HealthReportNotAllowedError();
  if (message.includes('sans objet pour') || message.includes('interdite pour l')) {
    throw new HealthReportDecisionRefusedError();
  }
  if (/^Traitement REC-\d+ : /.test(message)) throw new SuspensionLiftBlockedError();
  throw error;
}

const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

// Signalements (US-100) : dépôt public sans contexte (fonction SECURITY DEFINER), file et
// décisions du Comité sous son contexte (RLS : le Comité seul lit les signalements).
@Injectable()
export class HealthReportsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async deposit(input: {
    type: HealthReportType;
    code: string;
    gravite: HealthReportSeverity;
    description: string;
    contact?: string | undefined;
  }): Promise<string> {
    const { rows } = await sql<{ reference: string }>`
      SELECT sabou.signalement_deposer(${input.type}, ${input.code}, ${input.gravite},
                                       ${input.description}, ${input.contact ?? null}) AS reference`
      .execute(this.db)
      .catch(translate);
    return rows[0]!.reference;
  }

  // Signalements ouverts : graves d'abord, puis du plus ancien au plus récent. Pagination par
  // décalage (ordre de priorité, pas l'ordre des codes de zonePage) ; recherche dans la
  // référence, le code et le nom de l'objet.
  queue(sub: string, query: ZoneListQuery): Promise<ZonePage<HealthReportItem>> {
    const term = query.q ? `%${likeEscape(query.q)}%` : null;
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<{ total: number; ligne: HealthReportItem | null }>`
        WITH liste AS (
          SELECT sabou.signalement_reference(s.id) AS code, s.type, s.gravite,
                 s.objet_type AS "objetType",
                 COALESCE(r.code, pl.code, '') AS "objetCode",
                 COALESCE(r.titre_fr, pl.nom_fr, 'Produit') AS "objetNom",
                 COALESCE(r.statut, pl.statut, '') AS "objetStatut",
                 u.prenom || ' ' || u.nom AS "praticienNom", pf.nom AS prefecture,
                 s.description, s.contact,
                 to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "recuLe",
                 CASE WHEN s.gravite = 'grave' THEN
                   to_char((s.created_at + interval '24 hours') AT TIME ZONE 'UTC',
                           'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS echeance,
                 s.gravite = 'grave' AND s.created_at + interval '24 hours' < now() AS "enRetard",
                 s.gravite <> 'grave' AS tri_gravite, s.created_at AS tri_date, s.id AS tri_id
            FROM sabou.signalement_sanitaire s
            LEFT JOIN sabou.recette r     ON s.objet_type = 'recette' AND r.id = s.objet_id
            LEFT JOIN sabou.plante pl     ON s.objet_type = 'plante' AND pl.id = s.objet_id
            LEFT JOIN sabou.praticien p   ON p.id = r.praticien_id
            LEFT JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
            LEFT JOIN sabou.prefecture pf ON pf.id = s.prefecture_id
           WHERE s.statut <> 'clos'
        ),
        trouvee AS (
          SELECT * FROM liste
           WHERE ${term}::text IS NULL
              OR sabou.f_norm(code) LIKE sabou.f_norm(${term})
              OR sabou.f_norm("objetCode") LIKE sabou.f_norm(${term})
              OR sabou.f_norm("objetNom") LIKE sabou.f_norm(${term})
        )
        SELECT t.total, to_jsonb(l) - 'tri_gravite' - 'tri_date' - 'tri_id' AS ligne
          FROM (SELECT count(*)::int AS total FROM trouvee) t
          LEFT JOIN LATERAL (
            SELECT * FROM trouvee ORDER BY tri_gravite, tri_date, tri_id
             LIMIT ${query.limite} OFFSET ${query.decalage ?? 0}
          ) l ON true
         ORDER BY l.tri_gravite, l.tri_date, l.tri_id`.execute(trx);
      return {
        elements: rows.flatMap((row) => (row.ligne ? [row.ligne] : [])),
        suivant: null,
        total: rows[0]?.total ?? 0,
      };
    });
  }

  decide(
    sub: string,
    ip: string | undefined,
    reference: string,
    decision: HealthReportDecision,
    motif: string,
  ): Promise<void> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      await sql`SELECT sabou.signalement_decider(${reference}, ${decision}, ${motif})`
        .execute(trx)
        .catch(translate);
    });
  }

  // Traitements suspendus : date et motif de la dernière suspension
  suspended(sub: string): Promise<SuspendedTreatment[]> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<SuspendedTreatment>`
        SELECT r.code, r.titre_fr AS "titreFr", u.prenom || ' ' || u.nom AS "praticienNom",
               to_char(h.decide_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "suspenduLe",
               h.motif
          FROM sabou.recette r
          JOIN sabou.praticien p   ON p.id = r.praticien_id
          JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
          LEFT JOIN LATERAL (
            SELECT decide_le, motif FROM sabou.recette_historique
             WHERE recette_id = r.id AND statut_arrivee = 'suspendue'
             ORDER BY decide_le DESC, id DESC LIMIT 1
          ) h ON true
         WHERE r.statut = 'suspendue'
           AND sabou.contexte_role() = 'scientifique'
         ORDER BY h.decide_le NULLS FIRST, r.code`.execute(trx);
      return rows;
    });
  }

  liftSuspension(sub: string, ip: string | undefined, code: string, motif: string): Promise<void> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      await sql`SELECT sabou.traitement_suspension_lever(${code}, ${motif})`
        .execute(trx)
        .catch(translate);
    });
  }
}
