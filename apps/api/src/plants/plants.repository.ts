import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  PlantDetail,
  PlantFields,
  PlantImage,
  PlantImageFields,
  PlantSummary,
  PlantUpdate,
} from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import { DATABASE, type Database } from '../database/database';
import { inZone, type ZoneTrx } from '../database/zone';

export class PlantNotFoundError extends Error {}
export class PlantImageNotFoundError extends Error {}
export class PlantNotAllowedError extends Error {}
export class PlantStaleError extends Error {}
export class PlantPrincipalImageError extends Error {}
export class PlantNameTakenError extends Error {
  constructor(readonly code: string) {
    super(`Nom scientifique déjà utilisé par la fiche ${code}`);
  }
}

// Fiches renvoyées par une liste : le Dictionnaire en compte quelques centaines, la
// recherche resserre au-delà
export const PLANT_LIST_LIMIT = 200;

// Messages des fonctions plante_* (20261115120000_fiche_plante.sql) ; chaque branche est
// couverte sur un vrai PostgreSQL (packages/db/test/fiche-plante.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (message.includes('réservées à la DG et au Comité scientifique')) {
    throw new PlantNotAllowedError();
  }
  const taken = /déjà utilisé par la fiche (PL-\d+)/.exec(message);
  if (taken) throw new PlantNameTakenError(taken[1]!);
  if (message.includes('modifiée entre-temps')) throw new PlantStaleError();
  if (/Plante PL-\d+ introuvable/.test(message)) throw new PlantNotFoundError();
  if (/Photo \d+ introuvable/.test(message)) throw new PlantImageNotFoundError();
  if (message.includes('marquer une autre photo principale')) {
    throw new PlantPrincipalImageError();
  }
  throw error;
}

// Caractères spéciaux de LIKE neutralisés : la saisie est cherchée telle quelle
const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface StoredImage {
  key: string;
  sha256: string;
  mime: string;
  size: number;
}

// Fiches plantes du Dictionnaire (US-050). La base écrit les fiches et leurs photos
// (plante_creer, plante_image_ajouter…), contrôle le rôle et trace au journal d'audit ;
// l'acteur est celui du contexte ouvert par inZone pour le compte connecté.
@Injectable()
export class PlantsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(sub: string, q?: string): Promise<PlantSummary[]> {
    const term = q ? `%${likeEscape(q)}%` : null;
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<PlantSummary>`
        SELECT p.code, p.nom_scientifique AS "nomScientifique", p.nom_fr AS "nomFr", p.famille,
               p.statut,
               (SELECT i.id::int FROM sabou.plante_image i
                 WHERE i.plante_id = p.id AND i.principale) AS image
          FROM sabou.plante p
         WHERE ${term}::text IS NULL
            OR sabou.f_norm(p.nom_fr) LIKE sabou.f_norm(${term})
            OR sabou.f_norm(p.nom_scientifique) LIKE sabou.f_norm(${term})
            OR sabou.f_norm(coalesce(p.nom_en, '')) LIKE sabou.f_norm(${term})
            OR p.code = upper(${q ?? null})
         ORDER BY p.nom_fr, p.code
         LIMIT ${PLANT_LIST_LIMIT}`.execute(trx);
      return rows;
    });
  }

  detail(sub: string, code: string): Promise<PlantDetail> {
    return inZone(this.db, sub, (trx) => this.read(trx, code));
  }

  create(sub: string, ip: string | undefined, fields: PlantFields): Promise<PlantDetail> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const { rows } = await sql<{ code: string }>`
        SELECT code FROM sabou.plante_creer(${fields.nomScientifique}, ${fields.famille},
                                            ${fields.nomFr}, ${fields.nomEn})`
        .execute(trx)
        .catch(translate);
      return this.read(trx, rows[0]!.code);
    });
  }

  update(
    sub: string,
    ip: string | undefined,
    code: string,
    input: PlantUpdate,
  ): Promise<PlantDetail> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      await sql`
        SELECT 1 FROM sabou.plante_modifier(${code}, ${input.vueLe}::timestamptz,
                 ${input.nomScientifique}, ${input.famille}, ${input.nomFr}, ${input.nomEn})`
        .execute(trx)
        .catch(translate);
      return this.read(trx, code);
    });
  }

  addImage(
    sub: string,
    ip: string | undefined,
    code: string,
    file: StoredImage,
    fields: PlantImageFields,
  ): Promise<PlantDetail> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      await sql`
        SELECT 1 FROM sabou.plante_image_ajouter(${code}, ${file.key}, ${file.sha256},
                 ${file.mime}, ${file.size}, ${fields.alt}, ${fields.altEn}, ${fields.type},
                 ${fields.principale})`
        .execute(trx)
        .catch(translate);
      return this.read(trx, code);
    });
  }

  updateImage(
    sub: string,
    ip: string | undefined,
    code: string,
    image: number,
    fields: PlantImageFields,
  ): Promise<PlantDetail> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      await sql`
        SELECT 1 FROM sabou.plante_image_modifier(${code}, ${image}, ${fields.alt},
                 ${fields.altEn}, ${fields.type}, ${fields.principale})`
        .execute(trx)
        .catch(translate);
      return this.read(trx, code);
    });
  }

  // Retire la photo ; renvoie la fiche et la clé du fichier à retirer du stockage
  removeImage(
    sub: string,
    ip: string | undefined,
    code: string,
    image: number,
  ): Promise<{ plant: PlantDetail; key: string }> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const { rows } = await sql<{ key: string }>`
        SELECT sabou.plante_image_retirer(${code}, ${image}) AS key`
        .execute(trx)
        .catch(translate);
      return { plant: await this.read(trx, code), key: rows[0]!.key };
    });
  }

  // Fichier d'une photo, si elle appartient bien à la fiche
  imageFile(sub: string, code: string, image: number): Promise<{ key: string; mime: string }> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<{ key: string; mime: string | null }>`
        SELECT i.image_url AS key, i.type_mime AS mime
          FROM sabou.plante_image i JOIN sabou.plante p ON p.id = i.plante_id
         WHERE p.code = ${code} AND i.id = ${image}`.execute(trx);
      const row = rows[0];
      // Photos du jeu d'exemple sans fichier (type inconnu) : introuvables comme les autres
      if (!row?.mime) throw new PlantImageNotFoundError();
      return { key: row.key, mime: row.mime };
    });
  }

  private async read(trx: ZoneTrx, code: string): Promise<PlantDetail> {
    const { rows } = await sql<Omit<PlantDetail, 'images'>>`
      SELECT code, nom_scientifique AS "nomScientifique", famille, nom_fr AS "nomFr",
             nom_en AS "nomEn", statut,
             to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "modifieLe"
        FROM sabou.plante WHERE code = ${code}`.execute(trx);
    const plant = rows[0];
    if (!plant) throw new PlantNotFoundError();
    const { rows: images } = await sql<PlantImage>`
      SELECT i.id::int, i.alt_text_fr AS alt, i.alt_text_en AS "altEn", i.type, i.principale
        FROM sabou.plante_image i JOIN sabou.plante p ON p.id = i.plante_id
       WHERE p.code = ${code}
       ORDER BY i.principale DESC, i.ordre, i.id`.execute(trx);
    return { ...plant, images };
  }
}
