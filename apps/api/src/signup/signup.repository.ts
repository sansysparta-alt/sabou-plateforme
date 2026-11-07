import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DATABASE, type Database } from '../database/database';

type Trx = Transaction<never>;

// Accès à la base pour l'inscription des citoyens (lot D). Contraintes de la base : numéro
// mobile guinéen exigé (ck_citoyen), un seul compte citoyen par numéro (index unique).
@Injectable()
export class SignupRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (trx: Trx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => work(trx as unknown as Trx));
  }

  // phone : forme internationale (+224…)
  async citizenExists(phone: string): Promise<boolean> {
    const { rows } = await sql<{ found: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM sabou.utilisateur WHERE role_code = 'citoyen' AND telephone = ${phone}
      ) AS found`.execute(this.db);
    return rows[0]?.found ?? false;
  }

  async createCitizen(
    trx: Trx,
    citizen: { phone: string; firstName: string; keycloakId: string },
  ): Promise<number> {
    const { rows } = await sql<{ id: number }>`
      INSERT INTO sabou.utilisateur (telephone, prenom, role_code, statut, keycloak_id)
      VALUES (${citizen.phone}, ${citizen.firstName}, 'citoyen', 'actif', ${citizen.keycloakId}::uuid)
      RETURNING id::int`.execute(trx);
    return rows[0]!.id;
  }
}
