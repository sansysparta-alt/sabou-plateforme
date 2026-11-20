import { sql, type Transaction } from 'kysely';
import type { Database } from './database';

// Cloisonnement par zone (US-011, 05_Choix_Techniques.md §2.23). Toute lecture ou écriture
// des tables cloisonnées passe par inZone : la transaction s'ouvre avec le contexte du
// compte connecté (rôle et zone lus en base), que les règles RLS appliquent ensuite.
// Sans contexte, ces tables ne renvoient rien : un oubli ne fuit pas, il se voit.

export type ZoneTrx = Transaction<never>;

// Compte connecté (identifiant Keycloak) ; pour l'agent préfectoral qui numérise une recette
// (US-082), avec le code du praticien visé, transmis à la base pour la transaction seulement
export type ZoneSubject = string | { sub: string; onBehalfOf: string };

// Le compte n'existe pas, n'est pas actif, ou son identifiant n'est pas un UUID
export class ZoneContextError extends Error {
  constructor() {
    super('Aucun compte actif pour ce contexte');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INSUFFICIENT_PRIVILEGE = '42501';

export async function inZone<T>(
  db: Database,
  subject: ZoneSubject,
  work: (trx: ZoneTrx) => Promise<T>,
): Promise<T> {
  const keycloakId = typeof subject === 'string' ? subject : subject.sub;
  const onBehalfOf = typeof subject === 'string' ? null : subject.onBehalfOf;
  if (!UUID.test(keycloakId)) throw new ZoneContextError();
  return db.transaction().execute(async (trx) => {
    try {
      await sql`SELECT sabou.contexte_ouvrir(${keycloakId}::uuid)`.execute(trx);
    } catch (error) {
      if ((error as { code?: string }).code === INSUFFICIENT_PRIVILEGE)
        throw new ZoneContextError();
      throw error;
    }
    // Paramètre local à la transaction : studio_praticien() vérifie que l'agent est le
    // préfectoral de ce praticien ; il ne sert à rien pour un autre rôle
    if (onBehalfOf !== null) {
      await sql`SELECT set_config('sabou.numerisation_praticien', ${onBehalfOf}, true)`.execute(
        trx,
      );
    }
    return work(trx as unknown as ZoneTrx);
  });
}
