import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone } from '../database/zone';

export class VoiceDepositNotAllowedError extends Error {}

export interface VoiceDepositState {
  depot: number;
  statut: 'en_attente' | 'en_cours' | 'traitee' | 'echec';
  erreur: string | null;
  // Voix publiée : durée (secondes), taille (octets) et empreinte SHA-256 du fichier Opus
  dureeSec: number | null;
  tailleOctets: number | null;
  sha256: string | null;
}

export interface PendingVoice {
  id: number;
  key: string;
  mime: string;
  attempts: number;
}

// Dépôts et file de traitement des voix (US-070). Le dépôt passe par le contexte du compte
// connecté (voix_deposer) ; la file est relevée par l'API sans contexte d'utilisateur.
@Injectable()
export class VoicesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  deposit(
    sub: string,
    ip: string | undefined,
    file: { key: string; mime: string; size: number; sha256: string },
    consent: boolean,
  ): Promise<VoiceDepositState> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const { rows } = await sql<{ id: number }>`
        SELECT id::int FROM sabou.voix_deposer(${file.key}, ${file.mime}, ${file.size},
                                                ${file.sha256}, ${consent})`
        .execute(trx)
        .catch((error: unknown) => {
          if ((error as Error).message?.includes('non autorisé pour ce profil')) {
            throw new VoiceDepositNotAllowedError();
          }
          throw error;
        });
      return {
        depot: rows[0]!.id,
        statut: 'en_attente',
        erreur: null,
        dureeSec: null,
        tailleOctets: null,
        sha256: null,
      };
    });
  }

  // État d'un dépôt, pour son seul dépositaire (null sinon)
  state(sub: string, depot: number): Promise<VoiceDepositState | null> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<Omit<VoiceDepositState, 'depot'>>`
        SELECT statut, erreur, duree_sec::float AS "dureeSec", taille_octets AS "tailleOctets",
               sha256
          FROM sabou.voix_depot_etat(${depot})`.execute(trx);
      return rows[0] ? { depot, ...rows[0] } : null;
    });
  }

  async take(limit: number): Promise<PendingVoice[]> {
    const { rows } = await sql<PendingVoice>`
      SELECT id::int, cle_originale AS key, type_mime AS mime, tentatives AS attempts
        FROM sabou.voix_depots_prendre(${limit})`.execute(this.db);
    return rows;
  }

  async complete(
    id: number,
    result: {
      key: string;
      fallbackKey: string;
      duration: number;
      size: number;
      fallbackSize: number;
      sha256: string;
    },
  ): Promise<void> {
    await sql`
      SELECT sabou.voix_depot_terminer(${id}, ${result.key}, ${result.fallbackKey},
               ${result.duration}, ${result.size}, ${result.fallbackSize}, ${result.sha256})`.execute(
      this.db,
    );
  }

  async fail(id: number, reason: string): Promise<string | null> {
    const { rows } = await sql<{ statut: string | null }>`
      SELECT sabou.voix_depot_echouer(${id}, ${reason}) AS statut`.execute(this.db);
    return rows[0]?.statut ?? null;
  }
}
