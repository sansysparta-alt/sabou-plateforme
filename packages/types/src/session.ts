import { z } from 'zod';

// Utilisateur connecté, tel que l'API le renvoie à l'application de gestion (GET /auth/session).
// Aucun jeton : ils restent dans l'API (US-010).
export const sessionUserSchema = z.object({
  username: z.string(),
  name: z.string(),
  roles: z.array(z.string()),
  // Porte l'un des 4 profils d'administration : double facteur obligatoire (R-ACC-03)
  administrator: z.boolean(),
  // La connexion a utilisé un second facteur
  secondFactor: z.boolean(),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;
