import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Rejection, RejectionCandidate, RejectionResult } from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone } from '../database/zone';

// Refus traduits en réponses par le contrôleur
export class PractitionerNotFoundError extends Error {}
export class RejectionNotAllowedError extends Error {}
export class AlreadyRejectedError extends Error {}
export class StalePractitionerError extends Error {}

// Nombre de praticiens renvoyés par une recherche : assez pour un homonyme, pas une liste
export const SEARCH_LIMIT = 20;

// Messages de praticien_rejeter (20261114120000_rejet_definitif.sql) ; chaque branche est
// couverte sur un vrai PostgreSQL (packages/db/test/rejet-definitif.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (message.includes('réservé à la Direction Générale')) throw new RejectionNotAllowedError();
  if (message.includes('déjà rejeté définitivement')) throw new AlreadyRejectedError();
  throw error;
}

// Caractères spéciaux de LIKE neutralisés : la saisie est cherchée telle quelle
const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

// Rejet définitif d'un praticien par la DG (US-047). La base contrôle le rôle, applique le
// rejet et ses effets dans une transaction (praticien_rejeter) ; le contrôle de la zone
// passe par le RLS du contexte ouvert par inZone (la DG est nationale).
@Injectable()
export class RejectionsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // Recherche par code exact (praticien, dossier, certificat) ou par nom, sans accents
  search(sub: string, q: string): Promise<RejectionCandidate[]> {
    return inZone(this.db, sub, async (trx) => {
      const code = q.toUpperCase();
      const name = `%${likeEscape(q)}%`;
      const { rows } = await sql<RejectionCandidate>`
        SELECT p.code AS praticien, u.prenom || ' ' || u.nom AS nom, sp.libelle_fr AS specialite,
               pf.nom AS prefecture, ra.nom AS region, p.statut,
               (SELECT json_build_object('code', d.code, 'etape', d.etape_courante)
                  FROM sabou.dossier_certification d
                 WHERE d.praticien_id = p.id AND d.statut = 'en_cours') AS dossier,
               (SELECT c.numero FROM sabou.certificat c
                 WHERE c.praticien_id = p.id AND c.statut = 'actif') AS certificat,
               (SELECT count(*)::int FROM sabou.recette r
                 WHERE r.praticien_id = p.id AND r.statut = 'certifiee') AS "traitementsCertifies",
               (SELECT count(*)::int FROM sabou.recette r
                 WHERE r.praticien_id = p.id
                   AND r.statut IN ('soumise','transmise','expertisee')) AS "traitementsEnExamen",
               (SELECT json_build_object(
                         'le', to_char(rd.decide_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                         'motif', rd.motif, 'recoursJusquau', rd.recours_jusquau::text)
                  FROM sabou.rejet_definitif rd WHERE rd.praticien_id = p.id
                 ORDER BY rd.decide_le DESC LIMIT 1) AS rejet
          FROM sabou.praticien p
          JOIN sabou.utilisateur u    ON u.id = p.utilisateur_id
          JOIN sabou.specialite sp    ON sp.id = p.specialite_id
          JOIN sabou.prefecture pf    ON pf.id = p.prefecture_id
          JOIN sabou.region_admin ra  ON ra.id = pf.region_admin_id
         WHERE p.code = ${code}
            OR EXISTS (SELECT 1 FROM sabou.dossier_certification d
                        WHERE d.praticien_id = p.id AND d.code = ${code})
            OR EXISTS (SELECT 1 FROM sabou.certificat c
                        WHERE c.praticien_id = p.id AND c.numero = ${code})
            OR sabou.f_norm(u.prenom || ' ' || u.nom) LIKE sabou.f_norm(${name})
            OR sabou.f_norm(u.nom || ' ' || u.prenom) LIKE sabou.f_norm(${name})
         ORDER BY u.nom, u.prenom, p.code
         LIMIT ${SEARCH_LIMIT}`.execute(trx);
      return rows;
    });
  }

  // Le dossier en cours vu à l'écran est comparé sous verrou : si un dossier a été ouvert
  // ou clos entre-temps, le rejet est refusé (la DG revoit les conséquences)
  reject(
    sub: string,
    ip: string | undefined,
    code: string,
    input: Rejection,
  ): Promise<RejectionResult> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const { rows } = await sql<{ id: number; dossier: string | null }>`
        SELECT p.id::int,
               (SELECT d.code FROM sabou.dossier_certification d
                 WHERE d.praticien_id = p.id AND d.statut = 'en_cours') AS dossier
          FROM sabou.praticien p WHERE p.code = ${code} FOR UPDATE`.execute(trx);
      const practitioner = rows[0];
      if (!practitioner) throw new PractitionerNotFoundError();
      if (practitioner.dossier !== input.dossier) throw new StalePractitionerError();

      const result = await sql<{
        dossier: string | null;
        certificat: string | null;
        recours: string;
        suspendus: number;
      }>`
        SELECT (SELECT d.code FROM sabou.dossier_certification d WHERE d.id = r.dossier_id) AS dossier,
               (SELECT c.numero FROM sabou.certificat c WHERE c.id = r.certificat_id) AS certificat,
               r.recours_jusquau::text AS recours,
               -- Nombre tracé par la base au journal d'audit de ce rejet
               (SELECT (j.details->>'traitementsSuspendus')::int FROM sabou.journal_audit j
                 WHERE j.action = 'praticien.rejet_definitif'
                   AND (j.details->>'rejet')::bigint = r.id) AS suspendus
          FROM sabou.praticien_rejeter(${practitioner.id}, sabou.contexte_utilisateur(),
                 ${input.motif}, ${input.detail}, ${input.avisComite?.date ?? null}::date,
                 ${input.avisComite?.reference ?? null}) r`
        .execute(trx)
        .catch(translate);
      const { dossier, certificat, recours, suspendus } = result.rows[0]!;
      return {
        praticien: code,
        dossier,
        certificat,
        traitementsSuspendus: suspendus,
        recoursJusquau: recours,
      };
    });
  }
}
