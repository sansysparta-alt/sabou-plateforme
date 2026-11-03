import { z } from 'zod';

// Lot envoyé par le téléphone : sa file d'écritures faites hors réseau (US-004).
// Le téléphone envoie toujours le dossier entier (R-DON-04, point 1).
const operationSchema = z.strictObject({
  op: z.enum(['PUT', 'PATCH', 'DELETE']),
  table: z.literal('saisie_terrain'),
  id: z.uuid(),
  type: z.enum(['dossier', 'recette', 'visite']),
  contenu: z.record(z.string(), z.unknown()),
  // Version du serveur dont l'agent est parti ; absente pour un dossier créé sur le téléphone
  version_base: z.number().int().positive().nullable(),
});

export const uploadSchema = z.strictObject({
  operations: z.array(operationSchema).min(1).max(50),
});

export type UploadOperation = z.infer<typeof operationSchema>;

export interface UploadResult {
  id: string;
  result: 'creee' | 'modifiee' | 'identique' | 'copie_brouillon' | 'remplacee' | 'refusee';
}
