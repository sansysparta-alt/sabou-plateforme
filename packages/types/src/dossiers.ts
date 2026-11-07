import { z } from 'zod';

// Dossier de certification du praticien (US-040a, 05_Choix_Techniques.md §2.26)

// Pièces que le praticien dépose lui-même ; le compte rendu de visite appartient au
// préfectoral (R-CER-06)
export const PRACTITIONER_PIECE_TYPES = ['identite', 'photo', 'justificatif', 'autre'] as const;
export type PractitionerPieceType = (typeof PRACTITIONER_PIECE_TYPES)[number];
export const pieceTypeSchema = z.enum(PRACTITIONER_PIECE_TYPES);

// Obligatoires à la soumission (décision du maître d'œuvre du 7 novembre 2026), dans
// l'ordre de la base (dossier_pieces_manquantes)
export const REQUIRED_PIECE_TYPES = [
  'identite',
  'photo',
] as const satisfies readonly PractitionerPieceType[];

export const PIECE_LABELS: Record<PractitionerPieceType, string> = {
  identite: 'Pièce d’identité',
  photo: 'Photo du praticien',
  justificatif: 'Justificatif',
  autre: 'Autre pièce',
};

// Formats acceptés, reconnus au contenu du fichier (pas à son nom ni à l'en-tête envoyé)
export const PIECE_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type PieceMimeType = (typeof PIECE_MIME_TYPES)[number];
export const PIECE_MAX_BYTES = 5 * 1024 * 1024;

// Fiche du praticien : identité professionnelle et localité (UC-20, étape 1)
export const practitionerProfileSchema = z.strictObject({
  specialiteId: z.number().int().positive(),
  prefectureId: z.number().int().positive(),
  sousPrefectureId: z.number().int().positive().nullable().default(null),
  languePrincipale: z.string().regex(/^[a-z]{2,3}$/, 'Langue inconnue.'),
  anneesExperience: z
    .number()
    .int()
    .min(0, 'L’expérience se compte en années, de 0 à 80.')
    .max(80, 'L’expérience se compte en années, de 0 à 80.'),
});
export type PractitionerProfile = z.output<typeof practitionerProfileSchema>;
export type PractitionerProfileInput = z.input<typeof practitionerProfileSchema>;

export interface DossierPiece {
  id: number;
  type: PractitionerPieceType | 'compte_rendu_visite';
  typeMime: PieceMimeType | null;
  tailleOctets: number | null;
  deposeLe: string;
}

// Ce que le praticien voit de son dossier
export interface PractitionerDossier {
  praticien: { code: string; statut: string } & PractitionerProfile;
  dossier: {
    code: string;
    etape: number;
    statut: string;
    ouvertLe: string;
    pieces: DossierPiece[];
    piecesManquantes: PractitionerPieceType[];
  } | null;
}

// Accusé de réception de la soumission (critère 1 de US-040)
export interface SubmissionReceipt {
  code: string;
  etape: 2;
  soumisLe: string;
}

export type DossierErrorCode =
  | 'invalid'
  | 'no_profile'
  | 'no_dossier'
  | 'rejection_delay'
  | 'missing_pieces'
  | 'locked'
  | 'unsupported_file'
  | 'too_large';

export interface DossierError {
  error: DossierErrorCode;
  message: string;
  // missing_pieces : liste des pièces obligatoires manquantes (critère 2 de US-040)
  piecesManquantes?: PractitionerPieceType[];
}
