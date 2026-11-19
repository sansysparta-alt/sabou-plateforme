import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { PractitionerVoice, PractitionerVoiceTarget } from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone, type ZoneSubject, type ZoneTrx } from '../database/zone';
import {
  StudioNoProfileError,
  TreatmentInvalidError,
  TreatmentLockedError,
  TreatmentNotFoundError,
} from './studio.repository';

export class VoiceConsentRequiredError extends Error {}
export class VoiceRateLimitError extends Error {}
export class VoiceAbsentError extends Error {}

export interface VoiceUpload {
  key: string;
  mime: string;
  size: number;
  sha256: string;
}

// Messages des fonctions de 20261119180000_studio_voix_praticien.sql, prouvés sur un vrai
// PostgreSQL (packages/db/test/studio-voix-praticien.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (message.includes('Fiche de praticien à créer')) throw new StudioNoProfileError();
  if (/Traitement REC-\d+ introuvable/.test(message)) throw new TreatmentNotFoundError();
  if (message.includes('seul un brouillon')) throw new TreatmentLockedError();
  if (message.includes('consentement à donner')) throw new VoiceConsentRequiredError();
  if (message.includes('Trop d’enregistrements') || message.includes("Trop d'enregistrements")) {
    throw new VoiceRateLimitError();
  }
  if (message.includes('Voix absente')) throw new VoiceAbsentError();
  if (/absente du traitement|inconnue|Clé d'envoi/.test(message)) {
    throw new TreatmentInvalidError(message);
  }
  throw error;
}

// US-081 : voix du praticien dans le Studio mobile. Toujours dans son contexte (inZone) ; la
// base contrôle la cible, le consentement, le brouillon et rend l'envoi rejouable (clé).
@Injectable()
export class StudioVoicesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // Dépôt rattaché au traitement ; renvoie le numéro du dépôt (le même si la clé est rejouée)
  deposit(
    sub: ZoneSubject,
    ip: string | undefined,
    code: string,
    target: PractitionerVoiceTarget,
    object: string,
    clientKey: string,
    upload: VoiceUpload,
  ): Promise<number> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const { rows } = await sql<{ depot: string }>`
        SELECT sabou.traitement_voix_praticien_deposer(${code}, ${target}, ${object},
                 ${clientKey}::uuid, ${upload.key}, ${upload.mime}, ${upload.size},
                 ${upload.sha256}) AS depot`
        .execute(trx)
        .catch(translate);
      return Number(rows[0]!.depot);
    });
  }

  // Le dépôt de cette clé existe-t-il déjà ? (envoi rejoué : le fichier n'est pas rangé deux fois)
  known(sub: ZoneSubject, clientKey: string): Promise<boolean> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<{ found: boolean }>`
        SELECT EXISTS (SELECT 1 FROM sabou.recette_voix_praticien
                        WHERE cle_client = ${clientKey}::uuid
                          AND enregistre_par = sabou.contexte_utilisateur()) AS found`.execute(trx);
      return rows[0]!.found;
    });
  }

  remove(
    sub: ZoneSubject,
    ip: string | undefined,
    code: string,
    target: PractitionerVoiceTarget,
    object: string,
  ): Promise<boolean> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const { rows } = await sql<{ retiree: boolean }>`
        SELECT sabou.traitement_voix_praticien_retirer(${code}, ${target}, ${object}) AS retiree`
        .execute(trx)
        .catch(translate);
      return rows[0]!.retiree;
    });
  }

  list(sub: ZoneSubject, code: string): Promise<PractitionerVoice[]> {
    return inZone(this.db, sub, (trx) => this.read(trx, code));
  }

  // Fichier traité de la voix en vigueur : AAC pour le téléphone (lu partout), sinon Opus
  file(
    sub: ZoneSubject,
    code: string,
    target: PractitionerVoiceTarget,
    object: string,
  ): Promise<{ key: string; mime: string }> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<{ chemin: string | null; secours: string | null }>`
        SELECT chemin, secours FROM sabou.traitement_voix_praticien_fichier(${code}, ${target}, ${object})`
        .execute(trx)
        .catch(translate);
      const row = rows[0];
      if (row?.secours) return { key: row.secours, mime: 'audio/mp4' };
      if (row?.chemin) return { key: row.chemin, mime: 'audio/webm' };
      throw new VoiceAbsentError();
    });
  }

  private async read(trx: ZoneTrx, code: string): Promise<PractitionerVoice[]> {
    const { rows } = await sql<PractitionerVoice>`
      SELECT cible, objet, depot::int AS depot, etat, duree_sec::float AS "dureeSec",
             to_char(enregistre_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "enregistreLe"
        FROM sabou.traitement_voix_praticien(${code})`
      .execute(trx)
      .catch(translate);
    return rows;
  }
}
