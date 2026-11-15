import { z } from 'zod';

// Listes cloisonnées par zone (lot B : US-011). La zone ne figure dans aucun paramètre :
// l'API la lit en base, pour le compte connecté (R-ACC-02).

// Deux façons de paginer, exclusives l'une de l'autre :
// - par curseur (`apres` : code du dernier élément reçu), pour parcourir une liste en entier
//   sans page sautée ni répétée si une ligne arrive entre deux appels ;
// - par numéro de page (`decalage` : nombre d'éléments à sauter), pour les écrans de gestion
//   qui affichent « Page 3 sur 8 » (US-019b). Les files de dossiers restent courtes.
export const ZONE_LIST_MAX_OFFSET = 100_000;
export const ZONE_LIST_SEARCH_MAX_LENGTH = 100;
export const zoneListQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(50),
    apres: z
      .string()
      .regex(/^[A-Z]{2}-\d{1,10}$/)
      .optional(),
    decalage: z.coerce.number().int().min(0).max(ZONE_LIST_MAX_OFFSET).optional(),
    // Recherche dans le code et le nom du praticien (files de dossiers, US-019b)
    q: z.string().trim().min(1).max(ZONE_LIST_SEARCH_MAX_LENGTH).optional(),
  })
  .strict()
  .refine((query) => query.apres === undefined || query.decalage === undefined, {
    message: 'apres et decalage ne se combinent pas',
  });
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

// Une page : ses éléments, le curseur de la suivante (null en fin de liste) et le nombre
// d'éléments de toute la liste, curseur et décalage mis à part (US-019b)
export interface ZonePage<T> {
  elements: T[];
  suivant: string | null;
  total: number;
}
