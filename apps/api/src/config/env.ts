import { z } from 'zod';

// Configuration lue dans l'environnement au démarrage : une valeur absente ou invalide
// arrête l'API tout de suite plutôt qu'à la première requête.
const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Seuls les noms des variables sont cités : leurs valeurs peuvent contenir un mot de passe
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Configuration invalide : ${names.join(', ')}`);
  }
  return result.data;
}
