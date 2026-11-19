import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  PlantProposal,
  StudioReferentials,
  SubmissionGap,
  TreatmentDetail,
  TreatmentFields,
  TreatmentSummary,
} from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone, type ZoneTrx } from '../database/zone';

export class StudioNoProfileError extends Error {}
export class TreatmentNotFoundError extends Error {}
export class TreatmentLockedError extends Error {}
export class TreatmentStaleError extends Error {}
export class TreatmentNoDossierError extends Error {}
export class TreatmentRejectedPractitionerError extends Error {}
export class TreatmentInvalidError extends Error {}
export class PlantProposalRefusedError extends Error {}
export class PlantProposalLimitError extends Error {}
export class TreatmentIncompleteError extends Error {
  constructor(readonly gaps: SubmissionGap[]) {
    super('Traitement incomplet');
  }
}

// Messages de traitement_enregistrer et traitement_soumettre (20261116120000_studio_traitement.sql),
// prouvés sur un vrai PostgreSQL (packages/db/test/studio-traitement.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (message.includes('Fiche de praticien à créer')) throw new StudioNoProfileError();
  if (/Traitement REC-\d+ introuvable/.test(message)) throw new TreatmentNotFoundError();
  if (message.includes('seul un brouillon se modifie')) throw new TreatmentLockedError();
  if (message.includes('modifié entre-temps')) throw new TreatmentStaleError();
  if (message.includes('dossier de certification à ouvrir')) throw new TreatmentNoDossierError();
  if (message.includes('praticien rejeté définitivement')) {
    throw new TreatmentRejectedPractitionerError();
  }
  const incomplete = /incomplet : (.+)$/.exec(message);
  if (incomplete) {
    throw new TreatmentIncompleteError(incomplete[1]!.split(', ') as SubmissionGap[]);
  }
  // Référence inconnue (maladie, plante, section) : le formulaire n'offre que des choix connus
  if (
    /introuvable|inconnue|deux fois|au plus|Niveau de visibilité|Contre-indication/.test(message)
  ) {
    throw new TreatmentInvalidError(message);
  }
  throw error;
}

// Praticien connecté : ses seuls traitements (le RLS laisse aussi voir les traitements
// certifiés publics des autres, qui n'ont pas leur place dans son Studio)
const OWN = sql`r.praticien_id = (SELECT p.id FROM sabou.praticien p
                                   WHERE p.utilisateur_id = sabou.contexte_utilisateur())`;
const STAMP = (column: string) =>
  sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

// Studio web du praticien (US-060). Toujours dans son contexte (inZone) : la base n'écrit que
// ses brouillons et contrôle la soumission.
@Injectable()
export class StudioRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // Listes du formulaire : maladies, plantes (validées ou en revue) et sections
  async referentials(): Promise<StudioReferentials> {
    const [maladies, plantes, sections, contreIndications] = await Promise.all([
      sql<StudioReferentials['maladies'][number]>`
        SELECT code, nom_fr AS "nomFr" FROM sabou.maladie ORDER BY nom_fr`.execute(this.db),
      sql<StudioReferentials['plantes'][number]>`
        SELECT code, nom_fr AS "nomFr", nom_scientifique AS "nomScientifique",
               statut = 'validee' AS validee
          FROM sabou.plante ORDER BY nom_fr`.execute(this.db),
      sql<StudioReferentials['sections'][number]>`
        SELECT code, libelle_fr AS "libelleFr", obligatoire FROM sabou.section_type
         ORDER BY ordre`.execute(this.db),
      sql<StudioReferentials['contreIndications'][number]>`
        SELECT code, libelle_fr AS "libelleFr" FROM sabou.contre_indication
         WHERE active ORDER BY id`.execute(this.db),
    ]);
    return {
      maladies: maladies.rows,
      plantes: plantes.rows,
      sections: sections.rows,
      contreIndications: contreIndications.rows,
    };
  }

  // US-054 : proposition d'une plante qui manque au Dictionnaire ; la base la crée « en revue »
  // avec le praticien comme auteur (plante_proposer)
  propose(sub: string, input: PlantProposal): Promise<StudioReferentials['plantes'][number]> {
    return inZone(this.db, sub, async (trx) => {
      try {
        const { rows } = await sql<StudioReferentials['plantes'][number]>`
          SELECT code, nom_fr AS "nomFr", nom_scientifique AS "nomScientifique", false AS validee
            FROM sabou.plante_proposer(${input.nomFr}, ${input.nomScientifique}, ${input.famille},
                                       ${input.description})`.execute(trx);
        return rows[0]!;
      } catch (error) {
        const message = (error as { message?: string }).message ?? '';
        if (message.includes('déjà utilisé par la fiche')) {
          throw new PlantProposalRefusedError(
            `${message.replace(/^.*Nom scientifique/, 'Ce nom scientifique')} : choisissez cette plante dans la liste.`,
          );
        }
        if (message.includes('plantes en attente')) {
          throw new PlantProposalLimitError(
            'Vous avez déjà 10 plantes en attente du Comité scientifique : attendez sa réponse avant d’en proposer d’autres.',
          );
        }
        throw error;
      }
    });
  }

  list(sub: string): Promise<TreatmentSummary[]> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<TreatmentSummary>`
        SELECT r.code, r.titre_fr AS "titreFr",
               jsonb_build_object('code', m.code, 'nomFr', m.nom_fr) AS maladie,
               r.statut, r.attente_raison AS "attenteRaison", ${STAMP('r.updated_at')} AS "modifieLe"
          FROM sabou.recette r JOIN sabou.maladie m ON m.id = r.maladie_id
         WHERE ${OWN}
         ORDER BY r.updated_at DESC, r.code
         LIMIT 200`.execute(trx);
      return rows;
    });
  }

  detail(sub: string, code: string): Promise<TreatmentDetail> {
    return inZone(this.db, sub, (trx) => this.read(trx, code));
  }

  save(
    sub: string,
    ip: string | undefined,
    code: string | null,
    seenAt: string | null,
    fields: TreatmentFields,
  ): Promise<TreatmentDetail> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const { contreIndications, ...content } = fields;
      const { rows } = await sql<{ code: string }>`
        SELECT sabou.traitement_enregistrer(${code}, ${seenAt}::timestamptz,
                 ${JSON.stringify(content)}::jsonb) AS code`
        .execute(trx)
        .catch(translate);
      // US-063 : contre-indications posées dans la même transaction
      await sql`SELECT sabou.traitement_contre_indications_poser(${rows[0]!.code},
                  ${JSON.stringify(contreIndications)}::jsonb)`
        .execute(trx)
        .catch(translate);
      return this.read(trx, rows[0]!.code);
    });
  }

  submit(sub: string, ip: string | undefined, code: string): Promise<TreatmentDetail> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      await sql`SELECT sabou.traitement_soumettre(${code})`.execute(trx).catch(translate);
      return this.read(trx, code);
    });
  }

  private async read(trx: ZoneTrx, code: string): Promise<TreatmentDetail> {
    const { rows } = await sql<TreatmentDetail>`
      SELECT r.code, r.titre_fr AS "titreFr", r.titre_en AS "titreEn",
             jsonb_build_object('code', m.code, 'nomFr', m.nom_fr) AS maladie,
             r.statut, r.attente_raison AS "attenteRaison",
             r.cycle_duree_jours AS "cycleDureeJours",
             r.cycle_prises_par_jour AS "cyclePrisesParJour",
             r.cycle_pause_jours AS "cyclePauseJours",
             COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'plante', pl.code, 'nomFr', pl.nom_fr, 'partie', rp.partie_utilisee,
                         'validee', pl.statut = 'validee') ORDER BY rp.ordre)
                         FROM sabou.recette_plante rp JOIN sabou.plante pl ON pl.id = rp.plante_id
                        WHERE rp.recette_id = r.id), '[]') AS plantes,
             COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'type', s.type_code, 'texteFr', s.texte_fr, 'texteEn', s.texte_en)
                         ORDER BY t.ordre)
                         FROM sabou.recette_section s JOIN sabou.section_type t ON t.code = s.type_code
                        WHERE s.recette_id = r.id), '[]') AS sections,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('code', ci.code, 'libelleFr', ci.libelle_fr)
                                        ORDER BY ci.id)
                         FROM sabou.recette_contre_indication rci
                         JOIN sabou.contre_indication ci ON ci.code = rci.contre_indication_code
                        WHERE rci.recette_id = r.id), '[]') AS "contreIndications",
             CASE WHEN r.consentement_le IS NOT NULL THEN r.visibilite END AS visibilite,
             ${STAMP('r.consentement_le')} AS "consentementLe",
             CASE WHEN r.statut = 'brouillon' THEN sabou.recette_manques(r.id) ELSE '{}' END
               AS manques,
             (SELECT d.code FROM sabou.dossier_certification d WHERE d.id = r.dossier_id) AS dossier,
             (SELECT h.motif FROM sabou.recette_historique h
               WHERE h.recette_id = r.id AND h.motif IS NOT NULL
               ORDER BY h.decide_le DESC, h.id DESC LIMIT 1) AS "dernierMotif",
             ${STAMP('r.updated_at')} AS "modifieLe"
        FROM sabou.recette r JOIN sabou.maladie m ON m.id = r.maladie_id
       WHERE r.code = ${code} AND ${OWN}`.execute(trx);
    const treatment = rows[0];
    if (!treatment) throw new TreatmentNotFoundError();
    return treatment;
  }
}
