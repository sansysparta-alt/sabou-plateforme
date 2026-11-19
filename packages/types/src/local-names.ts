import { z } from 'zod';
import { plantCodeSchema } from './plants.js';

// Noms locaux d'une plante (US-053, UC-12, R-PLA-03, R-LNG-13). Saisis par le référent d'une
// langue (droit d'enregistrer dans cette langue, donné par la DG dans la gestion des comptes) :
// une transcription en alphabet latin, pour la recherche seulement (jamais affichée sur le
// site public, R-LNG-02), et la voix du nom, déposée puis traitée (US-070).

export const LOCAL_NAME_MAX_LENGTH = 100;

// Langue de voix dans laquelle le compte connecté peut enregistrer
export interface RecordingLanguage {
  code: string;
  nom: string;
}

export interface LocalName {
  id: number;
  langue: string;
  langueNom: string;
  transcription: string;
  principal: boolean;
  voix: boolean;
  // Le compte connecté est référent de cette langue : il peut changer le principal, retirer
  modifiable: boolean;
}

export interface LocalNamesPlant {
  code: string;
  nomScientifique: string | null;
  nomFr: string;
  noms: LocalName[];
}

export interface LocalNamesPlantSummary {
  code: string;
  nomScientifique: string | null;
  nomFr: string;
  // Nombre de noms locaux déjà saisis, toutes langues
  noms: number;
}

export const localNameCreateSchema = z
  .object({
    plante: plantCodeSchema,
    langue: z.string().regex(/^[a-z]{2,3}$/, 'Langue invalide.'),
    transcription: z
      .string('Transcription : champ obligatoire.')
      .trim()
      .min(1, 'Transcription : champ obligatoire.')
      .max(LOCAL_NAME_MAX_LENGTH, `Transcription : ${LOCAL_NAME_MAX_LENGTH} caractères au plus.`),
    principal: z.boolean().default(false),
    // Dépôt de voix traité (POST /api/voix), du même compte ; facultatif à la saisie
    depot: z.number().int().positive().nullable().default(null),
  })
  .strict();
export type LocalNameCreate = z.infer<typeof localNameCreateSchema>;
