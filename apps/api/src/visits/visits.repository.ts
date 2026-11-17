import { Inject, Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import type { FieldVisit, FieldVisitReport } from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone, type ZoneTrx } from '../database/zone';
import { normalizeNotes, reportFingerprint } from './visit-report';

// Refus traduits en réponses par le contrôleur
export class VisitDossierNotFoundError extends Error {}
export class VisitNotAllowedError extends Error {}
// Le dossier n'est plus à l'étape 2, ou la visite vue à l'écran a changé
export class VisitStaleError extends Error {}
export class VisitDateError extends Error {}
export class VisitPhotoError extends Error {}

// Messages des fonctions visite_* (migration 20261113120000) ; chaque branche est couverte
// par un test sur un vrai PostgreSQL (packages/db/test/visites-terrain.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (message.includes('non habilité pour les visites')) throw new VisitNotAllowedError();
  if (message.includes('seulement à l')) throw new VisitStaleError();
  if (message.includes('aucune visite planifiée')) throw new VisitStaleError();
  if (message.includes('hors des 90 prochains jours')) throw new VisitDateError();
  if (message.includes('entre la soumission et aujourd')) throw new VisitDateError();
  if (message.includes('photo possible une seule fois')) throw new VisitPhotoError();
  throw error;
}

// Visite d'un dossier telle que l'écran la montre : la planifiée, sinon la dernière
// réalisée. Heures de Conakry (UTC) ; heure de signature en ISO 8601.
export const visitOf = (dossierId: RawBuilder<unknown>) => sql<FieldVisit | null>`
  (SELECT json_build_object(
            'id', vt.id::int,
            'statut', vt.statut,
            'prevueLe', to_char(vt.prevue_le AT TIME ZONE 'Africa/Conakry', 'YYYY-MM-DD"T"HH24:MI'),
            'rappelEnvoye', vt.rappel_envoye_le IS NOT NULL,
            'realiseeLe', to_char(vt.realisee_le AT TIME ZONE 'Africa/Conakry', 'YYYY-MM-DD'),
            'avis', vt.avis,
            'signePar', su.prenom || ' ' || su.nom,
            'signeLe', to_char(vt.signe_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'empreinte', vt.empreinte_sha3,
            'photo', vt.compte_rendu_piece_id IS NOT NULL)
     FROM sabou.visite_terrain vt
     LEFT JOIN sabou.utilisateur su ON su.id = vt.signe_par
    WHERE vt.dossier_id = ${dossierId} AND vt.statut IN ('planifiee', 'realisee')
    ORDER BY vt.statut = 'planifiee' DESC, vt.realisee_le DESC NULLS LAST, vt.id DESC
    LIMIT 1)`;

export interface VisitPhoto {
  key: string;
  sha256: string;
  mime: string;
  size: number;
}

// Visites terrain (US-041). La base contrôle l'acteur (préfectoral de la préfecture du
// praticien), l'étape du dossier, les dates et le compte rendu ; elle écrit le journal
// d'audit dans la même transaction.
@Injectable()
export class VisitsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // Ouvre le contexte du compte, trace son adresse IP et verrouille le dossier ; hors zone,
  // le dossier est invisible (RLS) : on ne dit pas s'il existe
  private inDossier<T>(
    sub: string,
    ip: string | undefined,
    code: string,
    work: (trx: ZoneTrx, dossier: { id: number; acteur: number }) => Promise<T>,
  ): Promise<T> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const { rows } = await sql<{ id: number; acteur: number }>`
        SELECT id::int, sabou.contexte_utilisateur()::int AS acteur
          FROM sabou.dossier_certification WHERE code = ${code} FOR UPDATE`.execute(trx);
      if (!rows[0]) throw new VisitDossierNotFoundError();
      try {
        return await work(trx, rows[0]);
      } catch (error) {
        translate(error);
      }
    });
  }

  private async read(trx: ZoneTrx, dossierId: number): Promise<FieldVisit> {
    const { rows } = await sql<{ visite: FieldVisit }>`
      SELECT ${visitOf(sql`${dossierId}`)} AS visite`.execute(trx);
    return rows[0]!.visite;
  }

  // prevueLe : heure de Conakry, telle que saisie (2026-11-20T09:30)
  plan(sub: string, ip: string | undefined, code: string, prevueLe: string): Promise<FieldVisit> {
    return this.inDossier(sub, ip, code, async (trx, dossier) => {
      await sql`
        SELECT sabou.visite_planifier(${dossier.id}, ${dossier.acteur},
                 ${prevueLe}::timestamp AT TIME ZONE 'Africa/Conakry')`.execute(trx);
      return this.read(trx, dossier.id);
    });
  }

  // Signature du compte rendu : l'empreinte porte sur le texte tel qu'il est enregistré
  report(
    sub: string,
    ip: string | undefined,
    code: string,
    input: FieldVisitReport,
  ): Promise<FieldVisit> {
    return this.inDossier(sub, ip, code, async (trx, dossier) => {
      const constats = normalizeNotes(input.constats);
      const empreinte = reportFingerprint({
        dossier: code,
        visite: input.visite,
        realiseeLe: input.realiseeLe,
        avis: input.avis,
        auteur: dossier.acteur,
        constats,
      });
      await sql`
        SELECT sabou.visite_realiser(${dossier.id}, ${dossier.acteur}, ${input.visite},
                 ${input.realiseeLe}::date, ${constats}, ${input.avis}, ${empreinte})`.execute(trx);
      return this.read(trx, dossier.id);
    });
  }

  // Photo de la fiche papier, déjà déposée dans le stockage
  attachPhoto(
    sub: string,
    ip: string | undefined,
    code: string,
    visite: number,
    photo: VisitPhoto,
  ): Promise<FieldVisit> {
    return this.inDossier(sub, ip, code, async (trx, dossier) => {
      await sql`
        SELECT sabou.visite_photo_joindre(${dossier.id}, ${dossier.acteur}, ${visite},
                 ${photo.key}, ${photo.sha256}, ${photo.mime}, ${photo.size})`.execute(trx);
      return this.read(trx, dossier.id);
    });
  }
}
