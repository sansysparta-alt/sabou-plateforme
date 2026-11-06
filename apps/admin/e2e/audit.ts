// Lecture du journal d'audit de l'environnement local (US-030), par psql dans le conteneur
// PostgreSQL : les tests vérifient ce qui est réellement écrit en base.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

export interface AuditLine {
  source: 'application' | 'keycloak';
  action: string;
  ip: string | null;
  details: Record<string, unknown>;
}

// Lignes d'un compte Keycloak, dans l'ordre d'écriture
export function auditLines(account: string): AuditLine[] {
  // Identifiant Keycloak (UUID) seulement : rien d'autre n'entre dans la requête
  if (!/^[0-9a-f-]{36}$/.test(account)) throw new Error(`Compte invalide : ${account}`);
  const out = execFileSync(
    'docker',
    [
      'compose',
      '--file',
      'infra/local/compose.yaml',
      '--env-file',
      '.env',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'sabou',
      '-tAc',
      `SELECT coalesce(json_agg(json_build_object('source', source, 'action', action,
         'ip', host(ip), 'details', details) ORDER BY id), '[]')
         FROM sabou.journal_audit WHERE compte = '${account}'`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  return JSON.parse(out) as AuditLine[];
}
