import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  TreatmentSectionRevise,
  TreatmentSectionType,
  TreatmentVoiceEntry,
  TreatmentVoiceMove,
  TreatmentVoices,
  TreatmentVoiceSection,
  TreatmentVoiceTarget,
  VoiceCoverage,
  VoicePublication,
} from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone, type ZoneTrx } from '../database/zone';
import {
  NameVoiceConsentError,
  NameVoiceDepositError,
  NameVoiceNotAllowedError,
  NameVoiceNotFoundError,
  NameVoiceSelfValidationError,
  NameVoiceTransitionError,
  type NameVoiceFile,
} from './name-voices.repository';

// Texte révisable seulement quand le traitement est soumis (US-075)
export class TreatmentNotRevisableError extends Error {}
export class TreatmentTextError extends Error {}

// Messages des fonctions traitement_* (20261119130000_resume_voix_locale.sql et suivantes) ;
// chaque branche est couverte sur un vrai PostgreSQL (packages/db/test/resume-voix-locale.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (message.includes('jamais celui qui a enregistré')) throw new NameVoiceSelfValidationError();
  if (
    /réservée? à|Contrôle réservé/.test(message) ||
    /Droit d'enregistrer en|Droit de (traduire|valider) en/.test(message) ||
    message.includes('Acteur inconnu ou suspendu')
  ) {
    throw new NameVoiceNotAllowedError(message);
  }
  if (
    /Traitement .* introuvable/.test(message) ||
    /Section .* absente/.test(message) ||
    message.includes('Aucune voix en')
  ) {
    throw new NameVoiceNotFoundError();
  }
  if (message.includes('se révise seulement') || message.includes('retiré'))
    throw new TreatmentNotRevisableError();
  if (message.includes('4000 caractères')) throw new TreatmentTextError();
  if (message.includes('consentement')) throw new NameVoiceConsentError();
  if (/Transition .* impossible/.test(message)) throw new NameVoiceTransitionError();
  if (/Voix \d+ absente/.test(message)) throw new NameVoiceDepositError();
  throw error;
}

// Ligne de voix sans la section qui a servi au regroupement
function omitSection<T extends { section: string }>(row: T): Omit<T, 'section'> {
  const copy: Partial<T> = { ...row };
  delete copy.section;
  return copy as Omit<T, 'section'>;
}

// Statuts du traitement où ses voix se travaillent : le brouillon est encore celui du
// praticien, un traitement retiré ne se publie plus
const WORKABLE = ['soumise', 'transmise', 'expertisee', 'certifiee', 'suspendue'];

// Voix des sections d'un traitement (US-075, puis US-072 à US-074). La base fait avancer les
// statuts, contrôle la zone, les droits par langue, la séparation des tâches et le
// consentement, et trace chaque geste ; l'acteur est celui du contexte inZone.
@Injectable()
export class TreatmentVoicesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // Traitements de la zone du compte (cloisonnement de la base), avec l'état de leurs voix
  targets(sub: string): Promise<TreatmentVoiceTarget[]> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<TreatmentVoiceTarget>`
        SELECT r.code, r.titre_fr AS titre, m.nom_fr AS maladie,
               trim(u.prenom || ' ' || u.nom) AS praticien, pf.nom AS prefecture, r.statut,
               count(*) FILTER (WHERE v.statut = 'brouillon')::int AS brouillons,
               count(*) FILTER (WHERE v.statut = 'traduit')::int AS traduites,
               count(*) FILTER (WHERE v.statut = 'valide')::int AS validees,
               count(*) FILTER (WHERE v.statut = 'publie')::int AS publiees,
               count(*) FILTER (WHERE v.statut = 'traduit' AND EXISTS (
                 SELECT 1 FROM sabou.utilisateur_langue ul
                  WHERE ul.utilisateur_id = sabou.contexte_utilisateur()
                    AND ul.langue_code = v.langue_code AND ul.peut_valider))::int AS "aValider",
               count(*) FILTER (WHERE v.statut = 'valide' AND s.type_code = 'effets_indesirables'
                                  AND v.controle_comite_par IS NULL)::int AS "aControler"
          FROM sabou.recette r
          JOIN sabou.maladie m ON m.id = r.maladie_id
          JOIN sabou.praticien p ON p.id = r.praticien_id
          JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
          JOIN sabou.prefecture pf ON pf.id = p.prefecture_id
          LEFT JOIN sabou.recette_section s ON s.recette_id = r.id
          LEFT JOIN sabou.recette_section_voix v ON v.section_id = s.id
         WHERE r.statut = ANY(${WORKABLE}::text[]) AND p.statut <> 'rejete'
         GROUP BY r.id, m.nom_fr, u.prenom, u.nom, pf.nom
         ORDER BY (r.statut = 'soumise') DESC, r.updated_at DESC, r.code
         LIMIT 200`.execute(trx);
      return rows;
    });
  }

  // Couverture par langue et retards par région : la DG seule (les fonctions ne renvoient
  // rien à un autre profil)
  coverage(sub: string): Promise<VoiceCoverage> {
    return inZone(this.db, sub, async (trx) => {
      const langues = await sql<VoiceCoverage['langues'][number]>`
        SELECT langue, langue_nom AS "langueNom", sections, publiees, validees, bloquees
          FROM sabou.voix_couverture()`.execute(trx);
      const retards = await sql<VoiceCoverage['retards'][number]>`
        SELECT region, brouillons, envoyees, validees, to_char(plus_ancienne, 'YYYY-MM-DD') AS "plusAncienne"
          FROM sabou.voix_retards()`.execute(trx);
      return { langues: langues.rows, retards: retards.rows };
    });
  }

  // Publication groupée des voix validées (DG), d'une langue ou de toutes
  publish(sub: string, ip: string | undefined, langue: string | null): Promise<VoicePublication> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const { rows } = await sql<VoicePublication>`
        SELECT publiees, bloquees FROM sabou.traitement_voix_publier(${langue})`
        .execute(trx)
        .catch(translate);
      return rows[0]!;
    });
  }

  detail(sub: string, code: string): Promise<TreatmentVoices> {
    return inZone(this.db, sub, (trx) => this.read(trx, code));
  }

  revise(
    sub: string,
    ip: string | undefined,
    code: string,
    type: TreatmentSectionType,
    text: TreatmentSectionRevise,
  ): Promise<TreatmentVoices> {
    return this.act(
      sub,
      ip,
      code,
      sql`SELECT sabou.traitement_section_reviser(${code}, ${type}, ${text.texteFr}, ${text.texteEn})`,
    );
  }

  record(
    sub: string,
    ip: string | undefined,
    code: string,
    type: TreatmentSectionType,
    langue: string,
    depot: number,
  ): Promise<TreatmentVoices> {
    return this.act(
      sub,
      ip,
      code,
      sql`SELECT sabou.traitement_voix_enregistrer(${code}, ${type}, ${langue}, ${depot}::bigint)`,
    );
  }

  move(
    sub: string,
    ip: string | undefined,
    code: string,
    type: TreatmentSectionType,
    langue: string,
    move: TreatmentVoiceMove,
  ): Promise<TreatmentVoices> {
    // Envoi au régional (US-075) ; validation ou renvoi motivé par le régional (US-072)
    // ; contrôle des effets indésirables par le Comité (US-073)
    const control = move.vers === 'controle' || move.vers === 'controle_refuse';
    if (control && type !== 'effets_indesirables') throw new NameVoiceNotFoundError();
    const statement =
      move.vers === 'traduit'
        ? sql`SELECT sabou.traitement_voix_envoyer(${code}, ${type}, ${langue})`
        : control
          ? sql`SELECT sabou.traitement_voix_controler(${code}, ${langue},
                                                       ${move.vers === 'controle'}, ${move.motif})`
          : sql`SELECT sabou.traitement_voix_valider(${code}, ${type}, ${langue},
                                                     ${move.vers === 'valide'}, ${move.motif})`;
    return this.act(sub, ip, code, statement);
  }

  // Fichier de la voix à écouter : Opus (WebM) ou secours AAC (MP4)
  file(
    sub: string,
    code: string,
    type: TreatmentSectionType,
    langue: string,
    fallback: boolean,
  ): Promise<NameVoiceFile> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<{ chemin: string; secours: string | null }>`
        SELECT a.chemin, a.chemin_secours AS secours
          FROM sabou.recette_section_voix v
          JOIN sabou.recette_section s ON s.id = v.section_id
          JOIN sabou.recette r ON r.id = s.recette_id
          JOIN sabou.audio_fichier a ON a.id = v.audio_id
         WHERE r.code = ${code} AND s.type_code = ${type} AND v.langue_code = ${langue}`.execute(
        trx,
      );
      const row = rows[0];
      if (!row) throw new NameVoiceNotFoundError();
      if (fallback) {
        if (!row.secours) throw new NameVoiceNotFoundError();
        return { key: row.secours, mime: 'audio/mp4' };
      }
      return { key: row.chemin, mime: 'audio/webm' };
    });
  }

  private act(
    sub: string,
    ip: string | undefined,
    code: string,
    statement: ReturnType<typeof sql>,
  ): Promise<TreatmentVoices> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      await statement.execute(trx).catch(translate);
      return this.read(trx, code);
    });
  }

  // Sections du traitement, chacune avec toutes les langues de voix actives
  private async read(trx: ZoneTrx, code: string): Promise<TreatmentVoices> {
    const { rows } = await sql<{
      titre: string;
      statut: string;
      praticien: string;
      prefectoral: boolean;
      comite: boolean;
    }>`
      SELECT r.titre_fr AS titre, r.statut, trim(u.prenom || ' ' || u.nom) AS praticien,
             EXISTS (SELECT 1 FROM sabou.utilisateur a
                      WHERE a.id = sabou.contexte_utilisateur() AND a.role_code = 'prefectoral'
                        AND a.prefecture_id = p.prefecture_id) AS prefectoral,
             sabou.contexte_role() = 'scientifique' AS comite
        FROM sabou.recette r
        JOIN sabou.praticien p ON p.id = r.praticien_id
        JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
       WHERE r.code = ${code} AND r.statut = ANY(${WORKABLE}::text[])`.execute(trx);
    const head = rows[0];
    if (!head) throw new NameVoiceNotFoundError();

    const sections = await sql<Omit<TreatmentVoiceSection, 'voix' | 'revisions'> & { id: string }>`
      SELECT s.id::text AS id, s.type_code AS type, t.libelle_fr AS libelle,
             s.texte_fr AS "texteFr", s.texte_en AS "texteEn"
        FROM sabou.recette_section s
        JOIN sabou.recette r ON r.id = s.recette_id
        JOIN sabou.section_type t ON t.code = s.type_code
       WHERE r.code = ${code}
       ORDER BY t.ordre`.execute(trx);
    const ids = sections.rows.map((s) => s.id);

    const revisions = await sql<{
      section: string;
      avant: string | null;
      apres: string;
      par: string;
      le: string;
    }>`
      SELECT h.section_id::text AS section, h.texte_fr_avant AS avant, h.texte_fr AS apres,
             trim(u.prenom || ' ' || u.nom) AS par, h.revise_le AS le
        FROM sabou.recette_section_revision h
        JOIN sabou.utilisateur u ON u.id = h.revise_par
       WHERE h.section_id = ANY(${ids}::bigint[])
       ORDER BY h.revise_le, h.id`.execute(trx);

    const voices = await sql<TreatmentVoiceEntry & { section: string }>`
      SELECT s.id::text AS section, l.code AS langue, l.nom_fr AS "langueNom", v.statut,
             trim(e.prenom || ' ' || e.nom) AS "enregistrePar",
             coalesce(v.enregistre_par = sabou.contexte_utilisateur(), false) AS "parMoi",
             v.renvoi_motif AS motif,
             coalesce(a.consentement_voix, false) AS consentement,
             a.chemin_secours IS NOT NULL AS secours,
             v.controle_comite_par IS NOT NULL AS controle,
             coalesce(ul.peut_enregistrer, false) AS "peutEnregistrer",
             coalesce(ul.peut_traduire, false) AS "peutTraduire",
             coalesce(ul.peut_valider, false) AS "peutValider"
        FROM sabou.recette_section s
        CROSS JOIN sabou.langue l
        LEFT JOIN sabou.recette_section_voix v ON v.section_id = s.id AND v.langue_code = l.code
        LEFT JOIN sabou.utilisateur e ON e.id = v.enregistre_par
        LEFT JOIN sabou.audio_fichier a ON a.id = v.audio_id
        LEFT JOIN sabou.utilisateur_langue ul
               ON ul.utilisateur_id = sabou.contexte_utilisateur() AND ul.langue_code = l.code
       WHERE s.id = ANY(${ids}::bigint[]) AND l.voix AND l.active
       ORDER BY l.ordre, l.nom_fr`.execute(trx);

    return {
      code,
      titre: head.titre,
      statut: head.statut,
      praticien: head.praticien,
      prefectoral: head.prefectoral,
      comite: head.comite,
      peutReviser: head.prefectoral && head.statut === 'soumise',
      sections: sections.rows.map(({ id, ...section }) => ({
        ...section,
        revisions: revisions.rows
          .filter((r) => r.section === id)
          .map((r) => ({
            avant: r.avant,
            apres: r.apres,
            par: r.par,
            le: new Date(r.le).toISOString(),
          })),
        voix: voices.rows.filter((v) => v.section === id).map((v) => omitSection(v)),
      })),
    };
  }
}
