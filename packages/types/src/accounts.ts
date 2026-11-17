import { z } from 'zod';
import { PHONE_ERROR, toInternational, toNationalMobile } from './phone.js';

// Gestion des comptes (lot A : US-012, US-013). Schémas partagés par l'API, qui valide
// chaque requête, et par l'application de gestion, qui valide ses formulaires.

// Rôles que la DG attribue par invitation (UC-65). Les praticiens et les citoyens ont
// leurs propres parcours d'inscription.
export const ACCOUNT_ROLES = ['dg', 'regional', 'prefectoral', 'scientifique'] as const;
export const accountRoleSchema = z.enum(ACCOUNT_ROLES);
export type AccountRole = z.infer<typeof accountRoleSchema>;

export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = {
  dg: 'Direction Générale',
  regional: 'Administrateur régional',
  prefectoral: 'Administrateur préfectoral',
  scientifique: 'Comité scientifique',
};

export const accountStatusSchema = z.enum(['invite', 'actif', 'suspendu']);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

const languageCode = z.string().regex(/^[a-z]{2,3}$/);
const id = z.number().int().positive().max(32_767);
const name = z.string().trim().min(1).max(80);

// Langue de travail et droits sur ses contenus (R-GOV-06)
export const workLanguageSchema = z.strictObject({
  code: languageCode,
  record: z.boolean(),
  translate: z.boolean(),
  validate: z.boolean(),
});
export type WorkLanguage = z.infer<typeof workLanguageSchema>;

// Zone exigée par le rôle (R-ACC-02), vérifiée aussi par la base (contrainte ck_zone_role)
export function zoneError(
  role: AccountRole,
  regionId: number | null,
  prefectureId: number | null,
): string | null {
  switch (role) {
    case 'regional':
      return regionId !== null && prefectureId === null
        ? null
        : 'Un administrateur régional a une région, et une seule.';
    case 'prefectoral':
      return prefectureId !== null && regionId === null
        ? null
        : 'Un administrateur préfectoral a une préfecture, et une seule.';
    default:
      return regionId === null && prefectureId === null
        ? null
        : 'Ce rôle couvre tout le pays : ni région ni préfecture.';
  }
}

// Téléphone facultatif d'un compte d'administration (fiche U-001 du cahier des charges) : pour
// être joint par la DG, jamais identifiant de connexion (l'e-mail l'est). Mobile guinéen saisi
// librement, enregistré sous la forme internationale (+2246XXXXXXXX).
export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(30)
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const national = toNationalMobile(value);
    if (national) return toInternational(national);
    ctx.addIssue({ code: 'custom', message: PHONE_ERROR });
    return z.NEVER;
  });

export const inviteRequestSchema = z
  .strictObject({
    email: z.email().max(254).toLowerCase(),
    firstName: name,
    lastName: name,
    phone: optionalPhoneSchema,
    role: accountRoleSchema,
    regionId: id.nullable(),
    prefectureId: id.nullable(),
    interfaceLanguage: z.enum(['fr', 'en']),
    listeningLanguage: languageCode.nullable(),
    languages: z.array(workLanguageSchema).max(10),
  })
  .superRefine((value, ctx) => {
    const error = zoneError(value.role, value.regionId, value.prefectureId);
    if (error) ctx.addIssue({ code: 'custom', path: ['zone'], message: error });
    const codes = value.languages.map((language) => language.code);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: 'custom', path: ['languages'], message: 'Langue en double.' });
    }
  });
export type InviteRequest = z.infer<typeof inviteRequestSchema>;

// Lien à transmettre par la DG ; le jeton est dans le fragment (#), jamais envoyé au serveur
// qui sert la page ni inscrit dans les journaux des mandataires
export const invitationLinkSchema = z.strictObject({
  accountId: z.number().int().positive(),
  link: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type InvitationLink = z.infer<typeof invitationLinkSchema>;

export const accountSummarySchema = z.strictObject({
  id: z.number().int().positive(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  role: accountRoleSchema,
  zone: z.string(),
  status: accountStatusSchema,
  languages: z.array(workLanguageSchema),
  // Le compte connecté lui-même : la DG ne peut pas se suspendre
  self: z.boolean(),
});
export type AccountSummary = z.infer<typeof accountSummarySchema>;

export const accountReferencesSchema = z.strictObject({
  regions: z.array(z.strictObject({ id, name: z.string() })),
  prefectures: z.array(z.strictObject({ id, name: z.string(), regionId: id })),
  languages: z.array(
    z.strictObject({ code: languageCode, name: z.string(), text: z.boolean(), voice: z.boolean() }),
  ),
});
export type AccountReferences = z.infer<typeof accountReferencesSchema>;

// Jeton du lien : 256 bits en base64url
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const invitationPreviewSchema = z.strictObject({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  role: accountRoleSchema,
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

// Les règles du mot de passe sont celles de Keycloak (12 caractères au moins) ; l'API
// ne fait que borner la taille de la requête
export const acceptInvitationSchema = z.strictObject({
  token: invitationTokenSchema,
  password: z.string().min(1).max(128),
});
export type AcceptInvitation = z.infer<typeof acceptInvitationSchema>;
