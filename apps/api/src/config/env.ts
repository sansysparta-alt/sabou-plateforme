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

    // Journal d'audit (US-030) : compte de service Keycloak en lecture seule des événements
    // de connexion (rôle view-events), relevés toutes les AUDIT_POLL_SECONDS (0 : jamais)
    AUDIT_CLIENT_ID: z.string().min(1).default('sabou-audit'),
    AUDIT_CLIENT_SECRET: z.string().min(32),
    AUDIT_POLL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
    // Gestion des comptes (lot A) : compte de service Keycloak limité à manage-users et
    // view-users (création des invités, suspension, réactivation, fin des sessions)
    COMPTES_CLIENT_ID: z.string().min(1).default('sabou-comptes'),
    COMPTES_CLIENT_SECRET: z.string().min(32),
    // Validité d'un lien d'invitation (décision du maître d'œuvre : 72 h)
    INVITATION_HOURS: z.coerce.number().int().min(1).max(72).default(72),
    // Comptes citoyens (lot D : US-014, §2.25) : domaine Keycloak « sabou-public », séparé de
    // celui de l'administration ; le site public sert d'origine et de retour de connexion.
    PUBLIC_KEYCLOAK_ISSUER: z.url({ protocol: /^https?$/ }),
    SITE_CLIENT_ID: z.string().min(1).default('sabou-site'),
    SITE_CLIENT_SECRET: z.string().min(32),
    SITE_URL: z.url({ protocol: /^https?$/ }),
    // Application mobile (US-040b, §2.29) : client public « sabou-mobile » du domaine public ;
    // l'API n'accepte que ses jetons d'accès émis pour l'audience « sabou-api »
    MOBILE_CLIENT_ID: z.string().min(1).default('sabou-mobile'),
    API_AUDIENCE: z.string().min(1).default('sabou-api'),
    // Agent préfectoral dans l'application mobile (US-082) : client public « sabou-terrain »
    // du domaine d'administration ; jetons d'accès pour la même audience « sabou-api »
    FIELD_CLIENT_ID: z.string().min(1).default('sabou-terrain'),
    // Compte de service « sabou-audit » du domaine public (view-events) : échecs de connexion
    // des citoyens versés au journal d'audit
    PUBLIC_AUDIT_CLIENT_ID: z.string().min(1).default('sabou-audit'),
    PUBLIC_AUDIT_CLIENT_SECRET: z.string().min(32),
    // Compte de service « sabou-inscription » (manage-users, view-users de sabou-public)
    INSCRIPTION_CLIENT_ID: z.string().min(1).default('sabou-inscription'),
    INSCRIPTION_CLIENT_SECRET: z.string().min(32),
    // Envoi des SMS : « journal » = faux fournisseur (message écrit dans le journal de l'API),
    // pour le poste local et la recette ; l'API d'Orange Guinée sera ajoutée à la mise en
    // service (05 §2.32). Aucune valeur par défaut : la production doit choisir explicitement.
    SMS_PROVIDER: z.enum(['journal']),
    // File des SMS des décisions (US-031) relevée toutes les SMS_POLL_SECONDS (0 : jamais) ;
    // 5 minutes au plus entre la décision et l'envoi
    SMS_POLL_SECONDS: z.coerce.number().int().min(0).max(240).default(30),
    // Voix déposées (US-070, §2.43) : file relevée toutes les AUDIO_POLL_SECONDS (0 : jamais).
    // FFmpeg statique et modèle RNNoise copiés dans l'image de l'API (apps/api/Dockerfile).
    AUDIO_POLL_SECONDS: z.coerce.number().int().min(0).max(300).default(10),
    FFMPEG_PATH: z.string().min(1).default('/usr/local/bin/ffmpeg'),
    AUDIO_MODEL_PATH: z.string().min(1).default('/app/assets/rnnoise-cb.rnnn'),
    // Pièces des dossiers (US-040a, §2.26) : stockage objet S3 (SeaweedFS). Seau créé au
    // démarrage sur le poste local seulement ; ailleurs, il est préparé au déploiement.
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(16),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_PIECES_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
      .default('sabou-pieces'),
    S3_CREATE_BUCKET: z.stringbool().default(false),
    // Signature des certificats (US-045, §2.34) : coffre OpenBao, moteur Transit. La clé
    // privée Ed25519 de la DG ne quitte jamais le coffre ; l'API n'a qu'un jeton limité à
    // « signer » et « lire les clés publiques », lu dans un fichier à chaque usage (le coffre
    // peut le remplacer sans redémarrer l'API).
    OPENBAO_ADDR: z.url({ protocol: /^https?$/ }),
    OPENBAO_TOKEN_FILE: z.string().min(1),
    OPENBAO_KEY: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/)
      .default('sabou-dg'),
    // Mandataires dont l'en-tête X-Forwarded-For fait foi pour l'IP du journal (syntaxe
    // « trust proxy » d'Express). Par défaut : réseaux privés seulement (Docker, proxy interne).
    TRUST_PROXY: z.string().min(1).default('loopback, linklocal, uniquelocal'),
  })
  .superRefine((env, ctx) => {
    // Sans TLS, les échanges avec Keycloak et le coffre, et le cookie de session, seraient lisibles
    // sur le réseau
    for (const key of [
      'KEYCLOAK_ISSUER',
      'KEYCLOAK_INTERNAL_URL',
      'ADMIN_APP_URL',
      'PUBLIC_KEYCLOAK_ISSUER',
      'SITE_URL',
      'OPENBAO_ADDR',
    ] as const) {
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
