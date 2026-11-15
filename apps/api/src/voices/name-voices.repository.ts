import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  NameVoiceObject,
  NameVoices,
  NameVoicesEntry,
  NameVoiceStatus,
  NameVoiceTarget,
} from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone, type ZoneTrx } from '../database/zone';

export class NameVoiceNotAllowedError extends Error {}
export class NameVoiceNotFoundError extends Error {}
export class NameVoiceTransitionError extends Error {}
export class NameVoiceConsentError extends Error {}
export class NameVoiceDepositError extends Error {}
export class NameVoiceSelfValidationError extends Error {}

// Messages des fonctions voix_nom_* (20261115170000_voix_des_noms.sql) ; chaque branche est
// couverte sur un vrai PostgreSQL (packages/db/test/voix-des-noms.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (message.includes('jamais celui qui a enregistré')) throw new NameVoiceSelfValidationError();
  if (
    message.includes('réservé au référent de la langue') ||
    /Droit de (traduire|valider) en/.test(message) ||
    message.includes('réservée à la Direction Générale') ||
    message.includes('Acteur inconnu ou suspendu')
  ) {
    throw new NameVoiceNotAllowedError(message);
  }
  if (/Fiche .* introuvable/.test(message) || message.includes('Aucune voix du nom')) {
    throw new NameVoiceNotFoundError();
  }
  if (message.includes('consentement')) {
    throw new NameVoiceConsentError();
  }
  if (/Transition .* impossible/.test(message)) throw new NameVoiceTransitionError();
  if (/Voix \d+ absente/.test(message)) throw new NameVoiceDepositError();
  throw error;
}

const TABLE = { plante: 'plante', maladie: 'maladie' } as const;

export interface NameVoiceFile {
  key: string;
  mime: string;
}

// Voix du nom des plantes et des maladies (US-071). La base fait avancer les statuts
// (voix_nom_enregistrer, voix_nom_statut), contrôle les droits par langue, la séparation des
// tâches et le consentement, et trace chaque geste ; l'acteur est celui du contexte inZone.
@Injectable()
export class NameVoicesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // Fiches du Dictionnaire, avec le nombre de langues publiées
  targets(sub: string): Promise<NameVoiceTarget[]> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<NameVoiceTarget>`
        SELECT 'plante' AS objet, p.code, p.nom_fr AS nom,
               (SELECT count(*)::int FROM sabou.plante_voix v
                 WHERE v.plante_id = p.id AND v.statut = 'publie') AS publiees,
               (SELECT count(*)::int FROM sabou.plante_voix v
                 WHERE v.plante_id = p.id AND v.statut IN ('traduit', 'valide')) AS enCours
          FROM sabou.plante p
        UNION ALL
        SELECT 'maladie', m.code, m.nom_fr,
               (SELECT count(*)::int FROM sabou.maladie_voix v
                 WHERE v.maladie_id = m.id AND v.statut = 'publie'),
               (SELECT count(*)::int FROM sabou.maladie_voix v
                 WHERE v.maladie_id = m.id AND v.statut IN ('traduit', 'valide'))
          FROM sabou.maladie m
         ORDER BY objet DESC, nom, code`.execute(trx);
      return rows;
    });
  }

  detail(sub: string, objet: NameVoiceObject, code: string): Promise<NameVoices> {
    return inZone(this.db, sub, (trx) => this.read(trx, objet, code));
  }

  record(
    sub: string,
    ip: string | undefined,
    objet: NameVoiceObject,
    code: string,
    langue: string,
    depot: number,
  ): Promise<NameVoices> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      await sql`SELECT sabou.voix_nom_enregistrer(${objet}, ${code}, ${langue}, ${depot}::bigint)`
        .execute(trx)
        .catch(translate);
      return this.read(trx, objet, code);
    });
  }

  move(
    sub: string,
    ip: string | undefined,
    objet: NameVoiceObject,
    code: string,
    langue: string,
    to: NameVoiceStatus,
    motif: string | null,
  ): Promise<NameVoices> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      await sql`SELECT sabou.voix_nom_statut(${objet}, ${code}, ${langue}, ${to}, ${motif})`
        .execute(trx)
        .catch(translate);
      return this.read(trx, objet, code);
    });
  }

  // Fichier de la voix à écouter : Opus (WebM) ou secours AAC (MP4)
  file(
    sub: string,
    objet: NameVoiceObject,
    code: string,
    langue: string,
    fallback: boolean,
  ): Promise<NameVoiceFile> {
    return inZone(this.db, sub, async (trx) => {
      const table = TABLE[objet];
      const { rows } = await sql<{ chemin: string; secours: string | null }>`
        SELECT a.chemin, a.chemin_secours AS secours
          FROM sabou.${sql.raw(`${table}_voix`)} v
          JOIN sabou.${sql.raw(table)} o ON o.id = v.${sql.raw(`${table}_id`)}
          JOIN sabou.audio_fichier a ON a.id = v.audio_id
         WHERE o.code = ${code} AND v.langue_code = ${langue}`.execute(trx);
      const row = rows[0];
      if (!row) throw new NameVoiceNotFoundError();
      if (fallback) {
        if (!row.secours) throw new NameVoiceNotFoundError();
        return { key: row.secours, mime: 'audio/mp4' };
      }
      return { key: row.chemin, mime: 'audio/webm' };
    });
  }

  // Toutes les langues de voix actives, avec ou sans voix ; droits du compte dans chacune
  private async read(trx: ZoneTrx, objet: NameVoiceObject, code: string): Promise<NameVoices> {
    const table = TABLE[objet];
    const { rows } = await sql<{ nom: string; dg: boolean }>`
      SELECT o.nom_fr AS nom,
             EXISTS (SELECT 1 FROM sabou.utilisateur u
                      WHERE u.id = sabou.contexte_utilisateur() AND u.role_code = 'dg') AS dg
        FROM sabou.${sql.raw(table)} o WHERE o.code = ${code}`.execute(trx);
    const target = rows[0];
    if (!target) throw new NameVoiceNotFoundError();
    const voices = await sql<NameVoicesEntry>`
      SELECT l.code AS langue, l.nom_fr AS "langueNom", v.statut,
             trim(e.prenom || ' ' || e.nom) AS "enregistrePar",
             v.enregistre_par = sabou.contexte_utilisateur() AS "parMoi",
             v.renvoi_motif AS motif,
             coalesce(a.consentement_voix, false) AS consentement,
             a.chemin_secours IS NOT NULL AS secours,
             coalesce(ul.peut_enregistrer, false) AS "peutEnregistrer",
             coalesce(ul.peut_traduire, false) AS "peutTraduire",
             coalesce(ul.peut_valider, false) AS "peutValider"
        FROM sabou.langue l
        LEFT JOIN sabou.${sql.raw(table)} o ON o.code = ${code}
        LEFT JOIN sabou.${sql.raw(`${table}_voix`)} v
               ON v.${sql.raw(`${table}_id`)} = o.id AND v.langue_code = l.code
        LEFT JOIN sabou.utilisateur e ON e.id = v.enregistre_par
        LEFT JOIN sabou.audio_fichier a ON a.id = v.audio_id
        LEFT JOIN sabou.utilisateur_langue ul
               ON ul.utilisateur_id = sabou.contexte_utilisateur() AND ul.langue_code = l.code
       WHERE l.voix AND l.active
       ORDER BY l.ordre, l.nom_fr`.execute(trx);
    return { objet, code, nom: target.nom, dg: target.dg, voix: voices.rows };
  }
}
