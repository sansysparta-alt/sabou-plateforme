import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { DiseaseDetail, DiseaseFields, DiseaseSummary, DiseaseUpdate } from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone, type ZoneTrx } from '../database/zone';

export class DiseaseNotFoundError extends Error {}
export class DiseaseNotAllowedError extends Error {}
export class DiseaseStaleError extends Error {}
export class DiseaseNameTakenError extends Error {
  constructor(readonly code: string) {
    super(`Nom français déjà utilisé par la fiche ${code}`);
  }
}

export const DISEASE_LIST_LIMIT = 200;

// Messages de maladie_creer et maladie_modifier (20261115140000_fiches_maladies.sql) ; chaque
// branche est couverte sur un vrai PostgreSQL (packages/db/test/fiches-maladies.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (message.includes('réservées à la DG et au Comité scientifique')) {
    throw new DiseaseNotAllowedError();
  }
  const taken = /déjà utilisé par la fiche (MA-\d+)/.exec(message);
  if (taken) throw new DiseaseNameTakenError(taken[1]!);
  if (message.includes('modifiée entre-temps')) throw new DiseaseStaleError();
  if (/Maladie MA-\d+ introuvable/.test(message)) throw new DiseaseNotFoundError();
  throw error;
}

// Fiches maladies du Dictionnaire (US-052). La recherche passe par rechercher_maladie, celle du
// public : nom français, anglais ou dénomination, sans accents, tolérante aux fautes.
@Injectable()
export class DiseasesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(sub: string, q?: string): Promise<DiseaseSummary[]> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<DiseaseSummary>`
        SELECT m.code, m.nom_fr AS "nomFr", m.nom_en AS "nomEn",
               COALESCE((SELECT array_agg(d.denomination ORDER BY d.denomination)
                           FROM sabou.maladie_denomination d WHERE d.maladie_id = m.id), '{}')
                 AS denominations
          FROM sabou.maladie m
         WHERE ${q ?? null}::text IS NULL
            OR m.code = upper(${q ?? null})
            OR m.code IN (SELECT r.maladie_code FROM sabou.rechercher_maladie(${q ?? ''}) r)
         ORDER BY m.nom_fr, m.code
         LIMIT ${DISEASE_LIST_LIMIT}`.execute(trx);
      return rows;
    });
  }

  detail(sub: string, code: string): Promise<DiseaseDetail> {
    return inZone(this.db, sub, (trx) => this.read(trx, code));
  }

  create(sub: string, ip: string | undefined, fields: DiseaseFields): Promise<DiseaseDetail> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const { rows } = await sql<{ code: string }>`
        SELECT code FROM sabou.maladie_creer(${fields.nomFr}, ${fields.nomEn},
                 ${fields.symptomesFr}, ${fields.symptomesEn},
                 ${JSON.stringify(fields.denominations)}::jsonb)`
        .execute(trx)
        .catch(translate);
      return this.read(trx, rows[0]!.code);
    });
  }

  update(
    sub: string,
    ip: string | undefined,
    code: string,
    input: DiseaseUpdate,
  ): Promise<DiseaseDetail> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      await sql`
        SELECT 1 FROM sabou.maladie_modifier(${code}, ${input.vueLe}::timestamptz, ${input.nomFr},
                 ${input.nomEn}, ${input.symptomesFr}, ${input.symptomesEn},
                 ${JSON.stringify(input.denominations)}::jsonb)`
        .execute(trx)
        .catch(translate);
      return this.read(trx, code);
    });
  }

  private async read(trx: ZoneTrx, code: string): Promise<DiseaseDetail> {
    const { rows } = await sql<DiseaseDetail>`
      SELECT m.code, m.nom_fr AS "nomFr", m.nom_en AS "nomEn", m.symptomes_fr AS "symptomesFr",
             m.symptomes_en AS "symptomesEn",
             COALESCE((SELECT jsonb_agg(jsonb_build_object('langue', d.langue_code,
                                                           'denomination', d.denomination)
                                        ORDER BY d.langue_code, d.denomination)
                         FROM sabou.maladie_denomination d WHERE d.maladie_id = m.id), '[]')
               AS denominations,
             to_char(m.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "modifieLe"
        FROM sabou.maladie m WHERE m.code = ${code}`.execute(trx);
    const disease = rows[0];
    if (!disease) throw new DiseaseNotFoundError();
    return disease;
  }
}
