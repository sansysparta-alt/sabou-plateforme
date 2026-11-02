import { z } from 'zod';

// Réponse du contrôle de santé de l'API, partagée entre l'API et les interfaces
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
