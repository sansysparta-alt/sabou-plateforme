import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  ConsolidationItem,
  DossierDecision,
  DossierDecisionResult,
  DossierSummary,
  ExpertiseItem,
  FieldVerificationItem,
  PractitionerSummary,
  ZoneListQuery,
  ZonePage,
} from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone } from '../database/zone';
import { visitOf } from '../visits/visits.repository';

// Refus d'une décision, traduits en réponses par le contrôleur
export class DossierNotFoundError extends Error {}
export class DecisionNotAllowedError extends Error {}
export class StaleDossierError extends Error {}
export class FieldVisitRequiredError extends Error {}

// Messages de dossier_transition (schéma initial) ; chaque branche est couverte par un test
// sur un vrai PostgreSQL (packages/db/test/decision-etape-2.test.ts)
function translateTransition(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (message.includes('non habilité')) throw new DecisionNotAllowedError();
  if (message.includes('visite terrain signée requise')) throw new FieldVisitRequiredError();
  throw error;
}

// Page de « limite » éléments : une ligne de plus est lue pour savoir s'il en reste
function page<T extends { code: string }>(rows: T[], limit: number): ZonePage<T> {
  const elements = rows.slice(0, limit);
  return { elements, suivant: rows.length > limit ? elements.at(-1)!.code : null };
}

// Lectures des praticiens et des dossiers (US-011). Aucun filtre de zone ici : les règles
// RLS de la base l'appliquent, dans le contexte ouvert par inZone.
@Injectable()
export class CertificationRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  listPractitioners(sub: string, query: ZoneListQuery): Promise<ZonePage<PractitionerSummary>> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<PractitionerSummary>`
        SELECT p.code, u.prenom, u.nom, sp.libelle_fr AS specialite, pf.nom AS prefecture,
               ra.nom AS region, p.statut
          FROM sabou.praticien p
          JOIN sabou.utilisateur u    ON u.id = p.utilisateur_id
          JOIN sabou.specialite sp    ON sp.id = p.specialite_id
          JOIN sabou.prefecture pf    ON pf.id = p.prefecture_id
          JOIN sabou.region_admin ra  ON ra.id = pf.region_admin_id
         WHERE ${query.apres ?? null}::text IS NULL OR p.code > ${query.apres ?? null}
         ORDER BY p.code
         LIMIT ${query.limite + 1}`.execute(trx);
      return page(rows, query.limite);
    });
  }

  listDossiers(sub: string, query: ZoneListQuery): Promise<ZonePage<DossierSummary>> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<DossierSummary>`
        SELECT d.code, p.code AS praticien, u.prenom || ' ' || u.nom AS "praticienNom",
               pf.nom AS prefecture, d.type, d.etape_courante AS etape, d.statut,
               to_char(d.ouvert_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "ouvertLe"
          FROM sabou.dossier_certification d
          JOIN sabou.praticien p   ON p.id = d.praticien_id
          JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
          JOIN sabou.prefecture pf ON pf.id = p.prefecture_id
         WHERE ${query.apres ?? null}::text IS NULL OR d.code > ${query.apres ?? null}
         ORDER BY d.code
         LIMIT ${query.limite + 1}`.execute(trx);
      return page(rows, query.limite);
    });
  }

  // Dossiers en attente de vérification terrain (étape 2), avec leur visite (US-041)
  listFieldVerification(
    sub: string,
    query: ZoneListQuery,
  ): Promise<ZonePage<FieldVerificationItem>> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<FieldVerificationItem>`
        SELECT d.code, p.code AS praticien, u.prenom || ' ' || u.nom AS "praticienNom",
               sp.libelle_fr AS specialite, d.type, d.visite_requise AS "visiteRequise",
               to_char(d.etape_entree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "soumisLe",
               EXISTS (SELECT 1 FROM sabou.visite_terrain vt
                        WHERE vt.dossier_id = d.id AND vt.statut = 'realisee') AS "visiteRealisee",
               ${visitOf(sql.ref('d.id'))} AS visite
          FROM sabou.dossier_certification d
          JOIN sabou.praticien p   ON p.id = d.praticien_id
          JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
          JOIN sabou.specialite sp ON sp.id = p.specialite_id
         WHERE d.statut = 'en_cours' AND d.etape_courante = 2
           AND (${query.apres ?? null}::text IS NULL OR d.code > ${query.apres ?? null})
         ORDER BY d.code
         LIMIT ${query.limite + 1}`.execute(trx);
      return page(rows, query.limite);
    });
  }

  // Dossiers en attente de consolidation régionale (étape 3) ; mêmes règles d'ordre et de
  // pagination que la vérification terrain
  listConsolidation(sub: string, query: ZoneListQuery): Promise<ZonePage<ConsolidationItem>> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<ConsolidationItem>`
        SELECT d.code, p.code AS praticien, u.prenom || ' ' || u.nom AS "praticienNom",
               sp.libelle_fr AS specialite, pf.nom AS prefecture, d.type,
               to_char(d.etape_entree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "verifieLe",
               EXISTS (SELECT 1 FROM sabou.visite_terrain vt
                        WHERE vt.dossier_id = d.id AND vt.statut = 'realisee') AS "visiteRealisee"
          FROM sabou.dossier_certification d
          JOIN sabou.praticien p   ON p.id = d.praticien_id
          JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
          JOIN sabou.specialite sp ON sp.id = p.specialite_id
          JOIN sabou.prefecture pf ON pf.id = p.prefecture_id
         WHERE d.statut = 'en_cours' AND d.etape_courante = 3
           AND (${query.apres ?? null}::text IS NULL OR d.code > ${query.apres ?? null})
         ORDER BY d.code
         LIMIT ${query.limite + 1}`.execute(trx);
      return page(rows, query.limite);
    });
  }

  // Dossiers en attente d'expertise du Comité scientifique (étape 4), toutes régions (le
  // Comité est national, R-ACC) ; mêmes règles d'ordre et de pagination
  listExpertise(sub: string, query: ZoneListQuery): Promise<ZonePage<ExpertiseItem>> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<ExpertiseItem>`
        SELECT d.code, p.code AS praticien, u.prenom || ' ' || u.nom AS "praticienNom",
               sp.libelle_fr AS specialite, pf.nom AS prefecture, ra.nom AS region, d.type,
               to_char(d.etape_entree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "consolideLe",
               EXISTS (SELECT 1 FROM sabou.visite_terrain vt
                        WHERE vt.dossier_id = d.id AND vt.statut = 'realisee') AS "visiteRealisee"
          FROM sabou.dossier_certification d
          JOIN sabou.praticien p      ON p.id = d.praticien_id
          JOIN sabou.utilisateur u    ON u.id = p.utilisateur_id
          JOIN sabou.specialite sp    ON sp.id = p.specialite_id
          JOIN sabou.prefecture pf    ON pf.id = p.prefecture_id
          JOIN sabou.region_admin ra  ON ra.id = pf.region_admin_id
         WHERE d.statut = 'en_cours' AND d.etape_courante = 4
           AND (${query.apres ?? null}::text IS NULL OR d.code > ${query.apres ?? null})
         ORDER BY d.code
         LIMIT ${query.limite + 1}`.execute(trx);
      return page(rows, query.limite);
    });
  }

  // Décision sur un dossier, dans le contexte du compte connecté. La base vérifie le
  // responsable de l'étape, sa zone, la visite et le motif (dossier_transition) et écrit
  // l'historique, la notification au praticien et le journal d'audit dans la même transaction.
  decide(
    sub: string,
    ip: string | undefined,
    code: string,
    input: DossierDecision,
  ): Promise<DossierDecisionResult> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      // Hors zone : le dossier est invisible (RLS) ; on ne dit pas s'il existe
      const { rows } = await sql<{ id: number; etape: number; statut: string }>`
        SELECT id::int, etape_courante::int AS etape, statut
          FROM sabou.dossier_certification WHERE code = ${code} FOR UPDATE`.execute(trx);
      const dossier = rows[0];
      if (!dossier) throw new DossierNotFoundError();
      if (dossier.statut !== 'en_cours' || dossier.etape !== input.etape) {
        throw new StaleDossierError();
      }
      try {
        const result = await sql<{ etape: number }>`
          SELECT sabou.dossier_transition(${dossier.id}, ${input.decision},
                   sabou.contexte_utilisateur(), ${input.motif ?? null})::int AS etape`.execute(
          trx,
        );
        return { code, etape: result.rows[0]!.etape };
      } catch (error) {
        translateTransition(error);
      }
    });
  }
}
