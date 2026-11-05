import { z } from 'zod';

// Configuration lue dans l'environnement au démarrage : une valeur absente ou invalide
// arrête l'API tout de suite plutôt qu'à la première requête.
const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // Clé HS256 des jetons de synchronisation (US-004), la même que celle de PowerSync.
    // Production : clés publiques de Keycloak (US-010).
    SYNC_JWT_SECRET: z.base64url().min(43),

    // Connexion des utilisateurs (US-010) : l'API sert d'intermédiaire (« BFF ») entre
    // l'application de gestion et Keycloak ; le navigateur n'a qu'un cookie de session.
    // Émetteur tel que le voit le navigateur (claim « iss » des jetons)
    KEYCLOAK_ISSUER: z.url({ protocol: /^https?$/ }),
    // Adresse interne de Keycloak, si l'API ne le joint pas par son adresse publique (Docker)
    KEYCLOAK_INTERNAL_URL: z.url({ protocol: /^https?$/ }).optional(),
    // HTTP sans TLS vers Keycloak : poste de développement uniquement
    KEYCLOAK_ALLOW_HTTP: z.stringbool().default(false),
    ADMIN_CLIENT_ID: z.string().min(1).default('sabou-admin'),
    ADMIN_CLIENT_SECRET: z.string().min(32),
    // Adresse publique de l'application de gestion (même origine que /auth, via le proxy)
    ADMIN_APP_URL: z.url({ protocol: /^https?$/ }),
    VALKEY_URL: z.url({ protocol: /^rediss?$/ }),
  })
  .superRefine((env, ctx) => {
    // Sans TLS, les échanges avec Keycloak et le cookie de session seraient lisibles sur le réseau
    for (const key of ['KEYCLOAK_ISSUER', 'KEYCLOAK_INTERNAL_URL', 'ADMIN_APP_URL'] as const) {
      if (env[key]?.startsWith('http:') && !env.KEYCLOAK_ALLOW_HTTP) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'https requis' });
      }
    }
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
