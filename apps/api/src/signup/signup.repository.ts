import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { SignupProfile } from '@sabou/types';
import { DATABASE, type Database } from '../database/database';

type Trx = Transaction<never>;

// Accès à la base pour l'inscription des citoyens (lot D) et des praticiens (US-040a).
// Contraintes de la base : numéro mobile guinéen exigé (ck_citoyen, ck_praticien), un seul
// compte du domaine public par numéro (ux_utilisateur_telephone_public).
@Injectable()
export class SignupRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (trx: Trx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => work(trx as unknown as Trx));
  }

  // phone : forme internationale (+224…)
  async accountExists(phone: string): Promise<boolean> {
    const { rows } = await sql<{ found: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM sabou.utilisateur
         WHERE role_code IN ('citoyen', 'praticien') AND telephone = ${phone}
      ) AS found`.execute(this.db);
    return rows[0]?.found ?? false;
  }

  async createAccount(
    trx: Trx,
    account: {
      phone: string;
      firstName: string;
      lastName?: string;
      role: SignupProfile;
      keycloakId: string;
    },
  ): Promise<number> {
    const { rows } = await sql<{ id: number }>`
      INSERT INTO sabou.utilisateur (telephone, prenom, nom, role_code, statut, keycloak_id)
      VALUES (${account.phone}, ${account.firstName}, ${account.lastName ?? null}, ${account.role},
              'actif', ${account.keycloakId}::uuid)
      RETURNING id::int`.execute(trx);
    return rows[0]!.id;
  }
}
