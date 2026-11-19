import { randomInt } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  citizenPasswordError,
  toInternational,
  type PasswordResetVerifyResult,
} from '@sabou/types';
import { PasswordRejectedError } from '../accounts/identity-admin';
import { AUDIT_LOG, type AuditLog } from '../audit/audit.log';
import { passwordResetCodeMessage, SMS_SENDER, type SmsSender } from '../sms/sms';
import { CITIZEN_IDENTITY, type CitizenIdentity } from './citizen-identity';
import { SignupRepository } from './signup.repository';
import { LIMITS, SignupHttpError } from './signup.service';
import { SIGNUP_CODE_SECONDS, type SignupStore } from './signup.store';

export const PASSWORD_RESET_STORE = Symbol('PASSWORD_RESET_STORE');

// Mot de passe oublié d'un citoyen ou d'un praticien (US-069, §5.2), par un code reçu par SMS.
// - Étape 1 : même réponse, même délai, que le numéro ait un compte ou non ; le SMS ne part que
//   s'il en a un (pas de SMS payé pour un numéro inconnu, rien de révélé à celui qui demande).
// - Étape 2 : code à usage unique, 10 minutes, 5 essais ; le bon code donne un ticket.
// - Étape 3 : nouveau mot de passe (règles de US-014) dans Keycloak, toutes les sessions du
//   compte fermées, réinitialisation journalisée. Le double facteur éventuel n'est pas touché :
//   Keycloak le demande toujours à la connexion suivante.
// Codes, tickets et limites dans un espace de clés Valkey séparé de celui de l'inscription.
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger('Mot de passe oublié');

  constructor(
    @Inject(PASSWORD_RESET_STORE) private readonly store: SignupStore,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(CITIZEN_IDENTITY) private readonly identity: CitizenIdentity,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    private readonly repository: SignupRepository,
  ) {}

  async requestCode(phone: string, ip: string | undefined): Promise<void> {
    await this.limit(`code:ip:${ip ?? 'inconnue'}`, LIMITS.codePerIp);
    await this.limit(`code:tel:${phone}`, LIMITS.codePerPhone);
    const account = await this.repository.findActiveAccount(toInternational(phone));
    if (!account) return;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.store.saveCode(phone, code);
    // Envoi sans attendre le fournisseur : le délai de réponse ne trahit pas le compte
    void this.sms
      .send(toInternational(phone), passwordResetCodeMessage(code, SIGNUP_CODE_SECONDS / 60))
      .catch((error: unknown) => {
        this.logger.error(`SMS du code non envoyé : ${(error as Error).message}`);
      });
  }

  async verify(
    phone: string,
    code: string,
    ip: string | undefined,
  ): Promise<PasswordResetVerifyResult> {
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
    return { ticket: await this.store.issueTicket(phone) };
  }

  async complete(ticket: string, password: string, ip: string | undefined): Promise<void> {
    const phone = await this.store.peekTicket(ticket);
    if (!phone) throw ticketInvalid();
    const refused = citizenPasswordError(password, phone);
    if (refused) {
      throw new SignupHttpError(HttpStatus.BAD_REQUEST, { error: 'invalid', message: refused });
    }
    // Un seul usage, même si deux envois arrivent en même temps
    if ((await this.store.takeTicket(ticket)) !== phone) throw ticketInvalid();
    // Compte relu : suspendu ou retiré depuis l'envoi du code, rien n'est changé
    const account = await this.repository.findActiveAccount(toInternational(phone));
    if (!account) throw ticketInvalid();

    try {
      await this.identity.resetPassword(account.keycloakId, password);
    } catch (error) {
      if (error instanceof PasswordRejectedError) {
        // Ticket rendu : un autre mot de passe sans redemander de code
        await this.store.restoreTicket(ticket, phone);
        throw new SignupHttpError(HttpStatus.BAD_REQUEST, {
          error: 'invalid',
          message: error.message,
        });
      }
      throw error;
    }
    await this.identity.signOutEverywhere(account.keycloakId);
    await this.audit.record({
      action: 'compte.mot_de_passe_reinitialise',
      objectType: 'utilisateur',
      objectId: String(account.id),
      account: account.keycloakId,
      userId: account.id,
      ip,
      details: { moyen: 'sms', sessionsFermees: true },
    });
    this.logger.log(`Mot de passe réinitialisé par SMS : ${account.keycloakId}`);
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
    message: 'Cette demande a expiré. Recommencez avec votre numéro.',
  });
}
