import { Inject, Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import type {
  DisputeDecisionInput,
  DisputeDetail,
  DisputeOpen,
  DisputeOpinionInput,
  DisputeSummary,
  PractitionerDisputes,
  ZoneListQuery,
  ZonePage,
} from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { AUTHORITY, signCertificate } from '../certificates/certificates.repository';
import { CERTIFICATE_SIGNER, type CertificateSigner } from '../certificates/vault-signer';
import { DATABASE, type Database } from '../database/database';
import { zonePage } from '../database/paging';
import { inZone, type ZoneTrx } from '../database/zone';

// Refus de la base, traduits en réponses par les contrôleurs
export class DisputeNotFoundError extends Error {}
// Action réservée à un autre profil, ou à une autre étape de l'instruction
export class DisputeNotAllowedError extends Error {}
// Litige résolu, recours déjà ouvert, délai dépassé, pièces trop nombreuses : message dit tel quel
export class DisputeRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Messages des fonctions litige_* (migration 20261120020000) ; chaque branche est couverte
// par un test sur un vrai PostgreSQL (packages/db/test/litiges.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (/Litige .* introuvable/.test(message)) throw new DisputeNotFoundError();
  if (message.includes('réservé') || message.includes('après l')) {
    throw new DisputeNotAllowedError();
  }
  if (message.includes('résolu')) {
    throw new DisputeRefusedError('resolved', 'Ce litige est résolu : il ne change plus.');
  }
  if (message.includes('seulement après un rejet définitif')) {
    throw new DisputeRefusedError(
      'no_rejection',
      'Le recours est possible seulement après un rejet définitif.',
    );
  }
  if (message.includes('délai de recours dépassé')) {
    throw new DisputeRefusedError(
      'too_late',
      'Le délai de recours de 30 jours est dépassé : un nouveau dossier sera possible 12 mois après le rejet.',
    );
  }
  if (message.includes('déjà ouvert')) {
    throw new DisputeRefusedError('exists', 'Un recours est déjà ouvert contre ce rejet.');
  }
  if (message.includes('dix pièces')) {
    throw new DisputeRefusedError('too_many', 'Dix pièces au plus par litige.');
  }
  if (message.includes('plus rejeté')) {
    throw new DisputeRefusedError('stale', 'Le praticien n’est plus rejeté : rechargez le litige.');
  }
  throw error;
}

const STAMP = (column: RawBuilder<unknown>) =>
  sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

// Colonnes d'un litige dans une liste (RLS : seuls les litiges visibles du compte)
const SUMMARY = sql`
  l.code, l.type, l.objet, l.statut, l.issue, p.code AS praticien,
  btrim(concat_ws(' ', u.prenom, u.nom)) AS "praticienNom", pf.nom AS prefecture,
  ${STAMP(sql`l.created_at`)} AS "ouvertLe", r.recours_jusquau::text AS "recoursJusquau"`;
const FROM = sql`
  FROM sabou.litige l
  JOIN sabou.praticien p ON p.id = l.praticien_id
  JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
  JOIN sabou.prefecture pf ON pf.id = l.prefecture_id
  LEFT JOIN sabou.rejet_definitif r ON r.id = l.rejet_id`;

export interface DisputeUpload {
  key: string;
  sha256: string;
  mime: string;
  size: number;
}

// Litiges (US-101). Le praticien et l'administration passent par les mêmes fonctions de la
// base, qui contrôlent l'acteur, la zone et l'étape, et écrivent le journal d'audit.
@Injectable()
export class DisputesRepository {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CERTIFICATE_SIGNER) private readonly signer: CertificateSigner,
  ) {}

  private run<T>(sub: string, ip: string | undefined, work: (trx: ZoneTrx) => Promise<T>) {
    return inZone(this.db, sub, async (trx) => {
      if (ip !== undefined) {
        await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      }
      try {
        return await work(trx);
      } catch (error) {
        translate(error);
      }
    });
  }

  // File de l'administration : litiges non résolus de sa zone ; pour la DG, les recours
  queue(sub: string, query: ZoneListQuery): Promise<ZonePage<DisputeSummary>> {
    return inZone(this.db, sub, (trx) =>
      zonePage<DisputeSummary>(
        trx,
        sql`SELECT ${SUMMARY} ${FROM}
             WHERE l.statut <> 'resolu'
               AND (sabou.contexte_role() <> 'dg' OR l.type = 'recours')`,
        query,
        ['praticienNom', 'objet'],
      ),
    );
  }

  // Espace du praticien : ses litiges, et s'il peut encore déposer un recours
  mine(sub: string): Promise<PractitionerDisputes> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<DisputeSummary>`
        SELECT ${SUMMARY} ${FROM} ORDER BY l.created_at DESC`.execute(trx);
      const { rows: recourse } = await sql<{ jusquau: string | null; possible: boolean }>`
        SELECT r.recours_jusquau::text AS jusquau,
               (p.statut = 'rejete'
                AND r.recours_jusquau >= (now() AT TIME ZONE 'Africa/Conakry')::date
                AND NOT EXISTS (SELECT 1 FROM sabou.litige l WHERE l.rejet_id = r.id)) AS possible
          FROM sabou.praticien p
          JOIN sabou.rejet_definitif r ON r.praticien_id = p.id
         WHERE p.utilisateur_id = sabou.contexte_utilisateur()
         ORDER BY r.decide_le DESC LIMIT 1`.execute(trx);
      return {
        recoursPossible: recourse[0]?.possible ?? false,
        recoursJusquau: recourse[0]?.jusquau ?? null,
        litiges: rows,
      };
    });
  }

  detail(sub: string, code: string): Promise<DisputeDetail> {
    return this.run(sub, undefined, async (trx) => {
      const { rows } = await sql<DisputeDetail>`
        SELECT ${SUMMARY},
               r.motif_detail AS "rejetMotif", l.avis_sens AS "avisSens", l.avis,
               ${STAMP(sql`l.avis_le`)} AS "avisLe", l.decision,
               ${STAMP(sql`l.decide_le`)} AS "decideLe",
               (SELECT c.numero FROM sabou.certificat c WHERE c.id = l.certificat_id) AS certificat,
               COALESCE((SELECT json_agg(json_build_object(
                          'id', m.id::int,
                          'auteur', CASE WHEN a.role_code IN ('regional','dg') THEN a.role_code
                                         ELSE 'praticien' END,
                          'auteurNom', btrim(concat_ws(' ', a.prenom, a.nom)),
                          'contenu', m.contenu,
                          'le', ${STAMP(sql`m.created_at`)}) ORDER BY m.id)
                           FROM sabou.litige_message m
                           JOIN sabou.utilisateur a ON a.id = m.auteur_id
                          WHERE m.litige_id = l.id), '[]') AS messages,
               COALESCE((SELECT json_agg(json_build_object(
                          'id', pc.id::int, 'mime', pc.mime, 'taille', pc.taille,
                          'parPraticien', pc.depose_par = p.utilisateur_id,
                          'deposeLe', ${STAMP(sql`pc.depose_le`)}) ORDER BY pc.id)
                           FROM sabou.litige_piece pc WHERE pc.litige_id = l.id), '[]') AS pieces
          ${FROM} WHERE l.code = ${code}`.execute(trx);
      if (!rows[0]) throw new DisputeNotFoundError();
      return rows[0];
    });
  }

  open(sub: string, ip: string | undefined, input: DisputeOpen): Promise<{ code: string }> {
    return this.run(sub, ip, async (trx) => {
      const { rows } = await sql<{ code: string }>`
        SELECT sabou.litige_ouvrir(${input.type}, ${input.objet}, ${input.message}) AS code`.execute(
        trx,
      );
      return rows[0]!;
    });
  }

  message(sub: string, ip: string | undefined, code: string, contenu: string): Promise<void> {
    return this.run(sub, ip, async (trx) => {
      await sql`SELECT sabou.litige_message_ajouter(${code}, ${contenu})`.execute(trx);
    });
  }

  addPiece(sub: string, ip: string | undefined, code: string, file: DisputeUpload) {
    return this.run(sub, ip, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        SELECT sabou.litige_piece_ajouter(${code}, ${file.key}, ${file.sha256}, ${file.mime},
                                          ${file.size})::int AS id`.execute(trx);
      return rows[0]!;
    });
  }

  // Pièce à servir : visible seulement si le litige l'est (RLS)
  piece(sub: string, code: string, id: number): Promise<{ key: string; mime: string }> {
    return this.run(sub, undefined, async (trx) => {
      const { rows } = await sql<{ key: string; mime: string }>`
        SELECT pc.fichier_url AS key, COALESCE(pc.mime, 'application/octet-stream') AS mime
          FROM sabou.litige_piece pc JOIN sabou.litige l ON l.id = pc.litige_id
         WHERE l.code = ${code} AND pc.id = ${id}`.execute(trx);
      if (!rows[0]) throw new DisputeNotFoundError();
      return rows[0];
    });
  }

  opinion(sub: string, ip: string | undefined, code: string, input: DisputeOpinionInput) {
    return this.run(sub, ip, async (trx) => {
      await sql`SELECT sabou.litige_avis_rendre(${code}, ${input.sens}, ${input.avis})`.execute(
        trx,
      );
    });
  }

  // Décision. Recours accepté d'un praticien certifié : la base prépare le nouveau certificat,
  // le coffre le signe, la base l'enregistre avec la décision, dans une seule transaction
  // (litige verrouillé : deux décisions simultanées n'émettent pas deux certificats).
  decide(
    sub: string,
    ip: string | undefined,
    code: string,
    input: DisputeDecisionInput,
  ): Promise<{ certificat: string | null }> {
    return this.run(sub, ip, async (trx) => {
      const { rows } = await sql<{ certifie: boolean; recours: boolean }>`
        SELECT l.type = 'recours' AS recours,
               EXISTS (SELECT 1 FROM sabou.rejet_definitif r
                        WHERE r.id = l.rejet_id AND r.certificat_id IS NOT NULL) AS certifie
          FROM sabou.litige l WHERE l.code = ${code} FOR UPDATE`.execute(trx);
      const dispute = rows[0];
      if (!dispute) throw new DisputeNotFoundError();
      if (!(dispute.recours && dispute.certifie && input.issue === 'accepte')) {
        await sql`SELECT sabou.litige_decider(${code}, ${input.issue}, ${input.motif})`.execute(
          trx,
        );
        return { certificat: null };
      }
      const prepared = await sql<{
        numero: string;
        titulaire: string;
        emis: string;
        expire: string;
      }>`
        SELECT numero, titulaire, emis_le::text AS emis, expire_le::text AS expire
          FROM sabou.litige_certificat_preparer(${code})`.execute(trx);
      const { numero, titulaire, emis, expire } = prepared.rows[0]!;
      const { signed, kid, x } = await signCertificate(this.signer, {
        number: numero,
        practitioner: titulaire,
        issuedOn: emis,
        expiresOn: expire,
        authority: AUTHORITY,
      });
      await sql`
        SELECT sabou.litige_decider(${code}, ${input.issue}, ${input.motif}, ${numero},
                 ${emis}::date, ${expire}::date, ${signed.digest}, ${signed.signature}, ${kid},
                 ${x}, ${signed.qr})`.execute(trx);
      return { certificat: numero };
    });
  }
}
