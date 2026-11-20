import { z } from 'zod';

// Litiges et recours de 30 jours après un rejet définitif (US-101, UC-43, R-MOD-01, R-CER-04 ;
// 05 §2.88). Qui peut ouvrir, écrire, rendre un avis ou décider : la base le contrôle
// (fonctions litige_*), jamais le client.

export const DISPUTE_TEXT_MAX_LENGTH = 2000;
export const DISPUTE_SUBJECT_MAX_LENGTH = 200;
export const DISPUTE_TYPES = ['recours', 'autre'] as const;
export type DisputeType = (typeof DISPUTE_TYPES)[number];
export type DisputeStatus = 'ouvert' | 'en_arbitrage' | 'avis_rendu' | 'resolu';
export type DisputeIssue = 'accepte' | 'refuse';
export type DisputeOpinion = 'favorable' | 'defavorable';

// LT-00001 ; L-014 : litiges saisis avant US-101 (jeu d'exemple)
export const disputeCodeSchema = z.string().regex(/^(LT-\d{5}|L-\d{3})$/, 'Litige inconnu.');

const text = (empty: string, max = DISPUTE_TEXT_MAX_LENGTH) =>
  z.string().trim().min(1, empty).max(max, `${max} caractères au plus.`);

export const disputeOpenSchema = z
  .object({
    type: z.enum(DISPUTE_TYPES, 'Choisissez le type de litige.'),
    objet: text('Indiquez l’objet du litige.', DISPUTE_SUBJECT_MAX_LENGTH),
    message: text('Expliquez ce que vous contestez.'),
  })
  .strict();
export type DisputeOpen = z.infer<typeof disputeOpenSchema>;

export const disputeMessageSchema = z.object({ contenu: text('Écrivez votre message.') }).strict();

// Avis motivé du régional sur un recours
export const disputeOpinionSchema = z
  .object({
    sens: z.enum(['favorable', 'defavorable'], 'Choisissez le sens de l’avis.'),
    avis: text('Motivez votre avis.'),
  })
  .strict();
export type DisputeOpinionInput = z.infer<typeof disputeOpinionSchema>;

// Décision motivée : le régional pour un litige ordinaire, la DG pour un recours
export const disputeDecisionSchema = z
  .object({
    issue: z.enum(['accepte', 'refuse'], 'Choisissez la décision.'),
    motif: text('Motivez la décision.'),
  })
  .strict();
export type DisputeDecisionInput = z.infer<typeof disputeDecisionSchema>;

// Litige dans une liste (administration) ou dans l'espace du praticien
export interface DisputeSummary {
  code: string;
  type: DisputeType;
  objet: string;
  statut: DisputeStatus;
  issue: DisputeIssue | null;
  praticien: string;
  praticienNom: string;
  prefecture: string;
  // ISO 8601, UTC
  ouvertLe: string;
  // Recours : dernier jour pour le déposer (2026-12-14), rappel de la décision contestée
  recoursJusquau: string | null;
}

export interface DisputeMessage {
  id: number;
  // « praticien » ou le rôle de l'administration qui écrit
  auteur: 'praticien' | 'regional' | 'dg';
  auteurNom: string;
  contenu: string;
  le: string;
}

export interface DisputePiece {
  id: number;
  mime: string;
  taille: number;
  parPraticien: boolean;
  deposeLe: string;
}

export interface DisputeDetail extends DisputeSummary {
  messages: DisputeMessage[];
  pieces: DisputePiece[];
  // Recours : motif du rejet contesté (lu par l'administration et par le praticien)
  rejetMotif: string | null;
  avisSens: DisputeOpinion | null;
  avis: string | null;
  avisLe: string | null;
  decision: string | null;
  decideLe: string | null;
  // Recours accepté d'un praticien certifié : le nouveau certificat
  certificat: string | null;
}

// Ce que le praticien peut ouvrir : un recours dans les 30 jours de son rejet définitif
export interface PractitionerDisputes {
  recoursPossible: boolean;
  recoursJusquau: string | null;
  litiges: DisputeSummary[];
}
