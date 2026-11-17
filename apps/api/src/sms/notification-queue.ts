import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type Database } from '../database/database';
import type { QueuedMessage } from './sms-messages';

export const NOTIFICATION_QUEUE = Symbol('NOTIFICATION_QUEUE');

// Durée pendant laquelle un message relevé est réservé à cette instance de l'API : au-delà
// (processus arrêté pendant l'envoi), il revient dans la file
export const LEASE_SECONDS = 120;

export interface QueuedSms {
  id: string;
  // Numéro du destinataire (+224…), null si le compte n'en a pas
  telephone: string | null;
  modele: string;
  objet: string;
  parametres: QueuedMessage['parametres'];
}

export interface CertificateDeadlines {
  expired: number;
  reminders: number;
}

export type SmsOutcome = 'envoyee' | 'en_attente' | 'echec';

// File des SMS (table notification), tenue par les fonctions de la base (migration
// 20261112120000) : relève sans doublon entre instances, délais et nombre d'essais
export interface NotificationQueue {
  // Met en file les rappels de visite dus (la veille, à partir de 8 h) ; renvoie leur nombre
  queueVisitReminders(): Promise<number>;
  // Échéances des certificats (US-049) : expire ceux qui sont échus et met en file les
  // invitations à renouveler (60 jours avant, à partir de 8 h) ; renvoie les deux nombres
  processCertificateDeadlines(): Promise<CertificateDeadlines>;
  take(limit: number): Promise<QueuedSms[]>;
  // error null : envoyé ; definitive : pas de nouvel essai
  record(id: string, error: string | null, definitive?: boolean): Promise<SmsOutcome>;
}

@Injectable()
export class PgNotificationQueue implements NotificationQueue {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async queueVisitReminders(): Promise<number> {
    const { rows } = await sql<{ nombre: number }>`
      SELECT sabou.visite_rappels_mettre_en_file() AS nombre`.execute(this.db);
    return rows[0]!.nombre;
  }

  async processCertificateDeadlines(): Promise<CertificateDeadlines> {
    const { rows } = await sql<CertificateDeadlines>`
      SELECT expires AS expired, relances AS reminders
        FROM sabou.certificats_echeances_traiter()`.execute(this.db);
    return rows[0]!;
  }

  async take(limit: number): Promise<QueuedSms[]> {
    const { rows } = await sql<QueuedSms>`
      SELECT id::text, telephone, modele, objet_id AS objet, parametres
        FROM sabou.notification_sms_prendre(${limit}, make_interval(secs => ${LEASE_SECONDS}))`.execute(
      this.db,
    );
    return rows;
  }

  async record(id: string, error: string | null, definitive = false): Promise<SmsOutcome> {
    const { rows } = await sql<{ statut: SmsOutcome }>`
      SELECT sabou.notification_sms_resultat(${id}::bigint, ${error}, ${definitive}) AS statut`.execute(
      this.db,
    );
    return rows[0]!.statut;
  }
}
