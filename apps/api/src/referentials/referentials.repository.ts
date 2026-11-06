import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  CreateLanguage,
  CreateSpecialty,
  Language,
  NaturalRegion,
  Referentials,
  Specialty,
  Territory,
  TerritoryLevel,
  UpdateLanguage,
  UpdateSpecialty,
} from '@sabou/types';
import { DATABASE, type Database } from '../database/database';
import { AccountsRepository, type Trx } from '../accounts/accounts.repository';

// Table et colonne de rattachement de chaque niveau de territoire : valeurs fixes, jamais
// tirées de la requête (le niveau est validé par l'énumération TERRITORY_LEVELS).
const LEVELS: Record<TerritoryLevel, { table: string; parent: string }> = {
  regions: { table: 'region_admin', parent: 'region_naturelle_id' },
  prefectures: { table: 'prefecture', parent: 'region_admin_id' },
  'sous-prefectures': { table: 'sous_prefecture', parent: 'prefecture_id' },
};

// Accès à la base pour les référentiels (lot C). Les règles des langues et des spécialités
// sont tenues par la base (migration 20261106180000_referentiels) ; l'API les traduit.
@Injectable()
export class ReferentialsRepository {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly accounts: AccountsRepository,
  ) {}

  transaction<T>(work: (trx: Trx) => Promise<T>): Promise<T> {
    return this.accounts.transaction(work);
  }

  userIdBySub(sub: string, trx: Trx): Promise<number | null> {
    return this.accounts.userIdBySub(sub, trx);
  }

  async all(): Promise<Referentials> {
    const territories = (level: TerritoryLevel) => {
      const { table, parent } = LEVELS[level];
      return sql<Territory>`
        SELECT id, nom AS name, ${sql.ref(parent)} AS "parentId"
          FROM ${sql.table(`sabou.${table}`)} ORDER BY nom`.execute(this.db);
    };
    const [languages, naturalRegions, regions, prefectures, subPrefectures, specialties] =
      await Promise.all([
        sql<Language>`
          SELECT code, iso639_3 AS iso6393, nom_fr AS name, type, texte AS text, voix AS voice,
                 active, ordre AS "order"
            FROM sabou.langue ORDER BY ordre, code`.execute(this.db),
        sql<NaturalRegion>`
          SELECT id, code, nom AS name, langue_defaut_code AS "defaultLanguage"
            FROM sabou.region_naturelle ORDER BY id`.execute(this.db),
        territories('regions'),
        territories('prefectures'),
        territories('sous-prefectures'),
        sql<Specialty>`
          SELECT id, code, libelle_fr AS "labelFr", libelle_en AS "labelEn", active
            FROM sabou.specialite ORDER BY id`.execute(this.db),
      ]);
    return {
      languages: languages.rows,
      naturalRegions: naturalRegions.rows,
      regions: regions.rows,
      prefectures: prefectures.rows,
      subPrefectures: subPrefectures.rows,
      specialties: specialties.rows,
    };
  }

  async createLanguage(trx: Trx, input: CreateLanguage): Promise<void> {
    // Nouvelle langue inactive, placée en fin de liste : la DG l'active quand ses
    // contenus sont prêts (US-020)
    await sql`
      INSERT INTO sabou.langue (code, iso639_3, nom_fr, type, texte, voix, active, ordre)
      VALUES (${input.code}, ${input.iso6393}, ${input.name}, ${input.type}, ${input.text},
              ${input.voice}, false,
              (SELECT coalesce(max(ordre), 0) + 1 FROM sabou.langue))`.execute(trx);
  }

  // Renvoie false si la langue n'existe pas
  async updateLanguage(trx: Trx, code: string, input: UpdateLanguage): Promise<boolean> {
    const { numAffectedRows } = await sql`
      UPDATE sabou.langue
         SET nom_fr = coalesce(${input.name ?? null}, nom_fr),
             ordre = coalesce(${input.order ?? null}::smallint, ordre),
             active = coalesce(${input.active ?? null}::boolean, active)
       WHERE code = ${code}`.execute(trx);
    return numAffectedRows === 1n;
  }

  async createTerritory(
    trx: Trx,
    level: TerritoryLevel,
    name: string,
    parentId: number,
  ): Promise<number> {
    const { table, parent } = LEVELS[level];
    const { rows } = await sql<{ id: number }>`
      INSERT INTO ${sql.table(`sabou.${table}`)} (nom, ${sql.ref(parent)})
      VALUES (${name}, ${parentId}) RETURNING id`.execute(trx);
    return rows[0]!.id;
  }

  // Renvoie l'ancien nom, ou null si le territoire n'existe pas
  async renameTerritory(
    trx: Trx,
    level: TerritoryLevel,
    id: number,
    name: string,
  ): Promise<string | null> {
    const { table } = LEVELS[level];
    const t = sql.table(`sabou.${table}`);
    const { rows } = await sql<{ previous: string }>`
      UPDATE ${t} AS cible SET nom = ${name}
        FROM ${t} AS avant
       WHERE cible.id = ${id} AND avant.id = cible.id
      RETURNING avant.nom AS previous`.execute(trx);
    return rows[0]?.previous ?? null;
  }

  async createSpecialty(trx: Trx, input: CreateSpecialty): Promise<number> {
    const { rows } = await sql<{ id: number }>`
      INSERT INTO sabou.specialite (code, libelle_fr, libelle_en)
      VALUES (${input.code}, ${input.labelFr}, ${input.labelEn}) RETURNING id`.execute(trx);
    return rows[0]!.id;
  }

  // Renvoie false si la spécialité n'existe pas. labelEn peut être effacé (null).
  async updateSpecialty(trx: Trx, id: number, input: UpdateSpecialty): Promise<boolean> {
    const { numAffectedRows } = await sql`
      UPDATE sabou.specialite
         SET libelle_fr = coalesce(${input.labelFr ?? null}, libelle_fr),
             libelle_en = CASE WHEN ${input.labelEn !== undefined} THEN ${input.labelEn ?? null}
                               ELSE libelle_en END,
             active = coalesce(${input.active ?? null}::boolean, active)
       WHERE id = ${id}`.execute(trx);
    return numAffectedRows === 1n;
  }
}
