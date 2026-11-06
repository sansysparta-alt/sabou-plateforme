// Outils des tests du compte citoyen (lot D) : numéros fictifs, codes du faux fournisseur
// de SMS (journal de l'API), contrôle axe (WCAG 2.2 AA).
import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
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
export async function signUpThroughApi(phone: string, firstName: string, password: string) {
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
  const created = await post('compte', { ticket: verified.ticket, firstName, password });
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
