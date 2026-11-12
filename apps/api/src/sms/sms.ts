import { Logger } from '@nestjs/common';

export const SMS_SENDER = Symbol('SMS_SENDER');

// Interface d'envoi unique des SMS (décision du maître d'œuvre, lot D). Le faux fournisseur
// sert au poste local et à la recette ; l'API SMS d'Orange Guinée (nom d'expéditeur
// « SABOU », décision du 12 novembre 2026) sera branchée derrière cette interface à la mise
// en service (05 §2.32).
export interface SmsSender {
  // to : numéro au format international (+224…) ; text : message en français.
  // Rejette une SmsSendError (ou toute erreur) si le fournisseur n'a pas accepté le message.
  send(to: string, text: string): Promise<void>;
}

// Refus du fournisseur. « permanent » : un nouvel essai donnerait le même résultat (numéro
// refusé, nom d'expéditeur non autorisé) ; sinon, le message est réessayé (US-031).
export class SmsSendError extends Error {
  constructor(
    message: string,
    readonly permanent = false,
  ) {
    super(message);
    this.name = 'SmsSendError';
  }
}

// Numéros réservés aux essais de refus (plage +224 669 99…, sans abonné) : le faux fournisseur
// les refuse définitivement, pour vérifier de bout en bout qu'un échec est visible
export const REFUSED_TEST_NUMBERS = /^\+22466999\d{4}$/;

// Faux fournisseur : le message est écrit dans le journal de l'API, rien n'est envoyé.
// Interdit en production par la configuration (SMS_PROVIDER doit y être choisi).
export class JournalSmsSender implements SmsSender {
  private readonly logger = new Logger('SMS');

  send(to: string, text: string): Promise<void> {
    if (REFUSED_TEST_NUMBERS.test(to)) {
      return Promise.reject(new SmsSendError('Numéro refusé par le fournisseur (essai)', true));
    }
    this.logger.log(`SMS factice pour ${to} : ${text}`);
    return Promise.resolve();
  }
}

// Texte du SMS de vérification : en français seulement (langues nationales en voix)
export function signupCodeMessage(code: string, minutes: number): string {
  return `SABOU : votre code est ${code}. Il expire dans ${minutes} minutes. Ne le donnez à personne.`;
}
