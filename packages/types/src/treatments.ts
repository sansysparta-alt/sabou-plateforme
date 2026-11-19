import { z } from 'zod';
import { diseaseCodeSchema } from './diseases.js';
import { plantCodeSchema } from './plants.js';

// Traitements (recettes) saisis au Studio web par le praticien (US-060, UC-21, R-REC-01 à 04).
// La base contrôle aussi tout ce qui suit (traitement_enregistrer, traitement_soumettre) :
// ces schémas donnent des messages clairs avant d'y arriver.

export const TREATMENT_TITLE_MAX_LENGTH = 150;
export const TREATMENT_SECTION_MAX_LENGTH = 4000;
export const TREATMENT_PART_MAX_LENGTH = 100;
export const TREATMENT_PLANTS_MAX = 15;
export const CYCLE_DAYS_MAX = 365;
export const CYCLE_DOSES_MAX = 10;

// Circuit R-REC-07 (et suspension, retrait)
export const TREATMENT_STATUSES = [
  'brouillon',
  'soumise',
  'transmise',
  'expertisee',
  'certifiee',
  'suspendue',
  'retiree',
] as const;
export type TreatmentStatus = (typeof TREATMENT_STATUSES)[number];

// R-REC-10 : publique (site public), restreinte (comptes connectés), privée (praticien et
// administrateurs)
export const VISIBILITIES = ['publique', 'restreinte', 'privee'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

// R-REC-02 : 4 sections obligatoires et la conservation, facultative
export const SECTION_TYPES = [
  'preparation',
  'consommation',
  'cycle',
  'effets_indesirables',
  'conservation',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

// Ce qui manque pour soumettre (fonction recette_manques de la base)
export const SUBMISSION_GAPS = ['consentement', 'plante', 'cycle', 'sections'] as const;
export type SubmissionGap = (typeof SUBMISSION_GAPS)[number];

// Raison d'un traitement resté « expertisé » à la publication du dossier (US-046)
export type WaitingReason = 'quota' | 'contenu';

export const treatmentCodeSchema = z
  .string()
  .regex(/^REC-\d{4,10}$/, 'Code de traitement invalide.');

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} : ${max} caractères au plus.`)
    .nullish()
    .transform((value) => (value ? value : null));

const days = (label: string, min: number, max: number) =>
  z
    .number(`${label} : un nombre entier.`)
    .int(`${label} : un nombre entier.`)
    .min(min, `${label} : au moins ${min}.`)
    .max(max, `${label} : ${max} au plus.`)
    .nullish()
    .transform((value) => value ?? null);

export const treatmentPlantSchema = z
  .object({
    plante: plantCodeSchema,
    partie: optionalText('Partie utilisée', TREATMENT_PART_MAX_LENGTH),
  })
  .strict();

export const treatmentSectionSchema = z
  .object({
    type: z.enum(SECTION_TYPES, 'Section inconnue.'),
    // Vide : section pas encore rédigée (brouillon), non enregistrée
    texteFr: z
      .string()
      .trim()
      .max(
        TREATMENT_SECTION_MAX_LENGTH,
        `Texte d'une section : ${TREATMENT_SECTION_MAX_LENGTH} caractères au plus.`,
      ),
    texteEn: optionalText('Texte anglais', TREATMENT_SECTION_MAX_LENGTH),
  })
  .strict();

export const treatmentFieldsSchema = z
  .object({
    maladie: diseaseCodeSchema,
    titreFr: z
      .string('Titre : champ obligatoire.')
      .trim()
      .min(1, 'Titre : champ obligatoire.')
      .max(TREATMENT_TITLE_MAX_LENGTH, `Titre : ${TREATMENT_TITLE_MAX_LENGTH} caractères au plus.`),
    titreEn: optionalText('Titre anglais', TREATMENT_TITLE_MAX_LENGTH),
    cycleDureeJours: days('Durée du cycle', 1, CYCLE_DAYS_MAX),
    cyclePrisesParJour: days('Prises par jour', 1, CYCLE_DOSES_MAX),
    cyclePauseJours: days('Pause', 0, CYCLE_DAYS_MAX),
    plantes: z
      .array(treatmentPlantSchema)
      .max(TREATMENT_PLANTS_MAX, `${TREATMENT_PLANTS_MAX} plantes au plus.`)
      .refine(
        (plants) => new Set(plants.map((p) => p.plante)).size === plants.length,
        'Une plante figure deux fois dans le traitement.',
      ),
    sections: z
      .array(treatmentSectionSchema)
      .max(SECTION_TYPES.length)
      .refine(
        (sections) => new Set(sections.map((s) => s.type)).size === sections.length,
        'Une section figure deux fois.',
      ),
    // US-063 : contre-indications structurées (codes de la liste paramétrée par la DG)
    contreIndications: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Contre-indication inconnue.'))
      .max(20, '20 contre-indications au plus.')
      .default([]),
    consentement: z.boolean(),
    visibilite: z.enum(VISIBILITIES, 'Niveau de visibilité inconnu.').nullish(),
  })
  .strict()
  .refine((fields) => !fields.consentement || fields.visibilite, {
    message: 'Choisissez le niveau de visibilité avec votre consentement.',
    path: ['visibilite'],
  });
export type TreatmentFields = z.infer<typeof treatmentFieldsSchema>;
export type TreatmentFieldsInput = z.input<typeof treatmentFieldsSchema>;

export const treatmentUpdateSchema = z.object({
  vueLe: z.iso.datetime({ offset: true, message: 'Date de lecture invalide.' }),
  fields: treatmentFieldsSchema,
});
export type TreatmentUpdate = z.infer<typeof treatmentUpdateSchema>;

export interface TreatmentSummary {
  code: string;
  titreFr: string;
  maladie: { code: string; nomFr: string };
  statut: TreatmentStatus;
  attenteRaison: WaitingReason | null;
  modifieLe: string;
}

export interface TreatmentDetail extends TreatmentSummary {
  titreEn: string | null;
  cycleDureeJours: number | null;
  cyclePrisesParJour: number | null;
  cyclePauseJours: number | null;
  plantes: { plante: string; nomFr: string; partie: string | null; validee: boolean }[];
  sections: { type: SectionType; texteFr: string; texteEn: string | null }[];
  // US-063 : affichées en alerte
  contreIndications: { code: string; libelleFr: string }[];
  // Niveau choisi avec le consentement ; null tant que le praticien n'a pas consenti
  visibilite: Visibility | null;
  consentementLe: string | null;
  manques: SubmissionGap[];
  // Dossier de certification auquel le traitement est joint (R-REC-08)
  dossier: string | null;
  // Dernier motif de rejet, s'il y en a un (R-REC-07)
  dernierMotif: string | null;
}

export interface StudioReferentials {
  maladies: { code: string; nomFr: string }[];
  // Nom scientifique absent tant qu'une plante proposée n'est pas complétée (US-054)
  plantes: { code: string; nomFr: string; nomScientifique: string | null; validee: boolean }[];
  sections: { code: SectionType; libelleFr: string; obligatoire: boolean }[];
  // US-063 : contre-indications actives, proposées au praticien
  contreIndications: { code: string; libelleFr: string }[];
}

// ---------------------------------------------------------------------
// Circuit côté administrateurs (US-061, R-REC-07)
// ---------------------------------------------------------------------
export const TREATMENT_MOTIF_MAX_LENGTH = 1000;
// Statuts qui attendent une décision : soumis (régional), transmis (Comité), expertisé (DG)
export const DECIDABLE_STATUSES = ['soumise', 'transmise', 'expertisee'] as const;
export type DecidableStatus = (typeof DECIDABLE_STATUSES)[number];
// « avance » : étape suivante ; « renvoi » : étape précédente, motif obligatoire
export const TREATMENT_DECISIONS = ['avance', 'renvoi'] as const;
export type TreatmentDecisionKind = (typeof TREATMENT_DECISIONS)[number];

export const treatmentDecisionSchema = z
  .object({
    // Statut vu à l'écran : si le traitement a bougé entre-temps, la décision est refusée
    statut: z.enum(DECIDABLE_STATUSES, 'Statut du traitement invalide.'),
    decision: z.enum(TREATMENT_DECISIONS, 'Décision inconnue.'),
    motif: z
      .string()
      .trim()
      .max(TREATMENT_MOTIF_MAX_LENGTH, `Motif : ${TREATMENT_MOTIF_MAX_LENGTH} caractères au plus.`)
      .optional(),
  })
  .strict()
  .refine((d) => d.decision !== 'renvoi' || Boolean(d.motif), {
    message: 'Motif du renvoi : champ obligatoire.',
    path: ['motif'],
  });
export type TreatmentDecision = z.infer<typeof treatmentDecisionSchema>;

// Motifs qui empêchent de certifier un traitement (US-062, fonction recette_blocages)
export const CERTIFICATION_BLOCKERS = [
  'plante',
  'plante_en_revue',
  'sections',
  'cycle',
  'certificat',
  'quota',
] as const;
export type CertificationBlocker = (typeof CERTIFICATION_BLOCKERS)[number];

export interface TreatmentQueueItem {
  code: string;
  titreFr: string;
  statut: DecidableStatus;
  praticien: string;
  praticienNom: string;
  prefecture: string;
  maladie: string;
  cycleDureeJours: number | null;
  cyclePrisesParJour: number | null;
  cyclePauseJours: number | null;
  plantes: {
    nomFr: string;
    nomScientifique: string | null;
    partie: string | null;
    validee: boolean;
  }[];
  sections: { type: SectionType; libelleFr: string; texteFr: string; texteEn: string | null }[];
  // US-063 : libellés des contre-indications, affichés en alerte
  contreIndications: string[];
  visibilite: Visibility;
  // Dossier de certification auquel le traitement est joint (R-REC-08)
  dossier: string | null;
  // Date d'arrivée au statut actuel
  depuisLe: string;
  dernierMotif: string | null;
  // Traitement expertisé : ce qui empêche encore sa certification (vide sinon)
  blocages: CertificationBlocker[];
}

export interface TreatmentDecisionResult {
  code: string;
  statut: TreatmentStatus;
}
