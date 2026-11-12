import { z } from 'zod';

// Décisions du workflow de certification aux étapes 2 à 5 (US-042 ; US-043 et US-044
// reprennent le même appel). Qui peut décider, à quelle étape et dans quelle zone : la base
// le contrôle (dossier_transition, R-CER-01 à 03), jamais le client.

// Code d'un dossier de certification (DS-1041)
export const dossierCodeSchema = z.string().regex(/^DS-\d{1,10}$/, 'Code de dossier invalide.');

export const MOTIF_MAX_LENGTH = 1000;

export const dossierDecisionSchema = z
  .object({
    // Étape vue à l'écran : si le dossier a bougé entre-temps, la décision est refusée
    // au lieu de s'appliquer à une autre étape
    etape: z.number().int().min(2).max(5),
    decision: z.enum(['valide', 'rejete']),
    motif: z
      .string()
      .trim()
      .max(MOTIF_MAX_LENGTH, `Le motif ne doit pas dépasser ${MOTIF_MAX_LENGTH} caractères.`)
      .optional(),
  })
  .strict()
  .refine((input) => input.decision !== 'rejete' || Boolean(input.motif), {
    message: 'Le motif du rejet est obligatoire.',
    path: ['motif'],
  })
  // Une validation ne porte pas de motif : rien n'est enregistré sans raison
  .refine((input) => input.decision !== 'valide' || input.motif === undefined, {
    message: 'Une validation ne porte pas de motif.',
    path: ['motif'],
  });
export type DossierDecision = z.infer<typeof dossierDecisionSchema>;

export interface DossierDecisionResult {
  code: string;
  // Étape où le dossier attend désormais une décision
  etape: number;
}

// Dossier en attente de vérification terrain (étape 2), dans la zone du compte
export interface FieldVerificationItem {
  code: string;
  praticien: string;
  praticienNom: string;
  specialite: string;
  type: 'initial' | 'renouvellement';
  // Arrivée à l'étape 2 (date de soumission)
  soumisLe: string;
  // Une visite sur place est exigée (toujours pour un dossier initial, R-QR-07)
  visiteRequise: boolean;
  // Une visite réalisée, avec son compte rendu signé, est enregistrée (R-CER-06)
  visiteRealisee: boolean;
}
