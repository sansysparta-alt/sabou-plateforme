import { z } from 'zod';

// Listes cloisonnées par zone (lot B : US-011). La zone ne figure dans aucun paramètre :
// l'API la lit en base, pour le compte connecté (R-ACC-02).

// Pagination par curseur (code du dernier élément reçu) : pages courtes en 3G, et aucune
// page sautée ni répétée si une ligne arrive entre deux appels
export const zoneListQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(50),
    apres: z
      .string()
      .regex(/^[A-Z]{2}-\d{1,10}$/)
      .optional(),
  })
  .strict();
export type ZoneListQuery = z.infer<typeof zoneListQuerySchema>;

export const practitionerSummarySchema = z.object({
  code: z.string(),
  prenom: z.string(),
  nom: z.string(),
  specialite: z.string(),
  prefecture: z.string(),
  region: z.string(),
  statut: z.enum(['en_attente', 'certifie', 'rejete', 'suspendu']),
});
export type PractitionerSummary = z.infer<typeof practitionerSummarySchema>;

export const dossierSummarySchema = z.object({
  code: z.string(),
  praticien: z.string(),
  praticienNom: z.string(),
  prefecture: z.string(),
  type: z.enum(['initial', 'renouvellement']),
  etape: z.number().int().min(1).max(6),
  statut: z.enum(['en_cours', 'approuve', 'rejete_definitif', 'abandonne']),
  ouvertLe: z.string(),
});
export type DossierSummary = z.infer<typeof dossierSummarySchema>;

// Une page : ses éléments et le curseur de la suivante (null en fin de liste)
export interface ZonePage<T> {
  elements: T[];
  suivant: string | null;
}
