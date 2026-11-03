import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type Database } from '../database/database';
import type { UploadOperation, UploadResult } from './sync.schema';

export const SYNC_REPOSITORY = Symbol('SYNC_REPOSITORY');

export interface SyncRepository {
  receive(agentId: number, operations: UploadOperation[]): Promise<UploadResult[]>;
}

// Code PostgreSQL d'un RAISE EXCEPTION : refus d'une règle métier, définitif
const RULE_VIOLATION = 'P0001';

@Injectable()
export class PgSyncRepository implements SyncRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // Un lot, une transaction ; un point de sauvegarde par opération : un refus n'annule
  // pas les autres. Toute autre erreur annule le lot, que le téléphone renverra.
  async receive(agentId: number, operations: UploadOperation[]): Promise<UploadResult[]> {
    return this.db.transaction().execute(async (trx) => {
      const results: UploadResult[] = [];
      for (const op of operations) {
        if (op.op === 'DELETE') {
          // Un agent ne supprime pas un dossier : la synchronisation suivante le rétablit
          results.push({ id: op.id, result: 'refusee' });
          continue;
        }
        await sql`SAVEPOINT operation`.execute(trx);
        try {
          const { rows } = await sql<{ result: UploadResult['result'] }>`
            SELECT sabou.saisie_terrain_recevoir(${op.id}::uuid, ${op.type}, ${agentId},
                   ${JSON.stringify(op.contenu)}::jsonb, ${op.version_base}) AS result`.execute(
            trx,
          );
          await sql`RELEASE SAVEPOINT operation`.execute(trx);
          results.push({ id: op.id, result: rows[0]!.result });
        } catch (error) {
          if ((error as { code?: string }).code !== RULE_VIOLATION) throw error;
          await sql`ROLLBACK TO SAVEPOINT operation`.execute(trx);
          results.push({ id: op.id, result: 'refusee' });
        }
      }
      return results;
    });
  }
}
