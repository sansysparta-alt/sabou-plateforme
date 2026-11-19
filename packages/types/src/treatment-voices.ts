import { z } from 'zod';
import { NAME_VOICE_MOTIF_MAX_LENGTH, type NameVoiceStatus } from './name-voices.js';
import { treatmentCodeSchema } from './treatments.js';

// Voix des sections d'un traitement, par langue (US-072 à US-075, UC-33, UC-41, R-LNG-10) :
// le préfectoral révise le texte français et enregistre la voix locale, puis l'envoie au
// régional de la langue (brouillon → traduit). Aucun texte en langue nationale (R-LNG-02).

export const TREATMENT_SECTION_TYPES = [
  'preparation',
  'consommation',
  'cycle',
  'effets_indesirables',
  'conservation',
] as const;
export type TreatmentSectionType = (typeof TREATMENT_SECTION_TYPES)[number];

export const TREATMENT_SECTION_TEXT_MAX_LENGTH = 4000;

// Traitement de la zone du compte, avec l'état de ses voix
export interface TreatmentVoiceTarget {
  code: string;
  titre: string;
  maladie: string;
  praticien: string;
  prefecture: string;
  // Statut du traitement dans le circuit (soumise, transmise…)
  statut: string;
  // Voix par statut, toutes sections et langues confondues
  brouillons: number;
  traduites: number;
  validees: number;
  publiees: number;
  // Voix envoyées que le compte connecté peut valider (langues où il en a le droit, US-072)
  aValider: number;
  // Voix validées des effets indésirables qui attendent le contrôle du Comité (US-073)
  aControler: number;
}

export interface TreatmentVoiceEntry {
  langue: string;
  langueNom: string;
  // null : aucune voix dans cette langue
  statut: NameVoiceStatus | null;
  enregistrePar: string | null;
  // La voix a été enregistrée par le compte connecté
  parMoi: boolean;
  motif: string | null;
  consentement: boolean;
  secours: boolean;
  // Contrôlée par le Comité (effets indésirables, R-LNG-12)
  controle: boolean;
  // Droits du compte connecté dans la langue (R-GOV-06)
  peutEnregistrer: boolean;
  peutTraduire: boolean;
  peutValider: boolean;
}

export interface TreatmentSectionRevision {
  // Vide quand le préfectoral écrit le premier texte d'une section dite en voix (US-081)
  avant: string | null;
  apres: string;
  par: string;
  le: string;
}

export interface TreatmentVoiceSection {
  type: TreatmentSectionType;
  libelle: string;
  // Vide tant que le préfectoral n'a pas résumé la voix du praticien (US-081)
  texteFr: string | null;
  texteEn: string | null;
  revisions: TreatmentSectionRevision[];
  voix: TreatmentVoiceEntry[];
}

export interface TreatmentVoices {
  code: string;
  titre: string;
  statut: string;
  praticien: string;
  // Le compte connecté est le préfectoral de la préfecture et le traitement est soumis
  peutReviser: boolean;
  // Le compte connecté est le préfectoral de la préfecture du praticien
  prefectoral: boolean;
  // Le compte connecté est membre du Comité scientifique (contrôle, US-073)
  comite: boolean;
  sections: TreatmentVoiceSection[];
}

// Couverture vocale par langue et retards par région (US-074, UC-63)
export interface VoiceCoverageLanguage {
  langue: string;
  langueNom: string;
  // Sections des traitements certifiés
  sections: number;
  publiees: number;
  // Voix validées, dont celles qui ne peuvent pas encore être publiées
  validees: number;
  bloquees: number;
}

export interface VoiceDelayRegion {
  region: string;
  brouillons: number;
  envoyees: number;
  validees: number;
  // Date (AAAA-MM-JJ) de la plus ancienne voix en retard
  plusAncienne: string;
}

export interface VoiceCoverage {
  langues: VoiceCoverageLanguage[];
  // Voix en attente depuis plus de 7 jours, par région du praticien
  retards: VoiceDelayRegion[];
}

export interface VoicePublication {
  publiees: number;
  bloquees: number;
}

export const voicePublicationSchema = z
  .object({
    langue: z
      .string()
      .regex(/^[a-z]{2,3}$/, 'Langue invalide.')
      .nullable()
      .default(null),
  })
  .strict();

export const treatmentVoiceTargetSchema = z
  .object({
    code: treatmentCodeSchema,
    type: z.enum(TREATMENT_SECTION_TYPES, 'Section invalide.'),
    langue: z.string().regex(/^[a-z]{2,3}$/, 'Langue invalide.'),
  })
  .strict();

export const treatmentSectionTargetSchema = treatmentVoiceTargetSchema.omit({ langue: true });

export const treatmentSectionReviseSchema = z
  .object({
    texteFr: z
      .string('Texte français : champ obligatoire.')
      .trim()
      .min(1, 'Texte français : champ obligatoire.')
      .max(
        TREATMENT_SECTION_TEXT_MAX_LENGTH,
        `Texte français : ${TREATMENT_SECTION_TEXT_MAX_LENGTH} caractères au plus.`,
      ),
    texteEn: z
      .string()
      .trim()
      .max(
        TREATMENT_SECTION_TEXT_MAX_LENGTH,
        `Texte anglais : ${TREATMENT_SECTION_TEXT_MAX_LENGTH} caractères au plus.`,
      )
      .nullable()
      .default(null)
      .transform((v) => v || null),
  })
  .strict();
export type TreatmentSectionRevise = z.infer<typeof treatmentSectionReviseSchema>;

export const treatmentVoiceMoveSchema = z
  .object({
    // controle / controle_refuse : geste du Comité sur les effets indésirables (US-073)
    vers: z.enum(
      ['traduit', 'valide', 'brouillon', 'controle', 'controle_refuse'],
      'Statut invalide.',
    ),
    motif: z
      .string()
      .trim()
      .max(
        NAME_VOICE_MOTIF_MAX_LENGTH,
        `Motif : ${NAME_VOICE_MOTIF_MAX_LENGTH} caractères au plus.`,
      )
      .nullable()
      .default(null),
  })
  .strict()
  .refine((m) => (m.vers !== 'brouillon' && m.vers !== 'controle_refuse') || !!m.motif, {
    message: 'Motif du renvoi : champ obligatoire.',
    path: ['motif'],
  });
export type TreatmentVoiceMove = z.infer<typeof treatmentVoiceMoveSchema>;
