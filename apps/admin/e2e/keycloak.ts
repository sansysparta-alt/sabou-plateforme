// Outils des tests de bout en bout (US-010) : comptes de test créés à la volée par l'API
// d'administration de Keycloak, mots de passe tirés au hasard, codes TOTP calculés.
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// .env de l'environnement local, créé par « pnpm env:up » (jamais versionné)
const env: Record<string, string> = Object.fromEntries(
  readFileSync(fileURLToPath(new URL('../../../.env', import.meta.url)), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => line.split(/=(.*)/s, 2) as [string, string]),
);

export const KEYCLOAK = `http://localhost:${env.KEYCLOAK_PORT ?? '8080'}`;
export const APP = `http://localhost:${env.ADMIN_PORT ?? '5173'}`;

async function adminToken(): Promise<string> {
  const response = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'admin',
      password: env.KEYCLOAK_ADMIN_PASSWORD!,
    }),
  });
  if (!response.ok) throw new Error(`Jeton d'administration Keycloak : ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function admin<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${KEYCLOAK}/admin/realms/sabou${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${await adminToken()}`,
      'content-type': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Keycloak ${path} : ${response.status}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface TestUser {
  id: string;
  username: string;
  password: string;
}

// Compte fictif, nom unique à chaque exécution
export async function createUser(role: string): Promise<TestUser> {
  const username = `${role}-${randomBytes(4).toString('hex')}`;
  const password = randomBytes(18).toString('base64url');
  await admin('/users', {
    method: 'POST',
    body: JSON.stringify({
      username,
      enabled: true,
      firstName: 'Essai',
      lastName: role,
      email: `${username}@exemple.invalid`,
      emailVerified: true,
      credentials: [{ type: 'password', value: password, temporary: false }],
    }),
  });
  const [user] = await admin<{ id: string }[]>(`/users?username=${username}&exact=true`);
  const realmRole = await admin(`/roles/${role}`);
  await admin(`/users/${user!.id}/role-mappings/realm`, {
    method: 'POST',
    body: JSON.stringify([realmRole]),
  });
  return { id: user!.id, username, password };
}

// Rôles du domaine attribués au compte (directement ou par un rôle composite)
export async function realmRoles(userId: string): Promise<string[]> {
  const roles = await admin<{ name: string }[]>(`/users/${userId}/role-mappings/realm/composite`);
  return roles.map((role) => role.name);
}

export async function keycloakUser(username: string) {
  const [user] = await admin<{ id: string; enabled: boolean }[]>(
    `/users?username=${encodeURIComponent(username)}&exact=true`,
  );
  return user ?? null;
}

export function bruteForceStatus(userId: string) {
  return admin<{ disabled: boolean; numFailures: number }>(
    `/attack-detection/brute-force/users/${userId}`,
  );
}

export function userEvents(userId: string) {
  return admin<{ type: string; error?: string; ipAddress?: string; time: number }[]>(
    `/events?user=${userId}&max=50`,
  );
}

// Code TOTP (RFC 6238, SHA-1, 6 chiffres, 30 s), comme une application d'authentification.
// Keycloak donne le secret brut dans le champ caché « totpSecret ».
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', Buffer.from(secret, 'utf8')).update(counter).digest();
  const offset = hmac[19]! & 0x0f;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

// Un code ne sert qu'une fois : attendre la période suivante avant d'en saisir un autre
export function msUntilNextPeriod(at = Date.now()): number {
  return 30_000 - (at % 30_000) + 500;
}
