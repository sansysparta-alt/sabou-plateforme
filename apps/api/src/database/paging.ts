import { sql, type RawBuilder } from 'kysely';
import type { ZoneListQuery, ZonePage } from '@sabou/types';
import type { ZoneTrx } from './zone';

// Caractères spéciaux de LIKE pris au pied de la lettre
const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

// Une page d'une liste cloisonnée, triée par code (US-011, US-019b). `base` est la requête
// complète de la liste, sans tri ni limite, dont chaque ligne a un `code` ; elle s'exécute dans
// la transaction ouverte par inZone, donc sous les règles RLS du compte connecté.
//
// Recherche (`q`) : dans le code et les colonnes texte `searchIn` de la liste, sans accents ni
// majuscules (sabou.f_norm, comme la recherche des fiches) ; le total compte les seules lignes
// trouvées. Les noms de colonnes viennent du code, jamais de la requête.
//
// Une seule requête renvoie la page et le nombre total de lignes : le total est compté sur la
// liste entière, ou sur les lignes trouvées (curseur et décalage mis à part), et une page vide (décalage au-delà de la fin)
// garde son total grâce à la jointure externe. Une ligne de plus est lue pour savoir s'il en
// reste après la page.
export async function zonePage<T extends { code: string }>(
  trx: ZoneTrx,
  base: RawBuilder<unknown>,
  query: ZoneListQuery,
  searchIn: readonly string[] = [],
): Promise<ZonePage<T>> {
  const after = query.apres ?? null;
  const term = query.q ? `%${likeEscape(query.q)}%` : null;
  const matches = ['code', ...searchIn].map(
    (column) => sql`sabou.f_norm(${sql.ref(`liste.${column}`)}) LIKE sabou.f_norm(${term})`,
  );
  const { rows } = await sql<{ total: number; ligne: T | null }>`
    WITH liste AS (${base}),
    trouvee AS (
      SELECT * FROM liste WHERE ${term}::text IS NULL OR ${sql.join(matches, sql` OR `)}
    )
    SELECT t.total, to_jsonb(l) AS ligne
      FROM (SELECT count(*)::int AS total FROM trouvee) t
      LEFT JOIN LATERAL (
        SELECT * FROM trouvee
         WHERE ${after}::text IS NULL OR trouvee.code > ${after}
         ORDER BY trouvee.code
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
