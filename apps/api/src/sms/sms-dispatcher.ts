import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { NOTIFICATION_QUEUE, type NotificationQueue, type SmsOutcome } from './notification-queue';
import { notificationText } from './sms-messages';
import { SMS_SENDER, SmsSendError, type SmsSender } from './sms';

// Messages relevés à chaque passage : à 5 SMS par seconde (limite de l'API d'Orange), un
// lot part en une dizaine de secondes, bien avant le passage suivant
export const BATCH_SIZE = 50;

// Envoi des SMS mis en file par les décisions (US-031). Le message est écrit dans la même
// transaction que la décision : une décision annulée n'envoie rien. La file est relevée
// toutes les SMS_POLL_SECONDS : le SMS part dans les 5 minutes. En cas d'erreur, la base
// reprogramme 3 nouveaux essais (1, 5, 15 min), puis marque l'échec, visible par la DG.
@Injectable()
export class SmsDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('SMS');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(NOTIFICATION_QUEUE) private readonly queue: NotificationQueue,
    @Inject(SMS_SENDER) private readonly sender: SmsSender,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.SMS_POLL_SECONDS === 0) return;
    this.timer = setInterval(() => void this.dispatch(), this.env.SMS_POLL_SECONDS * 1000);
    // N'empêche pas le processus de s'arrêter
    this.timer.unref();
    void this.dispatch();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  // Un seul passage à la fois ; une base injoignable est journalisée et le passage suivant
  // reprend. Renvoie le nombre de messages traités.
  dispatch(): Promise<number> {
    this.running ??= this.dispatchOnce()
      .catch((error: unknown) => {
        this.logger.warn(`Relève de la file des SMS impossible : ${(error as Error).message}`);
        return 0;
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async dispatchOnce(): Promise<number> {
    // Rappels de visite (US-041) : mis en file avant la relève, ils partent dans ce passage
    await this.queue.queueVisitReminders();
    const messages = await this.queue.take(BATCH_SIZE);
    // Un à un : le fournisseur limite le débit, et une erreur n'arrête pas le lot
    for (const message of messages) {
      const text = notificationText(message);
      let outcome: SmsOutcome;
      if (message.telephone === null) {
        outcome = await this.queue.record(message.id, 'Aucun numéro de téléphone', true);
      } else if (text === null) {
        outcome = await this.queue.record(message.id, `Modèle inconnu : ${message.modele}`, true);
      } else {
        outcome = await this.sender.send(message.telephone, text).then(
          () => this.queue.record(message.id, null),
          (error: unknown) =>
            this.queue.record(
              message.id,
              (error as Error).message || 'Erreur inconnue du fournisseur',
              error instanceof SmsSendError && error.permanent,
            ),
        );
      }
      // Le numéro n'est pas journalisé : le code du dossier suffit à retrouver le message
      if (outcome === 'echec') {
        this.logger.error(`SMS ${message.modele} du dossier ${message.objet} non remis (échec)`);
      } else if (outcome === 'en_attente') {
        this.logger.warn(`SMS ${message.modele} du dossier ${message.objet} : nouvel essai prévu`);
      }
    }
    return messages.length;
  }
}
