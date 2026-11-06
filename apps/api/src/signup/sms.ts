import { Logger } from '@nestjs/common';

export const SMS_SENDER = Symbol('SMS_SENDER');

// Interface d'envoi unique des SMS (décision du maître d'œuvre, lot D) : le faux fournisseur
// sert au poste local et à la recette ; l'agrégateur réel (nom d'expéditeur « SABOU »)
// arrive avec US-031, derrière la même interface.
export interface SmsSender {
  // to : numéro au format international (+224…) ; text : message en français
  send(to: string, text: string): Promise<void>;
}

// Faux fournisseur : le message est écrit dans le journal de l'API, rien n'est envoyé.
// Interdit en production par la configuration (SMS_PROVIDER doit y être choisi).
export class JournalSmsSender implements SmsSender {
  private readonly logger = new Logger('SMS');

  send(to: string, text: string): Promise<void> {
    this.logger.log(`SMS factice pour ${to} : ${text}`);
    return Promise.resolve();
  }
}

// Texte du SMS de vérification : en français seulement (langues nationales en voix)
export function signupCodeMessage(code: string, minutes: number): string {
  return `SABOU : votre code est ${code}. Il expire dans ${minutes} minutes. Ne le donnez à personne.`;
}
