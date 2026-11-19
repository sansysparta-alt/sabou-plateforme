import { z } from 'zod';

// Signalements de danger et d'effets indésirables (US-100, UC-08, UC-54, R-SAN-01 à 03).
// Dépôt public sans compte (page /signaler du site), traitement par le Comité scientifique.

export const HEALTH_REPORT_TYPES = ['danger', 'effet_indesirable'] as const;
export type HealthReportType = (typeof HEALTH_REPORT_TYPES)[number];

export const HEALTH_REPORT_SEVERITIES = ['faible', 'moyenne', 'grave'] as const;
export type HealthReportSeverity = (typeof HEALTH_REPORT_SEVERITIES)[number];

export const HEALTH_REPORT_DECISIONS = [
  'aucune_action',
  'revision',
  'suspension',
  'retrait',
] as const;
export type HealthReportDecision = (typeof HEALTH_REPORT_DECISIONS)[number];

// Délai cible d'un signalement grave (R-SAN-03)
export const SEVERE_REPORT_HOURS = 24;

// Code d'un traitement (REC-0001) ou d'une plante (PL-001), tel qu'on le lit sur le site
export const healthReportObjectCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^(REC|PL)-\d{3,10}$/, 'Indiquez le code du traitement (REC-…) ou de la plante (PL-…).');

export const healthReportRequestSchema = z
  .object({
    type: z.enum(HEALTH_REPORT_TYPES, { message: 'Choisissez le type de signalement.' }),
    code: healthReportObjectCodeSchema,
    gravite: z.enum(HEALTH_REPORT_SEVERITIES, { message: 'Choisissez la gravité.' }),
    description: z
      .string()
      .trim()
      .min(10, 'Décrivez ce qui s’est passé (10 caractères au moins).')
      .max(2000, 'La description est limitée à 2 000 caractères.'),
    contact: z
      .string()
      .trim()
      .max(120, 'Le contact est limité à 120 caractères.')
      .optional()
      .transform((value) => (value ? value : undefined)),
    // Leurre : champ caché aux personnes, rempli par les robots (05 §2.83)
    site: z.string().optional(),
  })
  .strict();
export type HealthReportRequest = z.input<typeof healthReportRequestSchema>;

export interface HealthReportReceipt {
  reference: string;
}

// Élément de la file du Comité
export interface HealthReportItem {
  code: string; // référence SIG-00001
  type: HealthReportType;
  gravite: HealthReportSeverity;
  objetType: 'recette' | 'plante' | 'produit';
  objetCode: string;
  objetNom: string;
  objetStatut: string;
  praticienNom: string | null;
  prefecture: string | null;
  description: string;
  contact: string | null;
  recuLe: string;
  // Échéance du délai cible (signalement grave seulement)
  echeance: string | null;
  enRetard: boolean;
}

export const healthReportDecisionSchema = z
  .object({
    decision: z.enum(HEALTH_REPORT_DECISIONS, { message: 'Choisissez une décision.' }),
    motif: z
      .string()
      .trim()
      .min(1, 'Indiquez le motif de la décision.')
      .max(1000, 'Le motif est limité à 1 000 caractères.'),
  })
  .strict();
export type HealthReportDecisionRequest = z.input<typeof healthReportDecisionSchema>;

export const healthReportReferenceSchema = z
  .string()
  .regex(/^SIG-\d{5,10}$/, 'Référence de signalement invalide.');

// Traitement suspendu, en attente de la levée ou du retrait par le Comité
export interface SuspendedTreatment {
  code: string;
  titreFr: string;
  praticienNom: string;
  suspenduLe: string;
  motif: string | null;
}

export const suspensionLiftSchema = z
  .object({
    motif: z
      .string()
      .trim()
      .min(1, 'Indiquez le motif de la levée.')
      .max(1000, 'Le motif est limité à 1 000 caractères.'),
  })
  .strict();
