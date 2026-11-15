import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  LocalNameCreate,
  LocalNamesPlant,
  LocalNamesPlantSummary,
  RecordingLanguage,
} from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone, type ZoneTrx } from '../database/zone';

export class LocalNameNotAllowedError extends Error {}
export class LocalNamePlantNotFoundError extends Error {}
export class LocalNameNotFoundError extends Error {}
export class LocalNameTakenError extends Error {}
export class LocalNameVoiceError extends Error {}

// Liste de choix d'une plante : quelques centaines de fiches, la recherche resserre au-delà
export const LOCAL_NAMES_PLANT_LIMIT = 50;

// Messages des fonctions plante_nom_local_* (20261115160000_noms_locaux.sql) ; chaque branche
// est couverte sur un vrai PostgreSQL (packages/db/test/noms-locaux.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (message.includes('réservé au référent de la langue')) throw new LocalNameNotAllowedError();
  if (message.includes('Acteur inconnu ou suspendu')) throw new LocalNameNotAllowedError();
  if (/Plante .* introuvable/.test(message)) throw new LocalNamePlantNotFoundError();
  if (/Nom local \d+ introuvable/.test(message)) throw new LocalNameNotFoundError();
  if (message.includes('déjà saisi')) throw new LocalNameTakenError();
  if (/Voix \d+ absente/.test(message)) throw new LocalNameVoiceError();
  throw error;
}

const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

// Noms locaux des plantes (US-053). La base écrit les noms (plante_nom_local_*), vérifie le
// droit d'enregistrer dans la langue et trace au journal d'audit ; l'acteur est celui du
// contexte ouvert par inZone pour le compte connecté.
@Injectable()
export class LocalNamesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // Langues de voix où le compte connecté est référent (droit d'enregistrer)
  languages(sub: string): Promise<RecordingLanguage[]> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<RecordingLanguage>`
        SELECT l.code, l.nom_fr AS nom
          FROM sabou.utilisateur_langue ul
          JOIN sabou.langue l ON l.code = ul.langue_code
         WHERE ul.utilisateur_id = sabou.contexte_utilisateur() AND ul.peut_enregistrer
           AND l.voix AND l.active
         ORDER BY l.ordre, l.nom_fr`.execute(trx);
      return rows;
    });
  }

  plants(sub: string, q?: string): Promise<LocalNamesPlantSummary[]> {
    const term = q ? `%${likeEscape(q)}%` : null;
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<LocalNamesPlantSummary>`
        SELECT p.code, p.nom_scientifique AS "nomScientifique", p.nom_fr AS "nomFr",
               (SELECT count(*)::int FROM sabou.plante_nom_local n WHERE n.plante_id = p.id)
                 AS noms
          FROM sabou.plante p
         WHERE ${term}::text IS NULL
            OR sabou.f_norm(p.nom_fr) LIKE sabou.f_norm(${term})
            OR sabou.f_norm(p.nom_scientifique) LIKE sabou.f_norm(${term})
            OR p.code = upper(${q ?? null})
         ORDER BY p.nom_fr, p.code
         LIMIT ${LOCAL_NAMES_PLANT_LIMIT}`.execute(trx);
      return rows;
    });
  }

  plant(sub: string, code: string): Promise<LocalNamesPlant> {
    return inZone(this.db, sub, (trx) => this.read(trx, code));
  }

  add(sub: string, ip: string | undefined, input: LocalNameCreate): Promise<LocalNamesPlant> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      await sql`
        SELECT 1 FROM sabou.plante_nom_local_ajouter(${input.plante}, ${input.langue},
                 ${input.transcription}, ${input.principal}, ${input.depot}::bigint)`
        .execute(trx)
        .catch(translate);
      return this.read(trx, input.plante);
    });
  }

  makePrincipal(sub: string, ip: string | undefined, id: number): Promise<LocalNamesPlant> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const code = await this.plantOf(trx, id);
      await sql`SELECT 1 FROM sabou.plante_nom_local_principal(${id}::bigint)`
        .execute(trx)
        .catch(translate);
      return this.read(trx, code);
    });
  }

  remove(sub: string, ip: string | undefined, id: number): Promise<LocalNamesPlant> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const code = await this.plantOf(trx, id);
      await sql`SELECT sabou.plante_nom_local_retirer(${id}::bigint)`.execute(trx).catch(translate);
      return this.read(trx, code);
    });
  }

  private async plantOf(trx: ZoneTrx, id: number): Promise<string> {
    const { rows } = await sql<{ code: string }>`
      SELECT p.code FROM sabou.plante_nom_local n JOIN sabou.plante p ON p.id = n.plante_id
       WHERE n.id = ${id}`.execute(trx);
    if (!rows[0]) throw new LocalNameNotFoundError();
    return rows[0].code;
  }

  // Noms de toutes les langues ; « modifiable » pour celles où le compte est référent
  private async read(trx: ZoneTrx, code: string): Promise<LocalNamesPlant> {
    const { rows } = await sql<Omit<LocalNamesPlant, 'noms'>>`
      SELECT code, nom_scientifique AS "nomScientifique", nom_fr AS "nomFr"
        FROM sabou.plante WHERE code = ${code}`.execute(trx);
    const plant = rows[0];
    if (!plant) throw new LocalNamePlantNotFoundError();
    const names = await sql<LocalNamesPlant['noms'][number]>`
      SELECT n.id::int AS id, n.langue_code AS langue, l.nom_fr AS "langueNom",
             n.transcription_recherche AS transcription, n.principal,
             n.audio_id IS NOT NULL AS voix,
             EXISTS (SELECT 1 FROM sabou.utilisateur_langue ul
                      WHERE ul.utilisateur_id = sabou.contexte_utilisateur()
                        AND ul.langue_code = n.langue_code AND ul.peut_enregistrer) AS modifiable
        FROM sabou.plante_nom_local n
        JOIN sabou.plante p ON p.id = n.plante_id
        JOIN sabou.langue l ON l.code = n.langue_code
       WHERE p.code = ${code}
       ORDER BY l.ordre, l.nom_fr, n.principal DESC, n.cree_le, n.id`.execute(trx);
    return { ...plant, noms: names.rows };
  }
}
