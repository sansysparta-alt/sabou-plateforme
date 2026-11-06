import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type {
  AccountReferences,
  AccountRole,
  AccountStatus,
  AccountSummary,
  InviteRequest,
  InvitationPreview,
  WorkLanguage,
} from '@sabou/types';
import { DATABASE, type Database } from '../database/database';

export type Trx = Transaction<never>;

// Le « sub » des jetons de Keycloak est un UUID ; toute autre valeur ne désigne aucun compte.
// La comparaison se fait en uuid, pour que l'index unique serve.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const asUuid = (sub: string): string | null => (UUID.test(sub) ? sub : null);

// Compte prêt pour l'acceptation de son invitation (ligne verrouillée)
export interface PendingInvitation extends InvitationPreview {
  invitationId: number;
  accountId: number;
}

// Compte dont le statut vient de changer
export interface StatusChange {
  keycloakId: string;
  email: string;
}

// Accès à la base pour la gestion des comptes (lot A). Les contraintes de la base
// (zone exigée par le rôle, e-mail unique) restent le dernier rempart.
@Injectable()
export class AccountsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (trx: Trx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => work(trx as unknown as Trx));
  }

  async references(): Promise<AccountReferences> {
    const [regions, prefectures, languages] = await Promise.all([
      sql<{ id: number; name: string }>`
        SELECT id, nom AS name FROM sabou.region_admin ORDER BY nom`.execute(this.db),
      sql<{ id: number; name: string; regionId: number }>`
        SELECT id, nom AS name, region_admin_id AS "regionId"
          FROM sabou.prefecture ORDER BY nom`.execute(this.db),
      sql<{ code: string; name: string; text: boolean; voice: boolean }>`
        SELECT code, nom_fr AS name, texte AS text, voix AS voice
          FROM sabou.langue WHERE active ORDER BY ordre, code`.execute(this.db),
    ]);
    return { regions: regions.rows, prefectures: prefectures.rows, languages: languages.rows };
  }

  // Comptes d'administration, avec leur zone en clair et leurs langues de travail
  async list(currentSub: string): Promise<AccountSummary[]> {
    const { rows } = await sql<AccountSummary>`
      SELECT u.id::int AS id, u.email, u.prenom AS "firstName", u.nom AS "lastName",
             u.role_code AS role, u.statut AS status,
             coalesce(p.nom, r.nom, 'National') AS zone,
             coalesce(u.keycloak_id = ${asUuid(currentSub)}::uuid, false) AS self,
             coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                        'code', l.langue_code, 'record', l.peut_enregistrer,
                        'translate', l.peut_traduire, 'validate', l.peut_valider)
                      ORDER BY l.langue_code)
                 FROM sabou.utilisateur_langue l WHERE l.utilisateur_id = u.id), '[]'::jsonb
             ) AS languages
        FROM sabou.utilisateur u
        LEFT JOIN sabou.region_admin r ON r.id = u.region_admin_id
        LEFT JOIN sabou.prefecture p ON p.id = u.prefecture_id
       WHERE u.role_code IN ('dg', 'regional', 'prefectoral', 'scientifique')
       ORDER BY u.statut = 'suspendu', u.nom, u.prenom, u.id`.execute(this.db);
    return rows;
  }

  async userIdBySub(sub: string, executor: Trx | Database = this.db): Promise<number | null> {
    const uuid = asUuid(sub);
    if (!uuid) return null;
    const { rows } = await sql<{ id: number }>`
      SELECT id::int AS id FROM sabou.utilisateur WHERE keycloak_id = ${uuid}::uuid
    `.execute(executor);
    return rows[0]?.id ?? null;
  }

  // Compte invité (sans compte Keycloak) et ses langues de travail
  async createInvited(trx: Trx, input: InviteRequest): Promise<number> {
    const { rows } = await sql<{ id: number }>`
      INSERT INTO sabou.utilisateur
        (email, prenom, nom, role_code, region_admin_id, prefecture_id,
         langue_interface, langue_ecoute, statut)
      VALUES (${input.email}, ${input.firstName}, ${input.lastName}, ${input.role},
              ${input.regionId}, ${input.prefectureId}, ${input.interfaceLanguage},
              ${input.listeningLanguage}, 'invite')
      RETURNING id::int AS id`.execute(trx);
    const id = rows[0]!.id;
    await this.setLanguages(trx, id, input.languages);
    return id;
  }

  private async setLanguages(trx: Trx, id: number, languages: WorkLanguage[]): Promise<void> {
    if (languages.length === 0) return;
    await sql`
      INSERT INTO sabou.utilisateur_langue
        (utilisateur_id, langue_code, peut_enregistrer, peut_traduire, peut_valider)
      SELECT ${id}, l.code, l.record, l.translate, l.validate
        FROM jsonb_to_recordset(${JSON.stringify(languages)}::jsonb)
          AS l(code text, record boolean, translate boolean, validate boolean)`.execute(trx);
  }

  // Nouveau lien : les liens précédents encore ouverts sont fermés. Renvoie l'échéance.
  async issueInvitation(
    trx: Trx,
    accountId: number,
    tokenDigest: Buffer,
    hours: number,
    createdBy: number | null,
  ): Promise<Date | null> {
    const { rows } = await sql<{ expiresAt: Date }>`
      WITH compte AS (
        SELECT id FROM sabou.utilisateur WHERE id = ${accountId} AND statut = 'invite' FOR UPDATE
      ), fermeture AS (
        UPDATE sabou.invitation SET expire_le = least(expire_le, now())
         WHERE utilisateur_id IN (SELECT id FROM compte) AND utilisee_le IS NULL
      )
      INSERT INTO sabou.invitation (utilisateur_id, jeton_empreinte, expire_le, cree_par)
      SELECT id, ${tokenDigest}, now() + make_interval(hours => ${hours}), ${createdBy}
        FROM compte
      RETURNING expire_le AS "expiresAt"`.execute(trx);
    return rows[0]?.expiresAt ?? null;
  }

  // Invitation valable : non utilisée, non expirée, compte encore invité. Avec un
  // verrou, l'acceptation est sérialisée : un lien ne sert qu'une fois.
  async findInvitation(
    tokenDigest: Buffer,
    lock: Trx | null = null,
  ): Promise<PendingInvitation | null> {
    const forUpdate = lock ? sql`FOR UPDATE OF i, u` : sql``;
    const { rows } = await sql<PendingInvitation>`
      SELECT i.id::int AS "invitationId", u.id::int AS "accountId", u.prenom AS "firstName",
             u.nom AS "lastName", u.email, u.role_code AS role
        FROM sabou.invitation i JOIN sabou.utilisateur u ON u.id = i.utilisateur_id
       WHERE i.jeton_empreinte = ${tokenDigest} AND i.utilisee_le IS NULL
         AND i.expire_le > now() AND u.statut = 'invite'
       ${forUpdate}`.execute(lock ?? this.db);
    return rows[0] ?? null;
  }

  async activate(trx: Trx, pending: PendingInvitation, keycloakId: string): Promise<void> {
    await sql`
      UPDATE sabou.utilisateur SET keycloak_id = ${keycloakId}::uuid, statut = 'actif'
       WHERE id = ${pending.accountId}`.execute(trx);
    await sql`
      UPDATE sabou.invitation SET utilisee_le = now() WHERE id = ${pending.invitationId}
    `.execute(trx);
  }

  // Passage d'un statut à l'autre ; null si le compte n'est pas dans le statut attendu
  async changeStatus(
    trx: Trx,
    accountId: number,
    from: AccountStatus,
    to: AccountStatus,
  ): Promise<StatusChange | null> {
    const { rows } = await sql<StatusChange>`
      UPDATE sabou.utilisateur SET statut = ${to}
       WHERE id = ${accountId} AND statut = ${from}
         AND role_code IN ('dg', 'regional', 'prefectoral', 'scientifique')
      RETURNING keycloak_id::text AS "keycloakId", email`.execute(trx);
    return rows[0] ?? null;
  }

  async statusOf(accountId: number): Promise<{ status: AccountStatus; role: AccountRole } | null> {
    const { rows } = await sql<{ status: AccountStatus; role: AccountRole }>`
      SELECT statut AS status, role_code AS role FROM sabou.utilisateur
       WHERE id = ${accountId} AND role_code IN ('dg', 'regional', 'prefectoral', 'scientifique')
    `.execute(this.db);
    return rows[0] ?? null;
  }

  // À chaque connexion : lien avec l'utilisateur de la plateforme et date de connexion
  async recordLogin(sub: string): Promise<{ userId: number; status: AccountStatus } | null> {
    const uuid = asUuid(sub);
    if (!uuid) return null;
    const { rows } = await sql<{ userId: number; status: AccountStatus }>`
      UPDATE sabou.utilisateur SET derniere_connexion = now()
       WHERE keycloak_id = ${uuid}::uuid
      RETURNING id::int AS "userId", statut AS status`.execute(this.db);
    return rows[0] ?? null;
  }
}
