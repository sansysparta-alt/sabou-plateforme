import { z } from 'zod';

// Annotations du Comité scientifique sur un traitement ou une plante (US-064, UC-51, R-MOD-10).
// Datées, avec un avis ; jamais modifiées ni effacées. Lues par le Comité et la DG.

export const ANNOTATION_MAX_LENGTH = 2000;
export const ANNOTATION_OPINIONS = ['favorable', 'reserve', 'defavorable'] as const;
export type AnnotationOpinion = (typeof ANNOTATION_OPINIONS)[number];
export const ANNOTATION_TARGETS = ['recette', 'plante'] as const;
export type AnnotationTarget = (typeof ANNOTATION_TARGETS)[number];

const PREFIX: Record<AnnotationTarget, string> = { recette: 'REC-', plante: 'PL-' };

export const annotationTargetSchema = z
  .object({
    type: z.enum(ANNOTATION_TARGETS, 'Objet annoté inconnu.'),
    code: z.string().regex(/^(REC|PL)-\d{3,10}$/, 'Code invalide.'),
  })
  .refine((t) => t.code.startsWith(PREFIX[t.type]), {
    message: 'Code invalide pour cet objet.',
    path: ['code'],
  });
export type AnnotationTargetRef = z.infer<typeof annotationTargetSchema>;

export const newAnnotationSchema = z
  .object({
    type: z.enum(ANNOTATION_TARGETS, 'Objet annoté inconnu.'),
    code: z.string().regex(/^(REC|PL)-\d{3,10}$/, 'Code invalide.'),
    avis: z.enum(ANNOTATION_OPINIONS, 'Avis : favorable, réserve ou défavorable.'),
    contenu: z
      .string('Annotation : champ obligatoire.')
      .trim()
      .min(1, 'Annotation : champ obligatoire.')
      .max(ANNOTATION_MAX_LENGTH, `Annotation : ${ANNOTATION_MAX_LENGTH} caractères au plus.`),
  })
  .strict()
  .refine((t) => t.code.startsWith(PREFIX[t.type]), {
    message: 'Code invalide pour cet objet.',
    path: ['code'],
  });
export type NewAnnotation = z.infer<typeof newAnnotationSchema>;

export interface Annotation {
  id: number;
  // Avis absent sur les seules annotations antérieures à US-064
  avis: AnnotationOpinion | null;
  contenu: string;
  auteur: string;
  le: string;
}
