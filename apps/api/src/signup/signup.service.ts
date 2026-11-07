import { randomInt } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  citizenPasswordError,
  toInternational,
  type SignupError,
  type SignupProfile,
  type SignupVerifyResult,
} from '@sabou/types';
import { AccountExistsError, PasswordRejectedError } from '../accounts/identity-admin';
import { AUDIT_LOG, type AuditLog } from '../audit/audit.log';
import { CITIZEN_IDENTITY, type CitizenIdentity } from './citizen-identity';
import { SignupRepository } from './signup.repository';
import { SIGNUP_CODE_SECONDS, SIGNUP_STORE, type SignupStore } from './signup.store';
import { signupCodeMessage, SMS_SENDER, type SmsSender } from './sms';

// Limites contre l'envoi de SMS en masse (coût) et la recherche du code (lot D, §2.25).
// Par adresse IP, des limites larges : en Guinée, beaucoup d'abonnés mobiles partagent
// une même adresse publique (NAT des opérateurs).
export const LIMITS = {
  codePerPhone: { limit: 3, windowSeconds: 60 * 60 },
  codePerIp: { limit: 20, windowSeconds: 60 * 60 },
  verifyPerIp: { limit: 60, windowSeconds: 60 * 60 },
} as const;

export class SignupHttpError extends HttpException {
  constructor(status: HttpStatus, body: SignupError, retryAfter?: number) {
    super({ ...body, ...(retryAfter ? { retryAfter } : {}) }, status);
  }
}

export type SignupCompleteResult = { status: 'created' } | { status: 'existing' };

// Inscription d'un citoyen (US-014) en trois étapes : code par SMS, vérification du code,
// création du compte. Que le numéro ait déjà un compte n'est dit qu'après le bon code.
@Injectable()
export class SignupService {
  private readonly logger = new Logger('Inscription');

  constructor(
    @Inject(SIGNUP_STORE) private readonly store: SignupStore,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(CITIZEN_IDENTITY) private readonly identity: CitizenIdentity,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    private readonly repository: SignupRepository,
  ) {}

  // Étape 1 : même réponse que le numéro soit inscrit ou non (rien n'est révélé)
  async requestCode(phone: string, ip: string | undefined): Promise<void> {
    await this.limit(`code:ip:${ip ?? 'inconnue'}`, LIMITS.codePerIp);
    await this.limit(`code:tel:${phone}`, LIMITS.codePerPhone);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.store.saveCode(phone, code);
    await this.sms.send(toInternational(phone), signupCodeMessage(code, SIGNUP_CODE_SECONDS / 60));
  }

  // Étape 2 : le bon code donne un ticket d'inscription, ou « déjà inscrit »
  async verify(phone: string, code: string, ip: string | undefined): Promise<SignupVerifyResult> {
    await this.limit(`verification:ip:${ip ?? 'inconnue'}`, LIMITS.verifyPerIp);
    const check = await this.store.checkCode(phone, code);
    if (check.result === 'expired') {
      throw new SignupHttpError(HttpStatus.BAD_REQUEST, {
        error: 'code_expired',
        message: 'Ce code a expiré ou a été trop souvent mal saisi. Demandez un nouveau code.',
      });
    }
    if (check.result === 'invalid') {
      throw new SignupHttpError(HttpStatus.BAD_REQUEST, {
        error: 'code_invalid',
        message: 'Code incorrect.',
        remainingAttempts: check.remainingAttempts,
      });
    }
    if (await this.repository.accountExists(toInternational(phone))) return { status: 'existing' };
    return { status: 'new', ticket: await this.store.issueTicket(phone) };
  }

  // Étape 3 : création du compte Keycloak, puis de l'utilisateur et de sa ligne d'audit.
  // Profil citoyen, ou praticien (US-040a), qui ouvre ensuite sa fiche et son dossier.
  async complete(
    ticket: string,
    person: { profile: SignupProfile; firstName: string; lastName?: string },
    password: string,
    ip: string | undefined,
  ): Promise<SignupCompleteResult> {
    const { profile, firstName, lastName } = person;
    const phone = await this.store.peekTicket(ticket);
    if (!phone) throw ticketInvalid();
    const refused = citizenPasswordError(password, phone);
    if (refused) {
      throw new SignupHttpError(HttpStatus.BAD_REQUEST, { error: 'invalid', message: refused });
    }
    // Un seul usage, même si deux envois arrivent en même temps
    if ((await this.store.takeTicket(ticket)) !== phone) throw ticketInvalid();

    let keycloakId: string;
    try {
      keycloakId = await this.identity.createAccount({
        username: phone,
        firstName,
        ...(lastName ? { lastName } : {}),
        password,
        role: profile,
      });
    } catch (error) {
      if (error instanceof AccountExistsError) return { status: 'existing' };
      if (error instanceof PasswordRejectedError) {
        // Ticket rendu : le citoyen choisit un autre mot de passe sans redemander de code
        await this.store.restoreTicket(ticket, phone);
        throw new SignupHttpError(HttpStatus.BAD_REQUEST, {
          error: 'invalid',
          message: error.message,
        });
      }
      throw error;
    }

    try {
      await this.repository.transaction(async (trx) => {
        const userId = await this.repository.createAccount(trx, {
          phone: toInternational(phone),
          firstName,
          ...(lastName ? { lastName } : {}),
          role: profile,
          keycloakId,
        });
        await this.audit.record(
          {
            action: 'compte.inscription',
            objectType: 'utilisateur',
            objectId: String(userId),
            account: keycloakId,
            userId,
            ip,
            details: { role: profile },
          },
          trx,
        );
      });
    } catch (error) {
      // Pas de compte Keycloak sans utilisateur ni ligne d'audit
      await this.identity.deleteAccount(keycloakId).catch((cause: unknown) => {
        this.logger.error(
          `Compte Keycloak ${keycloakId} à retirer à la main : ${(cause as Error).message}`,
        );
      });
      if ((error as { constraint?: string }).constraint === 'ux_utilisateur_telephone_public') {
        return { status: 'existing' };
      }
      throw error;
    }
    this.logger.log(`Compte ${profile} créé : ${keycloakId}`);
    return { status: 'created' };
  }

  private async limit(
    key: string,
    { limit, windowSeconds }: { limit: number; windowSeconds: number },
  ): Promise<void> {
    const retryAfter = await this.store.hit(key, limit, windowSeconds);
    if (retryAfter !== null) {
      throw new SignupHttpError(
        HttpStatus.TOO_MANY_REQUESTS,
        { error: 'too_many', message: 'Trop de demandes. Réessayez plus tard.' },
        retryAfter,
      );
    }
  }
}

function ticketInvalid(): SignupHttpError {
  return new SignupHttpError(HttpStatus.BAD_REQUEST, {
    error: 'ticket_invalid',
    message: 'Cette inscription a expiré. Recommencez avec votre numéro.',
  });
}
