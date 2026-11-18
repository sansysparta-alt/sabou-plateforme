// Outils des tests du compte citoyen (lot D) : numéros fictifs, codes du faux fournisseur
// de SMS (journal de l'API), contrôle axe (WCAG 2.2 AA).
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const root = join(import.meta.dirname, '..', '..', '..');
export const API = `http://localhost:${process.env.API_PORT ?? 4000}`;
export const SITE = `http://localhost:${process.env.SITE_PORT ?? 3000}`;

// Mobile guinéen fictif, différent à chaque test (forme nationale)
export function newPhone(): string {
  return `62${String(randomInt(0, 1e7)).padStart(7, '0')}`;
}

// Dernier code envoyé à ce numéro par le faux fournisseur (« SMS factice pour +224… »)
export async function smsCode(phone: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      () => {
        const logs = execFileSync(
          'docker',
          [
            'compose',
            '--file',
            'infra/local/compose.yaml',
            '--env-file',
            '.env',
            'logs',
            'api',
            '--since',
            '5m',
            '--no-log-prefix',
          ],
          { cwd: root, encoding: 'utf8' },
        );
        const lines = logs.split('\n').filter((line) => line.includes(`+224${phone} :`));
        code = /code est (\d{6})/.exec(lines.at(-1) ?? '')?.[1];
        return code;
      },
      { timeout: 15_000, intervals: [500] },
    )
    .toMatch(/^\d{6}$/);
  return code!;
}

// Inscription par l'API, comme le site (même origine) : prépare un numéro déjà inscrit
export async function signUpThroughApi(
  phone: string,
  firstName: string,
  password: string,
  // Praticien (US-040a) : { profile: 'praticien', lastName }
  extra: Record<string, string> = {},
) {
  const post = (path: string, body: unknown) =>
    fetch(`${API}/api/inscription/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE },
      body: JSON.stringify(body),
    });
  expect((await post('code', { phone })).status).toBe(202);
  const verified = (await (
    await post('verification', { phone, code: await smsCode(phone) })
  ).json()) as { ticket: string };
  const created = await post('compte', { ticket: verified.ticket, firstName, password, ...extra });
  expect(await created.json()).toEqual({ status: 'created' });
}

// Lignes du journal d'audit d'un citoyen (« source:action »), lues en base par psql dans le
// conteneur PostgreSQL : le test vérifie ce qui est réellement écrit
export function auditActions(phone: string): string[] {
  // Numéro fictif du test seulement : rien d'autre n'entre dans la requête
  if (!/^6\d{8}$/.test(phone)) throw new Error(`Numéro invalide : ${phone}`);
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
      `SELECT coalesce(json_agg(a.source || ':' || a.action ORDER BY a.id), '[]')
         FROM sabou.journal_audit a JOIN sabou.utilisateur u ON a.compte = u.keycloak_id::text
        WHERE u.role_code = 'citoyen' AND u.telephone = '+224${phone}'`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  return JSON.parse(out) as string[];
}

// Requête SQL lue par psql dans le conteneur PostgreSQL (super-utilisateur), pour vérifier
// ce qui est réellement écrit ou préparer un cas. Valeurs du test seulement.
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
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'sabou',
      '-tAc',
      query,
    ],
    { cwd: root, encoding: 'utf8' },
  ).trim();
}

// Dernier SMS factice envoyé à ce numéro (journal de l'API)
export function lastSms(phone: string): string | undefined {
  const logs = execFileSync(
    'docker',
    [
      'compose',
      '--file',
      'infra/local/compose.yaml',
      '--env-file',
      '.env',
      'logs',
      'api',
      '--since',
      '5m',
      '--no-log-prefix',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  return logs
    .split('\n')
    .filter((line) => line.includes(`+224${phone} :`))
    .at(-1);
}

export async function expectAccessible(page: Page, screen: string): Promise<void> {
  await page.waitForLoadState('load');
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    violations.map(
      (v) => `${screen} — ${v.id} : ${v.help} [${v.nodes.map((n) => n.html).join(' | ')}]`,
    ),
  ).toEqual([]);
}

// Connexion de l'application mobile (US-040b, §2.29), rejouée par les tests de bout en bout :
// seule voie vers les routes du praticien depuis US-068.
const KEYCLOAK_PUBLIC = `http://localhost:${process.env.KEYCLOAK_PORT ?? 8080}/realms/sabou-public`;
export const OIDC = `${KEYCLOAK_PUBLIC}/protocol/openid-connect`;
export const CLIENT_ID = 'sabou-mobile';
export const REDIRECT_URI = 'gn.sabou.mobile:/oauth2redirect';

export interface Tokens {
  access_token: string;
  refresh_token: string;
  refresh_expires_in: number;
  scope: string;
}

export const claims = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;

// Ce que fait l'application (flutter_appauth) : page de Keycloak dans le navigateur, retour
// vers le schéma de l'application avec le code, échange du code avec le vérificateur PKCE
export async function signInLikeTheApp(
  page: Page,
  phone: string,
  password: string,
): Promise<Tokens> {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const authorize = new URL(`${OIDC}/auth`);
  authorize.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'openid offline_access',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'login',
  }).toString();
  await page.goto(authorize.href);
  await page.getByLabel('Numéro de téléphone').fill(phone);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  // Le navigateur ne sait pas ouvrir « gn.sabou.mobile: » : on lit la redirection elle-même
  const [redirect] = await Promise.all([
    page.waitForResponse((r) => r.headers()['location']?.startsWith(REDIRECT_URI) ?? false),
    page.getByRole('button', { name: 'Connexion' }).click(),
  ]);
  const back = new URL(redirect.headers()['location']!);
  expect(back.searchParams.get('state')).toBe(state);

  const exchange = await fetch(`${OIDC}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: back.searchParams.get('code')!,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  expect(exchange.status).toBe(200);
  return (await exchange.json()) as Tokens;
}

export const bearer = (token: string, init: RequestInit = {}) =>
  ({ ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } }) as RequestInit;
