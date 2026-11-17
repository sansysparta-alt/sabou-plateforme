import { z } from 'zod';

// Fiches maladies du Dictionnaire (US-052, UC-05, R-MAL-01). Créées et modifiées par la DG et
// le Comité scientifique ; la base contrôle le rôle et l'unicité du nom français
// (maladie_creer, maladie_modifier). Dénominations (synonymes) en français ou en anglais
// seulement : aucun texte en langue nationale (R-LNG-02).

export const DISEASE_NAME_MAX_LENGTH = 150;
export const DISEASE_SYMPTOMS_MAX_LENGTH = 2000;
export const DISEASE_DENOMINATIONS_MAX = 30;
export const DISEASE_SEARCH_MAX_LENGTH = 100;

export const DENOMINATION_LANGUAGES = ['fr', 'en'] as const;
export type DenominationLanguage = (typeof DENOMINATION_LANGUAGES)[number];

export const diseaseCodeSchema = z.string().regex(/^MA-\d{3,10}$/, 'Code de maladie invalide.');

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} : ${max} caractères au plus.`)
    .nullish()
    .transform((value) => (value ? value : null));

export const denominationSchema = z
  .object({
    langue: z.enum(DENOMINATION_LANGUAGES, 'Dénomination : langue française ou anglaise.'),
    denomination: z
      .string()
      .trim()
      .min(1, 'Dénomination vide.')
      .max(
        DISEASE_NAME_MAX_LENGTH,
        `Dénomination : ${DISEASE_NAME_MAX_LENGTH} caractères au plus.`,
      ),
  })
  .strict();
export type Denomination = z.infer<typeof denominationSchema>;

export const diseaseFieldsSchema = z
  .object({
    nomFr: z
      .string('Nom français : champ obligatoire.')
      .trim()
      .min(1, 'Nom français : champ obligatoire.')
      .max(
        DISEASE_NAME_MAX_LENGTH,
        `Nom français : ${DISEASE_NAME_MAX_LENGTH} caractères au plus.`,
      ),
    nomEn: text('Nom anglais', DISEASE_NAME_MAX_LENGTH),
    symptomesFr: text('Symptômes', DISEASE_SYMPTOMS_MAX_LENGTH),
    symptomesEn: text('Symptômes en anglais', DISEASE_SYMPTOMS_MAX_LENGTH),
    denominations: z
      .array(denominationSchema)
      .max(DISEASE_DENOMINATIONS_MAX, `${DISEASE_DENOMINATIONS_MAX} dénominations au plus.`),
  })
  .strict();
export type DiseaseFields = z.infer<typeof diseaseFieldsSchema>;

export const diseaseUpdateSchema = diseaseFieldsSchema
  .extend({ vueLe: z.iso.datetime({ offset: true, message: 'Date de lecture invalide.' }) })
  .strict();
export type DiseaseUpdate = z.infer<typeof diseaseUpdateSchema>;

export const diseaseSearchSchema = z
  .object({
    q: z.string().trim().max(DISEASE_SEARCH_MAX_LENGTH, 'Recherche trop longue.').optional(),
  })
  .strict();

export interface DiseaseSummary {
  code: string;
  nomFr: string;
  nomEn: string | null;
  // Dénominations, pour qu'une recherche montre pourquoi la fiche est trouvée
  denominations: string[];
}

export interface DiseaseDetail {
  code: string;
  nomFr: string;
  nomEn: string | null;
  symptomesFr: string | null;
  symptomesEn: string | null;
  denominations: Denomination[];
  modifieLe: string;
}
