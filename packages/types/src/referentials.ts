import { z } from 'zod';

// Référentiels gérés par la DG (lot C : US-020, US-021, UC-65). Schémas partagés par l'API,
// qui valide chaque requête, et par l'application de gestion, qui valide ses formulaires.

const label = z.string().trim().min(1).max(80);
const id = z.number().int().positive().max(32_767);

export const LANGUAGE_TYPES = ['officielle', 'nationale', 'internationale'] as const;
export const languageTypeSchema = z.enum(LANGUAGE_TYPES);
export type LanguageType = z.infer<typeof languageTypeSchema>;

export const LANGUAGE_TYPE_LABELS: Record<LanguageType, string> = {
  officielle: 'Officielle',
  nationale: 'Nationale',
  internationale: 'Internationale',
};

// Langue (R-LNG-01 à 06). Le code, le type et l'usage sont fixés à la création.
export const languageSchema = z.strictObject({
  code: z.string(),
  iso6393: z.string().nullable(),
  name: z.string(),
  type: languageTypeSchema,
  text: z.boolean(),
  voice: z.boolean(),
  active: z.boolean(),
  order: z.number(),
});
export type Language = z.infer<typeof languageSchema>;

export const languageCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2,3}$/, 'Le code compte 2 ou 3 lettres, sans accent.');

export const createLanguageSchema = z
  .strictObject({
    code: languageCodeSchema,
    iso6393: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{3}$/, 'Le code ISO 639-3 compte 3 lettres.')
      .nullable(),
    name: label,
    type: languageTypeSchema,
    text: z.boolean(),
    voice: z.boolean(),
  })
  .refine((l) => l.text || l.voice, 'Une langue sert au texte, à la voix, ou aux deux.')
  // R-LNG-02 : aucun texte écrit en langue nationale
  .refine(
    (l) => l.type !== 'nationale' || !l.text,
    'Une langue nationale existe uniquement en voix (aucun texte écrit).',
  );
export type CreateLanguage = z.infer<typeof createLanguageSchema>;

export const updateLanguageSchema = z
  .strictObject({ name: label, order: z.number().int().min(0).max(999), active: z.boolean() })
  .partial()
  .refine((u) => Object.keys(u).length > 0, 'Aucune modification.');
export type UpdateLanguage = z.infer<typeof updateLanguageSchema>;

// Territoires : 4 régions naturelles (langue vocale par défaut, R-LNG-07), régions
// administratives, préfectures, sous-préfectures. La fusion fera l'objet d'un récit à part.
export const naturalRegionSchema = z.strictObject({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  defaultLanguage: z.string(),
});
export type NaturalRegion = z.infer<typeof naturalRegionSchema>;

export const territorySchema = z.strictObject({
  id: z.number(),
  name: z.string(),
  // Rattachement : région naturelle, région ou préfecture selon le niveau
  parentId: z.number(),
});
export type Territory = z.infer<typeof territorySchema>;

export const TERRITORY_LEVELS = ['regions', 'prefectures', 'sous-prefectures'] as const;
export const territoryLevelSchema = z.enum(TERRITORY_LEVELS);
export type TerritoryLevel = z.infer<typeof territoryLevelSchema>;

export const createTerritorySchema = z.strictObject({ name: label, parentId: id });
export type CreateTerritory = z.infer<typeof createTerritorySchema>;

export const renameTerritorySchema = z.strictObject({ name: label });
export type RenameTerritory = z.infer<typeof renameTerritorySchema>;

// Spécialités (R-CER-09) : ajout, renommage et désactivation ; jamais de suppression
export const specialtySchema = z.strictObject({
  id: z.number(),
  code: z.string(),
  labelFr: z.string(),
  labelEn: z.string().nullable(),
  active: z.boolean(),
});
export type Specialty = z.infer<typeof specialtySchema>;

const labelEn = label.nullable();

export const createSpecialtySchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Le code : lettres minuscules, chiffres et _, sans accent.'),
  labelFr: label,
  labelEn,
});
export type CreateSpecialty = z.infer<typeof createSpecialtySchema>;

export const updateSpecialtySchema = z
  .strictObject({ labelFr: label, labelEn, active: z.boolean() })
  .partial()
  .refine((u) => Object.keys(u).length > 0, 'Aucune modification.');
export type UpdateSpecialty = z.infer<typeof updateSpecialtySchema>;

export const referentialsSchema = z.strictObject({
  languages: z.array(languageSchema),
  naturalRegions: z.array(naturalRegionSchema),
  regions: z.array(territorySchema),
  prefectures: z.array(territorySchema),
  subPrefectures: z.array(territorySchema),
  specialties: z.array(specialtySchema),
});
export type Referentials = z.infer<typeof referentialsSchema>;
