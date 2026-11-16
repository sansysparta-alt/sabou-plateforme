import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  TreatmentDecision,
  TreatmentDecisionResult,
  TreatmentQueueItem,
  TreatmentStatus,
  ZoneListQuery,
  ZonePage,
} from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { zonePage } from '../database/paging';
import { inZone } from '../database/zone';

export class TreatmentNotInZoneError extends Error {}
export class TreatmentDecisionNotAllowedError extends Error {}
export class TreatmentChangedError extends Error {}
export class TreatmentMotifRequiredError extends Error {}
export class TreatmentPractitionerRejectedError extends Error {}
// Certification refusée par trg_recette_publiable (R-REC-06, R-REC-08, R-REC-11)
export class TreatmentCertificationBlockedError extends Error {}

// Messages de traitement_decider et recette_transition (20261116130000_circuit_traitement.sql),
// prouvés sur un vrai PostgreSQL (packages/db/test/circuit-traitement.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (/Traitement .* introuvable/.test(message)) throw new TreatmentNotInZoneError();
  if (message.includes('interdite pour l')) throw new TreatmentDecisionNotAllowedError();
  if (message.includes('statut changé entre-temps')) throw new TreatmentChangedError();
  if (message.includes('motif obligatoire')) throw new TreatmentMotifRequiredError();
  if (message.includes('praticien rejeté définitivement')) {
    throw new TreatmentPractitionerRejectedError();
  }
  if (/^Traitement REC-\d+ : /.test(message)) throw new TreatmentCertificationBlockedError(message);
  throw error;
}

// Circuit d'un traitement côté administrateurs (US-061) : file de l'acteur connecté et
// décision. La base applique la zone (RLS) et le rôle de chaque transition.
@Injectable()
export class CircuitRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  queue(sub: string, query: ZoneListQuery): Promise<ZonePage<TreatmentQueueItem>> {
    return inZone(this.db, sub, (trx) =>
      zonePage<TreatmentQueueItem>(
        trx,
        sql`
        SELECT r.code, r.titre_fr AS "titreFr", r.statut, p.code AS praticien,
               u.prenom || ' ' || u.nom AS "praticienNom", pf.nom AS prefecture,
               m.nom_fr AS maladie, r.cycle_duree_jours AS "cycleDureeJours",
               r.cycle_prises_par_jour AS "cyclePrisesParJour",
               r.cycle_pause_jours AS "cyclePauseJours", r.visibilite,
               (SELECT d.code FROM sabou.dossier_certification d WHERE d.id = r.dossier_id) AS dossier,
               COALESCE((SELECT jsonb_agg(jsonb_build_object(
                           'nomFr', pl.nom_fr, 'nomScientifique', pl.nom_scientifique,
                           'partie', rp.partie_utilisee, 'validee', pl.statut = 'validee')
                           ORDER BY rp.ordre)
                           FROM sabou.recette_plante rp JOIN sabou.plante pl ON pl.id = rp.plante_id
                          WHERE rp.recette_id = r.id), '[]') AS plantes,
               COALESCE((SELECT jsonb_agg(jsonb_build_object(
                           'type', s.type_code, 'libelleFr', t.libelle_fr,
                           'texteFr', s.texte_fr, 'texteEn', s.texte_en) ORDER BY t.ordre)
                           FROM sabou.recette_section s
                           JOIN sabou.section_type t ON t.code = s.type_code
                          WHERE s.recette_id = r.id), '[]') AS sections,
               to_char(COALESCE((SELECT max(h.decide_le) FROM sabou.recette_historique h
                                  WHERE h.recette_id = r.id), r.updated_at) AT TIME ZONE 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "depuisLe",
               (SELECT h.motif FROM sabou.recette_historique h
                 WHERE h.recette_id = r.id AND h.motif IS NOT NULL
                 ORDER BY h.decide_le DESC, h.id DESC LIMIT 1) AS "dernierMotif"
          FROM sabou.traitements_a_decider() r
          JOIN sabou.praticien p   ON p.id = r.praticien_id
          JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
          JOIN sabou.prefecture pf ON pf.id = p.prefecture_id
          JOIN sabou.maladie m     ON m.id = r.maladie_id`,
        query,
        ['titreFr', 'praticienNom'],
      ),
    );
  }

  decide(
    sub: string,
    ip: string | undefined,
    code: string,
    decision: TreatmentDecision,
  ): Promise<TreatmentDecisionResult> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const { rows } = await sql<{ statut: TreatmentStatus }>`
        SELECT sabou.traitement_decider(${code}, ${decision.statut}, ${decision.decision},
                                        ${decision.motif ?? null}) AS statut`
        .execute(trx)
        .catch(translate);
      return { code, statut: rows[0]!.statut };
    });
  }
}
