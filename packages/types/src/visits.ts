import { z } from 'zod';

// Visites terrain de l'admin préfectoral (US-041, UC-30, R-MOD-02). Qui peut planifier ou
// enregistrer une visite, pour quel dossier : la base le contrôle (visite_planifier,
// visite_realiser), jamais le client. Heures et dates : heure de Conakry (UTC, sans heure d'été).

export const VISIT_NOTES_MAX_LENGTH = 5000;

export const VISIT_OPINIONS = ['favorable', 'reserve', 'defavorable'] as const;
export type VisitOpinion = (typeof VISIT_OPINIONS)[number];

// Date du calendrier réelle : refuse le 30 février, que PostgreSQL refuserait plus tard
function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// Date et heure prévues, telles que saisies (champ datetime-local) : 2026-11-20T09:30
export const fieldVisitPlanSchema = z
  .object({
    prevueLe: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Date et heure de visite invalides.')
      .refine(isCalendarDate, 'Date et heure de visite invalides.'),
  })
  .strict();
export type FieldVisitPlan = z.infer<typeof fieldVisitPlanSchema>;

// Compte rendu signé (critère 2 de US-041). L'attestation est la signature : le texte est
// figé, avec son empreinte SHA3-256, son auteur et l'heure (décision du 12 novembre 2026).
export const fieldVisitReportSchema = z
  .object({
    // Visite planifiée vue à l'écran : si elle a changé entre-temps, l'enregistrement est refusé
    visite: z.number().int().positive(),
    realiseeLe: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de visite invalide.')
      .refine(isCalendarDate, 'Date de visite invalide.'),
    avis: z.enum(VISIT_OPINIONS, 'Choisissez un avis.'),
    constats: z
      .string()
      .trim()
      .min(1, 'Décrivez ce que vous avez constaté.')
      .max(
        VISIT_NOTES_MAX_LENGTH,
        `Le compte rendu ne doit pas dépasser ${VISIT_NOTES_MAX_LENGTH} caractères.`,
      ),
    attestation: z.literal(true, 'Cochez l’attestation pour signer le compte rendu.'),
  })
  .strict();
export type FieldVisitReport = z.infer<typeof fieldVisitReportSchema>;

// Visite d'un dossier, telle que l'écran la montre : la planifiée, sinon la dernière réalisée
export interface FieldVisit {
  id: number;
  statut: 'planifiee' | 'realisee';
  // Heure de Conakry, sans fuseau : 2026-11-20T09:30
  prevueLe: string;
  rappelEnvoye: boolean;
  // Date de la visite (2026-11-20), pour une visite réalisée
  realiseeLe: string | null;
  avis: VisitOpinion | null;
  // Signataire et heure de signature (ISO 8601, UTC)
  signePar: string | null;
  signeLe: string | null;
  empreinte: string | null;
  photo: boolean;
}
