import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  toNationalMobile,
  type DossierPiece,
  type FieldDossier,
  type FieldDossierCreate,
  type FieldDossierDesignations,
  type FieldDossierReferentials,
  type PractitionerPieceType,
} from '@sabou/types';
import { AUDIT_LOG, normalizeIp, type AuditLog } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone, type ZoneTrx } from '../database/zone';
import type { NewPiece } from '../dossiers/dossiers.repository';

// Refus de la base, traduits par le service
export class FieldDossierForbiddenError extends Error {}
export class FieldDossierNotFoundError extends Error {}
export class PhoneTakenError extends Error {}
export class InvalidFieldReferenceError extends Error {}
export class DesignationForbiddenError extends Error {}
export class AgentNotDesignableError extends Error {}

function translate(error: unknown): never {
  const { code, constraint } = error as { code?: string; constraint?: string };
  if (constraint === 'ux_utilisateur_telephone_public') throw new PhoneTakenError();
  if (code === '42501') throw new FieldDossierForbiddenError();
  // Spécialité, sous-préfecture ou langue inconnue ou d'une autre préfecture
  if (code === '23503' || code === '23514' || code === 'P0001') {
    throw new InvalidFieldReferenceError();
  }
  throw error;
}

export type FieldSubmitResult =
  | { status: 'submitted'; code: string; submittedAt: string }
  | { status: 'missing'; missing: PractitionerPieceType[] };

// Dossier terrain (US-040c), toujours dans le contexte de l'agent : la base vérifie le rôle,
// la préfecture et l'auteur du dossier (20261118120000_dossier_terrain.sql). Un dossier hors
// de sa zone, ou créé par un autre, est « introuvable » : on ne dit pas s'il existe.
@Injectable()
export class FieldDossiersRepository {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  // Compte, fiche, dossier, SMS d'invitation et ligne d'audit en une transaction
  open(
    sub: string,
    ip: string | undefined,
    keycloakId: string,
    input: FieldDossierCreate,
  ): Promise<{ code: string }> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      try {
        const { rows } = await sql<{ id: number; code: string; agent: number }>`
          SELECT dossier_id::int AS id, dossier_code AS code,
                 sabou.contexte_utilisateur()::int AS agent
            FROM sabou.dossier_terrain_ouvrir(
              ${keycloakId}::uuid, ${`+224${input.telephone}`}, ${input.prenom}, ${input.nom},
              ${input.specialiteId}::smallint, ${input.sousPrefectureId}::smallint,
              ${input.languePrincipale}, ${input.anneesExperience}::smallint)`.execute(trx);
        const created = rows[0]!;
        await this.audit.record(
          {
            action: 'dossier.terrain_cree',
            objectType: 'dossier',
            objectId: created.code,
            account: sub,
            userId: created.agent,
            ip,
            details: { praticien: keycloakId },
          },
          trx,
        );
        return { code: created.code };
      } catch (error) {
        translate(error);
      }
    });
  }

  // Listes du formulaire, valeurs actives ; sous-préfectures de la préfecture de l'agent
  referentials(sub: string): Promise<FieldDossierReferentials> {
    return inZone(this.db, sub, async (trx) => {
      const prefecture = await sql<{ nom: string }>`
        SELECT pf.nom FROM sabou.utilisateur u JOIN sabou.prefecture pf ON pf.id = u.prefecture_id
         WHERE u.id = sabou.contexte_utilisateur() AND u.role_code = 'prefectoral'`.execute(trx);
      if (!prefecture.rows[0]) throw new FieldDossierForbiddenError();
      const specialites = await sql<FieldDossierReferentials['specialites'][number]>`
        SELECT id, libelle_fr AS libelle FROM sabou.specialite WHERE active ORDER BY libelle_fr`.execute(
        trx,
      );
      const sousPrefectures = await sql<FieldDossierReferentials['sousPrefectures'][number]>`
        SELECT sp.id, sp.nom FROM sabou.sous_prefecture sp
          JOIN sabou.utilisateur u ON u.prefecture_id = sp.prefecture_id
         WHERE u.id = sabou.contexte_utilisateur() AND sp.active ORDER BY sp.nom`.execute(trx);
      const langues = await sql<FieldDossierReferentials['langues'][number]>`
        SELECT code, nom_fr AS nom FROM sabou.langue WHERE active ORDER BY ordre, code`.execute(
        trx,
      );
      return {
        prefecture: prefecture.rows[0].nom,
        specialites: specialites.rows,
        sousPrefectures: sousPrefectures.rows,
        langues: langues.rows,
      };
    });
  }

  // Dossiers terrain de l'agent encore à constituer (étape 1), du plus récent au plus ancien
  list(sub: string): Promise<FieldDossier[]> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<{
        id: number;
        code: string;
        praticien: string;
        telephone: string;
        specialite: string;
        creeLe: Date;
      }>`
        SELECT d.id::int, d.code, u.prenom || ' ' || u.nom AS praticien, u.telephone,
               s.libelle_fr AS specialite, d.ouvert_le AS "creeLe"
          FROM sabou.dossier_certification d
          JOIN sabou.praticien p ON p.id = d.praticien_id
          JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
          JOIN sabou.specialite s ON s.id = p.specialite_id
         WHERE d.cree_par = sabou.contexte_utilisateur()
           AND d.statut = 'en_cours' AND d.etape_courante = 1
         ORDER BY d.ouvert_le DESC, d.id DESC`.execute(trx);
      const dossiers: FieldDossier[] = [];
      for (const { id, creeLe, telephone, ...row } of rows) {
        dossiers.push({
          ...row,
          telephone: toNationalMobile(telephone) ?? telephone,
          creeLe: creeLe.toISOString(),
          ...(await this.pieces(trx, id)),
        });
      }
      return dossiers;
    });
  }

  addPiece(sub: string, code: string, piece: NewPiece): Promise<{ id: number }> {
    return this.inDossier(sub, code, async (trx, dossierId) => {
      const { rows } = await sql<{ id: number }>`
        INSERT INTO sabou.dossier_piece (dossier_id, type, fichier_url, sha256, depose_par,
                                         type_mime, taille_octets)
        VALUES (${dossierId}, ${piece.type}, ${piece.key}, ${piece.sha256},
                sabou.contexte_utilisateur(), ${piece.mime}, ${piece.size})
        RETURNING id::int`.execute(trx);
      return { id: rows[0]!.id };
    });
  }

  // Clé du fichier retiré, ou null si la pièce n'est pas dans ce dossier
  removePiece(sub: string, code: string, pieceId: number): Promise<string | null> {
    return this.inDossier(sub, code, async (trx, dossierId) => {
      const { rows } = await sql<{ key: string }>`
        DELETE FROM sabou.dossier_piece WHERE id = ${pieceId} AND dossier_id = ${dossierId}
        RETURNING fichier_url AS key`.execute(trx);
      return rows[0]?.key ?? null;
    });
  }

  // Soumission (étape 1 → 2) par l'agent, au nom duquel elle est historisée ; le praticien
  // est prévenu par SMS (file de notifications, même transaction)
  submit(sub: string, ip: string | undefined, code: string): Promise<FieldSubmitResult> {
    return this.inDossier(sub, code, async (trx, dossierId) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const { rows: missing } = await sql<{ missing: PractitionerPieceType[] }>`
        SELECT sabou.dossier_pieces_manquantes(${dossierId}) AS missing`.execute(trx);
      if ((missing[0]?.missing ?? []).length > 0) {
        return { status: 'missing', missing: missing[0]!.missing };
      }
      await sql`SELECT sabou.dossier_transition(${dossierId}, 'soumis', sabou.contexte_utilisateur())`.execute(
        trx,
      );
      const { rows } = await sql<{ submittedAt: Date }>`
        SELECT etape_entree_le AS "submittedAt" FROM sabou.dossier_certification
         WHERE id = ${dossierId}`.execute(trx);
      return { status: 'submitted', code, submittedAt: rows[0]!.submittedAt.toISOString() };
    });
  }

  // Dossier terrain de l'agent, à l'étape 1, verrouillé pour la durée de la transaction
  private inDossier<T>(
    sub: string,
    code: string,
    work: (trx: ZoneTrx, dossierId: number) => Promise<T>,
  ): Promise<T> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        SELECT id::int FROM sabou.dossier_certification
         WHERE code = ${code} AND cree_par = sabou.contexte_utilisateur()
           AND statut = 'en_cours' AND etape_courante = 1
           FOR UPDATE`.execute(trx);
      if (!rows[0]) throw new FieldDossierNotFoundError();
      try {
        return await work(trx, rows[0].id);
      } catch (error) {
        translate(error);
      }
    });
  }

  private async pieces(
    trx: ZoneTrx,
    dossierId: number,
  ): Promise<{ pieces: DossierPiece[]; piecesManquantes: PractitionerPieceType[] }> {
    const pieces = await sql<Omit<DossierPiece, 'deposeLe'> & { deposeLe: Date }>`
      SELECT id::int, type, type_mime AS "typeMime", taille_octets AS "tailleOctets",
             depose_le AS "deposeLe"
        FROM sabou.dossier_piece WHERE dossier_id = ${dossierId} ORDER BY id`.execute(trx);
    const missing = await sql<{ missing: PractitionerPieceType[] }>`
      SELECT sabou.dossier_pieces_manquantes(${dossierId}) AS missing`.execute(trx);
    return {
      pieces: pieces.rows.map((p) => ({ ...p, deposeLe: p.deposeLe.toISOString() })),
      piecesManquantes: missing.rows[0]?.missing ?? [],
    };
  }

  // US-040d : dossiers terrain de la région du régional aux étapes 1 et 2 (cloisonnement de la
  // base) et agents préfectoraux actifs de sa région
  designations(sub: string): Promise<FieldDossierDesignations> {
    return inZone(this.db, sub, async (trx) => {
      const regional = await sql<{ region: number }>`
        SELECT region_admin_id AS region FROM sabou.utilisateur
         WHERE id = sabou.contexte_utilisateur() AND role_code = 'regional'`.execute(trx);
      if (!regional.rows[0]) throw new DesignationForbiddenError();
      const dossiers = await sql<{
        code: string;
        praticien: string;
        prefecture: string;
        etape: number;
        auteur: string;
        auteurId: number;
        verificateurId: number | null;
        verificateurNom: string | null;
        verificateurPrefecture: string | null;
      }>`
        SELECT d.code, u.prenom || ' ' || u.nom AS praticien, pf.nom AS prefecture,
               d.etape_courante AS etape, a.prenom || ' ' || a.nom AS auteur, a.id::int AS "auteurId",
               v.id::int AS "verificateurId", v.prenom || ' ' || v.nom AS "verificateurNom",
               vp.nom AS "verificateurPrefecture"
          FROM sabou.dossier_certification d
          JOIN sabou.praticien p   ON p.id = d.praticien_id
          JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
          JOIN sabou.prefecture pf ON pf.id = p.prefecture_id
          JOIN sabou.utilisateur a ON a.id = d.cree_par
          LEFT JOIN sabou.utilisateur v ON v.id = d.verificateur_designe
          LEFT JOIN sabou.prefecture vp ON vp.id = v.prefecture_id
         WHERE d.statut = 'en_cours' AND d.etape_courante <= 2
           AND pf.region_admin_id = ${regional.rows[0].region}
         ORDER BY d.etape_entree_le, d.id`.execute(trx);
      const agents = await sql<FieldDossierDesignations['agents'][number]>`
        SELECT u.id::int, u.prenom || ' ' || u.nom AS nom, pf.nom AS prefecture
          FROM sabou.utilisateur u JOIN sabou.prefecture pf ON pf.id = u.prefecture_id
         WHERE u.role_code = 'prefectoral' AND u.statut = 'actif'
           AND pf.region_admin_id = ${regional.rows[0].region}
         ORDER BY pf.nom, u.nom, u.prenom`.execute(trx);
      return {
        dossiers: dossiers.rows.map(
          ({ verificateurId, verificateurNom, verificateurPrefecture, ...row }) => ({
            ...row,
            verificateur:
              verificateurId === null
                ? null
                : {
                    id: verificateurId,
                    nom: verificateurNom!,
                    prefecture: verificateurPrefecture!,
                  },
          }),
        ),
        agents: agents.rows,
      };
    });
  }

  // Désignation par le régional ; la base contrôle rôle, région, auteur, étape et journalise
  designate(sub: string, ip: string | undefined, code: string, agentId: number): Promise<void> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      try {
        await sql`SELECT sabou.dossier_verificateur_designer(${code}, ${agentId}::bigint)`.execute(
          trx,
        );
      } catch (error) {
        const { code: sqlState, message } = error as { code?: string; message?: string };
        if (sqlState === '42501') throw new DesignationForbiddenError();
        if (message?.includes('introuvable') || message?.includes('dossiers terrain')) {
          throw new FieldDossierNotFoundError();
        }
        if (message?.includes('étapes 1 et 2') || message?.includes('non désignable')) {
          throw new AgentNotDesignableError();
        }
        throw error;
      }
    });
  }
}
