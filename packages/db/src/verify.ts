import type { ClientBase } from 'pg';

// Empreintes des fichiers de migration lues dans atlas.sum : version → empreinte.
// Format : première ligne = empreinte du dossier, puis « <fichier> h1:<empreinte> ».
export function parseSum(sum: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const line of sum.split(/\r?\n/).slice(1)) {
    const match = /^(\d+)_\S+\.sql h1:(\S+)$/.exec(line.trim());
    if (match) hashes.set(match[1], match[2]);
  }
  return hashes;
}

// Atlas (édition communautaire) refuse une migration modifiée tant que atlas.sum n'est pas
// recalculé, mais l'accepte après « atlas migrate hash ». La base garde pourtant l'empreinte
// d'origine de chaque migration appliquée : on la compare à celle du fichier actuel.
// Renvoie la liste des écarts ; vide si toutes les migrations appliquées sont intactes.
export async function findAlteredMigrations(client: ClientBase, sum: string): Promise<string[]> {
  const { rows: exists } = await client.query<{ found: boolean }>(
    `SELECT to_regclass('atlas_schema_revisions.atlas_schema_revisions') IS NOT NULL AS found`,
  );
  if (!exists[0].found) return [];

  const files = parseSum(sum);
  const { rows } = await client.query<{ version: string; hash: string }>(
    `SELECT version, hash FROM atlas_schema_revisions.atlas_schema_revisions
      WHERE hash <> '' ORDER BY version`,
  );
  const problems: string[] = [];
  for (const { version, hash } of rows) {
    const current = files.get(version);
    if (current === undefined) problems.push(`${version} : appliquée mais absente du dossier`);
    else if (current !== hash) problems.push(`${version} : modifiée après son application`);
  }
  return problems;
}
