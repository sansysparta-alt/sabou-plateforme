import { z } from 'zod';

// Voix du nom des plantes et des maladies, par langue (US-071, UC-33, UC-41, R-LNG-10) :
// brouillon → traduit → validé → publié. Le libellé reste écrit en français (R-LNG-02).

export const NAME_VOICE_OBJECTS = ['plante', 'maladie'] as const;
export type NameVoiceObject = (typeof NAME_VOICE_OBJECTS)[number];

export const NAME_VOICE_STATUSES = ['brouillon', 'traduit', 'valide', 'publie'] as const;
export type NameVoiceStatus = (typeof NAME_VOICE_STATUSES)[number];

export const NAME_VOICE_MOTIF_MAX_LENGTH = 500;

export interface NameVoiceTarget {
  objet: NameVoiceObject;
  code: string;
  nom: string;
  // Langues où la voix du nom est publiée, et en cours (traduite ou validée)
  publiees: number;
  enCours: number;
}

export interface NameVoicesEntry {
  langue: string;
  langueNom: string;
  // null : aucune voix dans cette langue
  statut: NameVoiceStatus | null;
  enregistrePar: string | null;
  // La voix a été enregistrée par le compte connecté : il ne la valide pas (R-GOV-07)
  parMoi: boolean;
  motif: string | null;
  consentement: boolean;
  secours: boolean;
  // Droits du compte connecté dans la langue (R-GOV-06)
  peutEnregistrer: boolean;
  peutTraduire: boolean;
  peutValider: boolean;
}

export interface NameVoices {
  objet: NameVoiceObject;
  code: string;
  nom: string;
  // Le compte connecté est la DG : il publie les voix validées (R-GOV-05)
  dg: boolean;
  voix: NameVoicesEntry[];
}

export const nameVoiceTargetSchema = z
  .object({
    objet: z.enum(NAME_VOICE_OBJECTS, 'Fiche invalide.'),
    code: z.string().regex(/^(PL|MA)-\d{3,10}$/, 'Code de fiche invalide.'),
    langue: z.string().regex(/^[a-z]{2,3}$/, 'Langue invalide.'),
  })
  .strict()
  .refine((t) => (t.objet === 'plante') === t.code.startsWith('PL-'), 'Code de fiche invalide.');

export const nameVoiceRecordSchema = z
  .object({ depot: z.number('Voix : dépôt manquant.').int().positive() })
  .strict();

export const nameVoiceMoveSchema = z
  .object({
    vers: z.enum(['traduit', 'valide', 'publie', 'brouillon'], 'Statut invalide.'),
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
  .refine((m) => m.vers !== 'brouillon' || !!m.motif, {
    message: 'Motif du renvoi : champ obligatoire.',
    path: ['motif'],
  });
export type NameVoiceMove = z.infer<typeof nameVoiceMoveSchema>;
