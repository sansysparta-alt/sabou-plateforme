import { z } from 'zod';

// Rejet définitif d'un praticien par la Direction Générale (US-047, UC-61, R-CER-04).
// Décisions du maître d'œuvre des 12 et 14 novembre 2026 (05_Choix_Techniques.md §2.36).
// Qui peut rejeter et ce que le rejet entraîne : la base le contrôle (praticien_rejeter).

export const REJECTION_MOTIVES = [
  'fraude_documentaire',
  'usurpation_identite',
  'pratique_dangereuse',
] as const;
export type RejectionMotive = (typeof REJECTION_MOTIVES)[number];

export const REJECTION_DETAIL_MAX_LENGTH = 1000;
export const COMMITTEE_REFERENCE_MAX_LENGTH = 100;
export const REJECTION_SEARCH_MIN_LENGTH = 2;
export const REJECTION_SEARCH_MAX_LENGTH = 100;

// Code d'un praticien : PR-1042
export const practitionerCodeSchema = z
  .string()
  .regex(/^PR-\d{1,10}$/, 'Code de praticien invalide.');

// Recherche : nom, code praticien, code de dossier ou numéro de certificat
export const rejectionSearchSchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(REJECTION_SEARCH_MIN_LENGTH, 'Saisissez au moins 2 caractères.')
      .max(REJECTION_SEARCH_MAX_LENGTH, 'Recherche trop longue.'),
  })
  .strict();
export type RejectionSearch = z.infer<typeof rejectionSearchSchema>;

// Date du calendrier réelle (refuse le 30 février)
function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const rejectionSchema = z
  .object({
    // Dossier en cours vu à l'écran (null : aucun) ; s'il a changé entre-temps, le rejet est
    // refusé au lieu de s'appliquer à une situation que la DG n'a pas vue
    dossier: z
      .string()
      .regex(/^DS-\d{1,10}$/, 'Code de dossier invalide.')
      .nullable(),
    motif: z.enum(REJECTION_MOTIVES, 'Choisissez le motif du rejet.'),
    detail: z
      .string()
      .trim()
      .min(1, 'Précisez les faits qui fondent le rejet.')
      .max(
        REJECTION_DETAIL_MAX_LENGTH,
        `La précision ne doit pas dépasser ${REJECTION_DETAIL_MAX_LENGTH} caractères.`,
      ),
    // Avis du Comité scientifique : exigé pour une pratique dangereuse, et seulement pour elle
    avisComite: z
      .object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de l’avis du Comité invalide.')
          .refine(isCalendarDate, 'Date de l’avis du Comité invalide.'),
        reference: z
          .string()
          .trim()
          .min(1, 'Indiquez la référence de l’avis du Comité.')
          .max(
            COMMITTEE_REFERENCE_MAX_LENGTH,
            `La référence ne doit pas dépasser ${COMMITTEE_REFERENCE_MAX_LENGTH} caractères.`,
          ),
      })
      .strict()
      .optional(),
    confirmation: z.literal(true, 'Cochez la confirmation pour prononcer le rejet.'),
  })
  .strict()
  .refine((input) => input.motif !== 'pratique_dangereuse' || input.avisComite !== undefined, {
    message: 'Une pratique dangereuse exige la date et la référence de l’avis du Comité.',
    path: ['avisComite'],
  })
  .refine((input) => input.motif === 'pratique_dangereuse' || input.avisComite === undefined, {
    message: 'L’avis du Comité ne concerne que la pratique dangereuse.',
    path: ['avisComite'],
  });
export type Rejection = z.infer<typeof rejectionSchema>;

// Praticien trouvé par la recherche, avec ce que le rejet entraînerait
export interface RejectionCandidate {
  praticien: string;
  nom: string;
  specialite: string;
  prefecture: string;
  region: string;
  statut: 'en_attente' | 'certifie' | 'rejete' | 'suspendu';
  // Dossier en cours, clos par le rejet
  dossier: { code: string; etape: number } | null;
  // Certificat actif, révoqué par le rejet
  certificat: string | null;
  // Traitements certifiés (suspendus par le rejet) et en cours d'examen (arrêtés)
  traitementsCertifies: number;
  traitementsEnExamen: number;
  // Dernier rejet définitif prononcé, s'il y en a un
  rejet: { le: string; motif: RejectionMotive; recoursJusquau: string } | null;
}

export interface RejectionResult {
  praticien: string;
  dossier: string | null;
  certificat: string | null;
  traitementsSuspendus: number;
  // Dernier jour du recours (heure de Conakry) : 2026-12-14
  recoursJusquau: string;
}
