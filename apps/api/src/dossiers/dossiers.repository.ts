import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  PractitionerReferentials,
  DossierPiece,
  PractitionerDossier,
  PractitionerPieceType,
  PractitionerProfile,
} from '@sabou/types';
import { DATABASE, type Database } from '../database/database';
import { inZone, type ZoneTrx } from '../database/zone';

// Refus de la base (05 §2.26) traduits en erreurs du dossier
export class RejectionDelayError extends Error {}
export class DossierLockedError extends Error {}
export class NoProfileError extends Error {}
export class NoDossierError extends Error {}

const INSUFFICIENT_PRIVILEGE = '42501';
const FOREIGN_KEY_VIOLATION = '23503';
export class InvalidReferenceError extends Error {}

function translate(error: unknown): never {
  const { code, message } = error as { code?: string; message?: string };
  if (message?.includes('après un rejet définitif')) throw new RejectionDelayError();
  if (code === INSUFFICIENT_PRIVILEGE) throw new DossierLockedError();
  // Spécialité, préfecture ou langue inconnue, ou langue sans usage voix
  if (code === FOREIGN_KEY_VIOLATION || message?.includes('non autorisée')) {
    throw new InvalidReferenceError();
  }
  throw error;
}

export interface NewPiece {
  type: PractitionerPieceType;
  key: string;
  sha256: string;
  mime: string;
  size: number;
}

export type SubmitResult =
  | { status: 'missing'; missing: PractitionerPieceType[] }
  | { status: 'submitted'; code: string; submittedAt: string };

// Fiche, dossier et pièces du praticien connecté (US-040a). Toujours dans son contexte
// (inZone) : la base n'expose que sa fiche et ses dossiers (US-011) et contrôle ce qu'il
// peut écrire (triggers de 20261107120000_dossier_praticien).
@Injectable()
export class DossiersRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // Référentiels communs à tous, sans zone : lus hors de inZone
  async referentials(): Promise<PractitionerReferentials> {
    const [specialites, prefectures, sousPrefectures, langues] = await Promise.all([
      sql<PractitionerReferentials['specialites'][number]>`
        SELECT id, libelle_fr AS libelle FROM sabou.specialite
         WHERE active ORDER BY libelle_fr`.execute(this.db),
      sql<PractitionerReferentials['prefectures'][number]>`
        SELECT id, nom FROM sabou.prefecture WHERE active ORDER BY nom`.execute(this.db),
      sql<PractitionerReferentials['sousPrefectures'][number]>`
        SELECT id, nom, prefecture_id AS "prefectureId" FROM sabou.sous_prefecture
         WHERE active ORDER BY nom`.execute(this.db),
      sql<PractitionerReferentials['langues'][number]>`
        SELECT code, nom_fr AS nom FROM sabou.langue
         WHERE active ORDER BY ordre, code`.execute(this.db),
    ]);
    return {
      specialites: specialites.rows,
      prefectures: prefectures.rows,
      sousPrefectures: sousPrefectures.rows,
      langues: langues.rows,
    };
  }

  view(sub: string): Promise<PractitionerDossier | null> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<PractitionerDossier['praticien'] & { id: number }>`
        SELECT id::int, code, statut, specialite_id::int AS "specialiteId",
               prefecture_id::int AS "prefectureId", sous_prefecture_id::int AS "sousPrefectureId",
               langue_principale AS "languePrincipale", annees_experience::int AS "anneesExperience"
          FROM sabou.praticien WHERE utilisateur_id = sabou.contexte_utilisateur()`.execute(trx);
      const row = rows[0];
      if (!row) return null;
      const { id, ...praticien } = row;
      return { praticien, dossier: await this.currentDossier(trx, id) };
    });
  }

  // Crée ou corrige la fiche, puis ouvre le dossier initial s'il n'y en a pas encore
  // (un dossier rejeté définitivement depuis moins de 12 mois est refusé par la base)
  saveProfile(sub: string, profile: PractitionerProfile): Promise<void> {
    return inZone(this.db, sub, async (trx) => {
      try {
        const { rows } = await sql<{ id: number }>`
          INSERT INTO sabou.praticien (utilisateur_id, specialite_id, prefecture_id,
                                       sous_prefecture_id, langue_principale, annees_experience)
          VALUES (sabou.contexte_utilisateur(), ${profile.specialiteId}, ${profile.prefectureId},
                  ${profile.sousPrefectureId}, ${profile.languePrincipale}, ${profile.anneesExperience})
          ON CONFLICT (utilisateur_id) DO UPDATE
             SET specialite_id = EXCLUDED.specialite_id,
                 prefecture_id = EXCLUDED.prefecture_id,
                 sous_prefecture_id = EXCLUDED.sous_prefecture_id,
                 langue_principale = EXCLUDED.langue_principale,
                 annees_experience = EXCLUDED.annees_experience
          RETURNING id::int`.execute(trx);
        const praticienId = rows[0]!.id;
        await sql`
          INSERT INTO sabou.dossier_certification (praticien_id)
          SELECT ${praticienId}::bigint
           WHERE NOT EXISTS (
             SELECT 1 FROM sabou.dossier_certification
              WHERE praticien_id = ${praticienId} AND statut IN ('en_cours', 'approuve'))`.execute(
          trx,
        );
      } catch (error) {
        translate(error);
      }
    });
  }

  addPiece(sub: string, piece: NewPiece): Promise<{ id: number; dossierCode: string }> {
    return inZone(this.db, sub, async (trx) => {
      const dossier = await this.openDossier(trx);
      try {
        const { rows } = await sql<{ id: number }>`
          INSERT INTO sabou.dossier_piece (dossier_id, type, fichier_url, sha256, depose_par,
                                           type_mime, taille_octets)
          VALUES (${dossier.id}, ${piece.type}, ${piece.key}, ${piece.sha256},
                  sabou.contexte_utilisateur(), ${piece.mime}, ${piece.size})
          RETURNING id::int`.execute(trx);
        return { id: rows[0]!.id, dossierCode: dossier.code };
      } catch (error) {
        translate(error);
      }
    });
  }

  // Renvoie la clé du fichier retiré, ou null si la pièce n'est pas la sienne
  removePiece(sub: string, pieceId: number): Promise<string | null> {
    return inZone(this.db, sub, async (trx) => {
      try {
        const { rows } = await sql<{ key: string }>`
          DELETE FROM sabou.dossier_piece WHERE id = ${pieceId}
          RETURNING fichier_url AS key`.execute(trx);
        return rows[0]?.key ?? null;
      } catch (error) {
        translate(error);
      }
    });
  }

  // Soumission (étape 1 → 2) par la fonction de workflow, dans le contexte du praticien
  submit(sub: string): Promise<SubmitResult> {
    return inZone(this.db, sub, async (trx) => {
      const dossier = await this.openDossier(trx);
      const missing = await this.missing(trx, dossier.id);
      if (missing.length > 0) return { status: 'missing', missing };
      try {
        await sql`SELECT sabou.dossier_transition(${dossier.id}, 'soumis', sabou.contexte_utilisateur())`.execute(
          trx,
        );
      } catch (error) {
        translate(error);
      }
      const { rows } = await sql<{ submittedAt: Date }>`
        SELECT etape_entree_le AS "submittedAt" FROM sabou.dossier_certification
         WHERE id = ${dossier.id}`.execute(trx);
      return {
        status: 'submitted',
        code: dossier.code,
        submittedAt: rows[0]!.submittedAt.toISOString(),
      };
    });
  }

  // Dossier en cours du praticien, à l'étape 1 (sinon : verrouillé)
  private async openDossier(trx: ZoneTrx): Promise<{ id: number; code: string }> {
    const { rows } = await sql<{ id: number | null; code: string; etape: number }>`
      SELECT d.id::int, d.code, d.etape_courante::int AS etape
        FROM sabou.praticien p
        LEFT JOIN sabou.dossier_certification d ON d.praticien_id = p.id AND d.statut = 'en_cours'
       WHERE p.utilisateur_id = sabou.contexte_utilisateur()`.execute(trx);
    const row = rows[0];
    if (!row) throw new NoProfileError();
    if (row.id === null) throw new NoDossierError();
    if (row.etape !== 1) throw new DossierLockedError();
    return { id: row.id, code: row.code };
  }

  private async missing(trx: ZoneTrx, dossierId: number): Promise<PractitionerPieceType[]> {
    const { rows } = await sql<{ missing: PractitionerPieceType[] }>`
      SELECT sabou.dossier_pieces_manquantes(${dossierId}) AS missing`.execute(trx);
    return rows[0]?.missing ?? [];
  }

  // Dossier en cours, sinon le plus récent
  private async currentDossier(
    trx: ZoneTrx,
    praticienId: number,
  ): Promise<PractitionerDossier['dossier']> {
    const { rows } = await sql<{
      id: number;
      code: string;
      etape: number;
      statut: string;
      ouvertLe: Date;
    }>`
      SELECT id::int, code, etape_courante::int AS etape, statut, ouvert_le AS "ouvertLe"
        FROM sabou.dossier_certification WHERE praticien_id = ${praticienId}
       ORDER BY (statut = 'en_cours') DESC, ouvert_le DESC LIMIT 1`.execute(trx);
    const dossier = rows[0];
    if (!dossier) return null;
    const pieces = await sql<Omit<DossierPiece, 'deposeLe'> & { deposeLe: Date }>`
      SELECT id::int, type, type_mime AS "typeMime", taille_octets AS "tailleOctets",
             depose_le AS "deposeLe"
        FROM sabou.dossier_piece WHERE dossier_id = ${dossier.id} ORDER BY id`.execute(trx);
    return {
      code: dossier.code,
      etape: dossier.etape,
      statut: dossier.statut,
      ouvertLe: dossier.ouvertLe.toISOString(),
      pieces: pieces.rows.map((piece) => ({ ...piece, deposeLe: piece.deposeLe.toISOString() })),
      piecesManquantes: await this.missing(trx, dossier.id),
    };
  }
}
