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

export const signupCompleteRequestSchema = z.strictObject({
  ticket: signupTicketSchema,
  firstName: z
    .string()
    .trim()
    .min(1, 'Indiquez votre prénom.')
    .max(50, 'Le prénom compte au plus 50 caractères.')
    .regex(/^\p{L}[\p{L}\p{M}' -]*$/u, 'Le prénom ne contient que des lettres.'),
  password: z.string().max(CITIZEN_PASSWORD_MAX),
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
