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

// Requête sur la base locale ; les valeurs y entrent seulement après contrôle
export function psql(query: string): string {
  return execFileSync(
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
      query,
    ],
    { cwd: root, encoding: 'utf8' },
  );
}

// Lignes d'un compte Keycloak, dans l'ordre d'écriture
export function auditLines(account: string): AuditLine[] {
  // Identifiant Keycloak (UUID) seulement : rien d'autre n'entre dans la requête
  if (!/^[0-9a-f-]{36}$/.test(account)) throw new Error(`Compte invalide : ${account}`);
  return JSON.parse(
    psql(`SELECT coalesce(json_agg(json_build_object('source', source, 'action', action,
         'ip', host(ip), 'details', details) ORDER BY id), '[]')
         FROM sabou.journal_audit WHERE compte = '${account}'`),
  ) as AuditLine[];
}

// Lignes d'audit portant sur un utilisateur de la plateforme (objet « utilisateur »)
export function accountAuditActions(accountId: number): string[] {
  if (!Number.isInteger(accountId)) throw new Error(`Compte invalide : ${accountId}`);
  return JSON.parse(
    psql(`SELECT coalesce(json_agg(action ORDER BY id), '[]') FROM sabou.journal_audit
           WHERE objet_type = 'utilisateur' AND objet_id = '${accountId}'`),
  ) as string[];
}

export interface AccountRow {
  id: number;
  role: string;
  region: string | null;
  prefecture: string | null;
  status: string;
  keycloakId: string | null;
  languages: { code: string; record: boolean; translate: boolean; validate: boolean }[];
}

// Utilisateur de la plateforme tel qu'il est en base, avec sa zone en clair
export function accountRow(email: string): AccountRow | null {
  // Adresses de test seulement : rien d'autre n'entre dans la requête
  if (!/^[a-z0-9.-]+@exemple\.invalid$/.test(email)) throw new Error(`Adresse invalide : ${email}`);
  const out = psql(`SELECT json_build_object('id', u.id, 'role', u.role_code, 'region', r.nom,
      'prefecture', p.nom, 'status', u.statut, 'keycloakId', u.keycloak_id,
      'languages', coalesce((SELECT json_agg(json_build_object('code', l.langue_code,
        'record', l.peut_enregistrer, 'translate', l.peut_traduire, 'validate', l.peut_valider)
        ORDER BY l.langue_code) FROM sabou.utilisateur_langue l WHERE l.utilisateur_id = u.id), '[]'))
    FROM sabou.utilisateur u LEFT JOIN sabou.region_admin r ON r.id = u.region_admin_id
    LEFT JOIN sabou.prefecture p ON p.id = u.prefecture_id WHERE u.email = '${email}'`).trim();
  return out ? (JSON.parse(out) as AccountRow) : null;
}
