import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { NOTIFICATION_QUEUE, PgNotificationQueue } from './notification-queue';
import { JournalSmsSender, SMS_SENDER, type SmsSender } from './sms';
import { SmsDispatcher } from './sms-dispatcher';

// Fournisseur choisi par SMS_PROVIDER. « journal » seulement pour l'instant : l'API d'Orange
// Guinée s'ajoutera ici à la mise en service, sans toucher aux domaines qui envoient.
export function createSmsSender(env: Env): SmsSender {
  switch (env.SMS_PROVIDER) {
    case 'journal':
      return new JournalSmsSender();
  }
}

// Envoi des SMS (US-031) : un seul fournisseur pour toute l'API (codes d'inscription,
// messages de la file des décisions)
@Global()
@Module({
  providers: [
    { provide: SMS_SENDER, inject: [ENV], useFactory: createSmsSender },
    { provide: NOTIFICATION_QUEUE, useClass: PgNotificationQueue },
    SmsDispatcher,
  ],
  exports: [SMS_SENDER],
})
export class SmsModule {}
