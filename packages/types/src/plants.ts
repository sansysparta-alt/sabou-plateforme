import { z } from 'zod';

// Fiches plantes du Dictionnaire (US-050, UC-05, R-PLA-01, R-PLA-02, R-PLA-04). Créées et
// modifiées par la DG et le Comité scientifique ; la base contrôle le rôle, l'unicité du
// nom scientifique et la photo principale (plante_creer, plante_image_ajouter…).

export const PLANT_SCIENTIFIC_NAME_MAX_LENGTH = 150;
export const PLANT_FAMILY_MAX_LENGTH = 100;
export const PLANT_NAME_MAX_LENGTH = 150;
export const PLANT_ALT_TEXT_MAX_LENGTH = 250;
export const PLANT_SEARCH_MAX_LENGTH = 100;
// Photo d'une fiche : 5 Mo au plus, JPEG, PNG ou WebP (format lu dans le contenu par l'API)
export const PLANT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const PLANT_STATUSES = ['en_revue', 'validee'] as const;
export type PlantStatus = (typeof PLANT_STATUSES)[number];

export const PLANT_IMAGE_TYPES = [
  'plante_entiere',
  'feuille',
  'ecorce',
  'racine',
  'produit_prepare',
  'autre',
] as const;
export type PlantImageType = (typeof PLANT_IMAGE_TYPES)[number];

// Code d'une fiche : PL-001
export const plantCodeSchema = z.string().regex(/^PL-\d{3,10}$/, 'Code de plante invalide.');

const required = (label: string, max: number) =>
  z
    .string(`${label} : champ obligatoire.`)
    .trim()
    .min(1, `${label} : champ obligatoire.`)
    .max(max, `${label} : ${max} caractères au plus.`);

// Texte facultatif : vide ou absent devient null
const optional = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} : ${max} caractères au plus.`)
    .nullish()
    .transform((value) => (value ? value : null));

export const plantFieldsSchema = z
  .object({
    nomScientifique: required('Nom scientifique', PLANT_SCIENTIFIC_NAME_MAX_LENGTH),
    famille: required('Famille', PLANT_FAMILY_MAX_LENGTH),
    nomFr: required('Nom français', PLANT_NAME_MAX_LENGTH),
    nomEn: optional('Nom anglais', PLANT_NAME_MAX_LENGTH),
  })
  .strict();
export type PlantFields = z.infer<typeof plantFieldsSchema>;

// Modification : date de dernière modification vue à l'écran (refus si la fiche a changé)
export const plantUpdateSchema = plantFieldsSchema
  .extend({ vueLe: z.iso.datetime({ offset: true, message: 'Date de lecture invalide.' }) })
  .strict();
export type PlantUpdate = z.infer<typeof plantUpdateSchema>;

// Validation par le Comité (US-051) : date de dernière modification vue à l'écran
export const plantValidationSchema = z
  .object({ vueLe: z.iso.datetime({ offset: true, message: 'Date de lecture invalide.' }) })
  .strict();
export type PlantValidation = z.infer<typeof plantValidationSchema>;

export const plantSearchSchema = z
  .object({
    q: z.string().trim().max(PLANT_SEARCH_MAX_LENGTH, 'Recherche trop longue.').optional(),
  })
  .strict();

// Description d'une photo (envoyée avec le fichier, ou pour la modifier)
export const plantImageFieldsSchema = z
  .object({
    alt: required('Texte alternatif', PLANT_ALT_TEXT_MAX_LENGTH),
    altEn: optional('Texte alternatif anglais', PLANT_ALT_TEXT_MAX_LENGTH),
    type: z.enum(PLANT_IMAGE_TYPES, 'Choisissez ce que montre la photo.'),
    principale: z.boolean(),
  })
  .strict();
export type PlantImageFields = z.infer<typeof plantImageFieldsSchema>;

// Proposition d'une plante par un praticien (US-054) : nom français obligatoire ; nom
// scientifique et famille facultatifs, complétés par le Comité avant de valider (la base refuse
// une fiche validée sans eux)
export const PLANT_DESCRIPTION_MAX_LENGTH = 1000;
export const plantProposalSchema = z
  .object({
    nomFr: required('Nom français', PLANT_NAME_MAX_LENGTH),
    nomScientifique: optional('Nom scientifique', PLANT_SCIENTIFIC_NAME_MAX_LENGTH),
    famille: optional('Famille', PLANT_FAMILY_MAX_LENGTH),
    description: optional('Description', PLANT_DESCRIPTION_MAX_LENGTH),
  })
  .strict();
export type PlantProposal = z.infer<typeof plantProposalSchema>;

export interface PlantSummary {
  code: string;
  // Absents tant qu'une fiche proposée par un praticien n'est pas complétée (US-054)
  nomScientifique: string | null;
  nomFr: string;
  famille: string | null;
  statut: PlantStatus;
  // Photo principale (identifiant), null s'il n'y en a pas
  image: number | null;
}

export interface PlantImage {
  id: number;
  alt: string;
  altEn: string | null;
  type: PlantImageType;
  principale: boolean;
}

export interface PlantDetail {
  code: string;
  nomScientifique: string | null;
  famille: string | null;
  nomFr: string;
  nomEn: string | null;
  // Proposition d'un praticien (US-054) : son nom et sa description ; null sinon
  proposition: { par: string; description: string | null } | null;
  statut: PlantStatus;
  // Horodatage ISO 8601 de la dernière modification, à renvoyer avec une modification
  modifieLe: string;
  // Validation par le Comité (US-051) : qui et quand ; null tant que la fiche est en revue
  validation: { par: string; le: string } | null;
  images: PlantImage[];
}

export const PLANT_STATUS_LABELS: Record<PlantStatus, string> = {
  en_revue: 'En revue',
  validee: 'Validée',
};

export const PLANT_IMAGE_TYPE_LABELS: Record<PlantImageType, string> = {
  plante_entiere: 'Plante entière',
  feuille: 'Feuille',
  ecorce: 'Écorce',
  racine: 'Racine',
  produit_prepare: 'Produit préparé',
  autre: 'Autre',
};
