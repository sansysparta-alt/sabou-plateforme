import { z } from 'zod';

// Réponse du contrôle de santé de l'API, partagée entre l'API et les interfaces
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

// Réponse du contrôle de disponibilité : l'API répond et lit la base.
// Aucune version ni aucun message d'erreur n'est exposé (ASVS 14.3.3) : le détail reste dans les
// journaux. Objets stricts : un champ ajouté par erreur (version, message) est refusé.
export const readinessResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ok'),
    service: z.string().min(1),
    database: z.literal('ok'),
  }),
  z.strictObject({
    status: z.literal('error'),
    service: z.string().min(1),
    database: z.literal('unavailable'),
  }),
]);

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
