import { z } from 'zod';
import { citizenPasswordError, CITIZEN_PASSWORD_MAX, toNationalMobile } from './phone.js';

// Inscription d'un citoyen par son numéro de téléphone (lot D : US-014, §2.25).
// Trois étapes : (1) le numéro → un code par SMS ; (2) le code → un ticket d'inscription,
// ou « déjà inscrit » (révélé seulement après le bon code : pas d'énumération des comptes) ;
// (3) le ticket, le prénom et le mot de passe → le compte.

// Numéro saisi librement, ramené à sa forme nationale (9 chiffres)
export const nationalMobileSchema = z
  .string()
  .max(32)
  .transform((value, ctx) => {
    const national = toNationalMobile(value);
    if (!national) {
      ctx.addIssue({
        code: 'custom',
        message: 'Saisissez un numéro de mobile guinéen : 9 chiffres commençant par 6.',
      });
      return z.NEVER;
    }
    return national;
  });

export const signupCodeRequestSchema = z.strictObject({ phone: nationalMobileSchema });
export type SignupCodeRequest = z.input<typeof signupCodeRequestSchema>;

export const SIGNUP_CODE_LENGTH = 6;
export const signupVerifyRequestSchema = z.strictObject({
  phone: nationalMobileSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Le code reçu par SMS compte 6 chiffres.'),
});
export type SignupVerifyRequest = z.input<typeof signupVerifyRequestSchema>;

// Réponse de l'étape 2 : ticket à usage unique (256 bits), ou numéro déjà inscrit
export type SignupVerifyResult = { status: 'new'; ticket: string } | { status: 'existing' };

export const signupTicketSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const personName = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Indiquez votre ${label}.`)
    .max(max, `Le ${label} compte au plus ${max} caractères.`)
    .regex(/^\p{L}[\p{L}\p{M}' -]*$/u, `Le ${label} ne contient que des lettres.`);

// Profil choisi à l'inscription : citoyen (par défaut) ou praticien (US-040a), qui donne
// aussi son nom, porté par le certificat
export const SIGNUP_PROFILES = ['citoyen', 'praticien'] as const;
export type SignupProfile = (typeof SIGNUP_PROFILES)[number];

export const signupCompleteRequestSchema = z
  .strictObject({
    ticket: signupTicketSchema,
    profile: z.enum(SIGNUP_PROFILES).default('citoyen'),
    firstName: personName('prénom', 50),
    lastName: personName('nom', 80).optional(),
    password: z.string().max(CITIZEN_PASSWORD_MAX),
  })
  .refine((request) => request.profile !== 'praticien' || request.lastName !== undefined, {
    message: 'Indiquez votre nom.',
    path: ['lastName'],
  })
  .refine((request) => request.profile !== 'citoyen' || request.lastName === undefined, {
    message: 'Le nom n’est pas demandé pour un compte citoyen.',
    path: ['lastName'],
  });
export type SignupCompleteRequest = z.input<typeof signupCompleteRequestSchema>;

// Le mot de passe dépend du numéro (on refuse son propre numéro) : contrôlé par l'API une
// fois le ticket lu, avec la même fonction que le site public
export { citizenPasswordError };

// Erreur de l'inscription renvoyée au site public (corps des réponses 4xx)
export type SignupErrorCode =
  | 'invalid' // données refusées (message joint)
  | 'code_invalid' // mauvais code ; essais restants joints
  | 'code_expired' // code expiré, épuisé ou jamais demandé
  | 'ticket_invalid' // ticket expiré ou déjà utilisé : recommencer
  | 'too_many'; // trop de demandes : réessayer plus tard (Retry-After)

export interface SignupError {
  error: SignupErrorCode;
  message: string;
  remainingAttempts?: number;
}

// Mot de passe oublié d'un citoyen ou d'un praticien (US-069) : mêmes trois étapes que
// l'inscription. Étape 1 : même réponse que le numéro ait un compte ou non (le SMS ne part que
// s'il en a un) ; étape 2 : le bon code donne un ticket ; étape 3 : le ticket et le nouveau
// mot de passe (règles de US-014).
export const passwordResetCodeRequestSchema = signupCodeRequestSchema;
export const passwordResetVerifyRequestSchema = signupVerifyRequestSchema;
export interface PasswordResetVerifyResult {
  ticket: string;
}
export const passwordResetCompleteRequestSchema = z.strictObject({
  ticket: signupTicketSchema,
  password: z.string().max(CITIZEN_PASSWORD_MAX),
});
export type PasswordResetCompleteRequest = z.input<typeof passwordResetCompleteRequestSchema>;
