import { sql, type RawBuilder } from 'kysely';
import type { ZoneListQuery, ZonePage } from '@sabou/types';
import type { ZoneTrx } from './zone';

// Une page d'une liste cloisonnée, triée par code (US-011, US-019b). `base` est la requête
// complète de la liste, sans tri ni limite, dont chaque ligne a un `code` ; elle s'exécute dans
// la transaction ouverte par inZone, donc sous les règles RLS du compte connecté.
//
// Une seule requête renvoie la page et le nombre total de lignes : le total est compté sur la
// liste entière (curseur et décalage mis à part), et une page vide (décalage au-delà de la fin)
// garde son total grâce à la jointure externe. Une ligne de plus est lue pour savoir s'il en
// reste après la page.
export async function zonePage<T extends { code: string }>(
  trx: ZoneTrx,
  base: RawBuilder<unknown>,
  query: ZoneListQuery,
): Promise<ZonePage<T>> {
  const after = query.apres ?? null;
  const { rows } = await sql<{ total: number; ligne: T | null }>`
    WITH liste AS (${base})
    SELECT t.total, to_jsonb(l) AS ligne
      FROM (SELECT count(*)::int AS total FROM liste) t
      LEFT JOIN LATERAL (
        SELECT * FROM liste
         WHERE ${after}::text IS NULL OR liste.code > ${after}
         ORDER BY liste.code
         LIMIT ${query.limite + 1} OFFSET ${query.decalage ?? 0}
      ) l ON true
     ORDER BY l.code`.execute(trx);
  const total = rows[0]?.total ?? 0;
  const lines = rows.flatMap((row) => (row.ligne ? [row.ligne] : []));
  const elements = lines.slice(0, query.limite);
  return {
    elements,
    suivant: lines.length > query.limite ? elements.at(-1)!.code : null,
    total,
  };
}
