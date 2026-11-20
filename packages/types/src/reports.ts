import { z } from 'zod';

// Rapports mensuels et historique des exports (US-091, UC-36, UC-67, R-MOD-09 ; 05 §2.91).
// Le contenu d'un rapport est calculé dans la base (fonctions rapport_contenu_*), aux droits
// de son auteur : les chiffres sont ceux de sa zone.

export const REPORT_COMMENT_MAX_LENGTH = 4000;
export const REPORT_MOTIF_MAX_LENGTH = 1000;

export const reportIdSchema = z.coerce.number().int().positive();

// Mois rapporté : premier jour du mois (AAAA-MM-01) ; la base n'accepte qu'un mois écoulé
export const reportPrepareSchema = z
  .object({ mois: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, 'Choisissez le mois.') })
  .strict();

export const reportCommentSchema = z
  .object({
    commentaire: z
      .string()
      .trim()
      .max(REPORT_COMMENT_MAX_LENGTH, `${REPORT_COMMENT_MAX_LENGTH} caractères au plus.`),
  })
  .strict();

// Envoi : heure du calcul lue à l'écran (le rapport n'est envoyé que s'il n'a pas changé)
export const reportSendSchema = z.object({ calculeLe: z.iso.datetime() }).strict();

export const reportReturnSchema = z
  .object({
    motif: z
      .string()
      .trim()
      .min(1, 'Indiquez ce qui doit être revu.')
      .max(REPORT_MOTIF_MAX_LENGTH, `${REPORT_MOTIF_MAX_LENGTH} caractères au plus.`),
  })
  .strict();

export type ReportLevel = 'prefectoral' | 'regional';
export type ReportStatus = 'brouillon' | 'envoye' | 'renvoye';

// Délais d'une étape sur le mois (objectif de 3 jours, R-CER-07)
export interface ReportDelays {
  passages: number;
  valides: number;
  renvoyes: number;
  // null sans passage
  moyenneJours: number | null;
  horsDelai: number;
  objectifJours: number;
}

export interface BlockedDossierLine {
  dossier: string;
  etape: number;
  // ISO 8601, UTC
  depuis: string;
}

export interface PrefectoralReportContent {
  activite: {
    nouveauxPraticiens: number;
    dossiersSoumis: number;
    visitesRealisees: number;
    recettesNumerisees: number;
    praticiensPublies: number;
  };
  // Étape 2 : vérification sur le terrain
  delais: ReportDelays;
  anomalies: { dossiersBloques: BlockedDossierLine[]; alertesOuvertes: number };
  registre: { enregistres: number; certifies: number; enAttente: number };
}

// Une préfecture dans le rapport régional : son rapport reçu, renvoyé ou manquant
export interface RegionalReportPrefecture {
  prefecture: string;
  rapport: 'recu' | 'renvoye' | 'manquant';
  version: number | null;
  envoyeLe: string | null;
  activite: PrefectoralReportContent['activite'] | null;
  delais: ReportDelays | null;
  commentaire: string | null;
}

export interface RegionalReportContent {
  activite: { litigesOuverts: number; litigesResolus: number; traitementsTransmis: number };
  // Étape 3 : consolidation
  delais: ReportDelays;
  anomalies: {
    dossiersBloques: BlockedDossierLine[];
    alertesOuvertes: number;
    rapportsManquants: number;
  };
  couverture: { prefectures: number; couvertes: number };
  prefectures: RegionalReportPrefecture[];
}

export interface MonthlyReportSummary {
  id: number;
  niveau: ReportLevel;
  // Préfecture (rapport préfectoral) ou région (rapport régional)
  zone: string;
  // Premier jour du mois, AAAA-MM-JJ
  mois: string;
  version: number;
  statut: ReportStatus;
  auteur: string;
  envoyeLe: string | null;
  renvoyeLe: string | null;
}

export interface MonthlyReport extends MonthlyReportSummary {
  contenu: PrefectoralReportContent | RegionalReportContent;
  commentaire: string | null;
  // Heure du dernier calcul (ISO 8601, UTC) : renvoyée à l'envoi, refusé si elle a changé
  calculeLe: string;
  renvoiMotif: string | null;
  // Versions précédentes du même mois (renvoyées), les plus récentes d'abord
  versions: { id: number; version: number; renvoiMotif: string | null; renvoyeLe: string | null }[];
  // Ce que le compte connecté peut faire de ce rapport
  peutModifier: boolean;
  peutRenvoyer: boolean;
}

export interface MonthlyReportList {
  // Rapports rédigés par le compte (sa zone) et rapports reçus, les plus récents d'abord
  miens: MonthlyReportSummary[];
  recus: MonthlyReportSummary[];
  // Peut rédiger un rapport (préfectoral, régional) ; mois proposés (AAAA-MM-JJ), le plus récent d'abord
  peutRediger: boolean;
  moisPossibles: string[];
}

export type ExportType = 'tableau_de_bord' | 'rapport_mensuel';
export type ExportFormat = 'pdf' | 'xlsx';

// Rapport mensuel exporté : obligatoire pour « rapport_mensuel », interdit sinon
export const exportRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tableau_de_bord'), format: z.enum(['pdf', 'xlsx']) }).strict(),
  z
    .object({
      type: z.literal('rapport_mensuel'),
      format: z.enum(['pdf', 'xlsx']),
      rapport: z.number().int().positive(),
    })
    .strict(),
]);
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export const exportIdSchema = z.coerce.number().int().positive();

export interface ExportEntry {
  id: number;
  type: ExportType;
  format: ExportFormat;
  // Libellé en clair (ex. « Tableau de bord · Labé », « Rapport mensuel · Labé · octobre 2026 »)
  objet: string;
  auteur: string;
  // ISO 8601, UTC
  le: string;
}
