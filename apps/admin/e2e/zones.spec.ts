// Lot B (US-011) : cloisonnement par zone de bout en bout. Vrai Keycloak (second facteur),
// vraie API, vraie base : l'appel direct à l'API ne renvoie que la zone du compte.
// Jeu d'exemple : PR-1041 et PR-1042 à Labé ; PR-1043 à Siguiri (région de Kankan).
import { expect, test, type Page } from '@playwright/test';
import { administrator, firstAdministratorLogin } from './helpers';
import { APP } from './keycloak';

async function list<T>(page: Page, path: string): Promise<T[]> {
  const response = await page.request.get(`${APP}${path}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { elements: T[] }).elements;
}

test('US-011 : l’admin préfectoral de Labé ne voit que les praticiens de Labé, même par appel direct', async ({
  page,
}) => {
  const user = await administrator('admin_prefectoral', { prefecture: 'Labé' });
  await firstAdministratorLogin(page, user);

  const practitioners = await list<{ code: string; prefecture: string }>(page, '/api/praticiens');
  expect(practitioners.map((p) => p.code)).toEqual(expect.arrayContaining(['PR-1041', 'PR-1042']));
  expect(new Set(practitioners.map((p) => p.prefecture))).toEqual(new Set(['Labé']));

  // Une zone demandée dans la requête est refusée, pas appliquée
  expect((await page.request.get(`${APP}/api/praticiens?prefecture_id=9`)).status()).toBe(400);
  // Pages successives : toujours la seule zone de Labé
  const first = await page.request.get(`${APP}/api/praticiens?limite=1`);
  const { suivant } = (await first.json()) as { suivant: string };
  const next = await list<{ prefecture: string }>(
    page,
    `/api/praticiens?limite=100&apres=${suivant}`,
  );
  expect(new Set(next.map((p) => p.prefecture))).toEqual(new Set(['Labé']));
});

test('US-011 : l’admin régional de Kankan ne voit que les dossiers des préfectures de sa région', async ({
  page,
}) => {
  const user = await administrator('admin_regional', { region: 'Kankan' });
  await firstAdministratorLogin(page, user);

  const dossiers = await list<{ code: string; prefecture: string }>(page, '/api/dossiers');
  expect(dossiers.map((d) => d.code)).toContain('DS-1043');
  for (const dossier of dossiers) expect(['Kankan', 'Siguiri']).toContain(dossier.prefecture);
});

test('US-016 : le tableau de bord de l’admin préfectoral de Labé ne compte que sa zone', async ({
  page,
}) => {
  const user = await administrator('admin_prefectoral', { prefecture: 'Labé' });
  await firstAdministratorLogin(page, user);

  // Chiffres de l'API : les mêmes que les listes cloisonnées de la zone
  const response = await page.request.get(`${APP}/api/tableau-de-bord`);
  expect(response.status()).toBe(200);
  const summary = (await response.json()) as {
    zone: string;
    praticiens: number;
    activite: { dossier: string }[];
  };
  const practitioners = await list<{ code: string }>(page, '/api/praticiens?limite=100');
  const dossiers = await list<{ code: string }>(page, '/api/dossiers?limite=100');
  expect(summary.zone).toBe('Labé');
  expect(summary.praticiens).toBe(practitioners.length);
  const zoneDossiers = new Set(dossiers.map((d) => d.code));
  for (const event of summary.activite) expect(zoneDossiers).toContain(event.dossier);

  // Écran : zone affichée, navigation de son rôle, sans rubrique d'administration
  await page.goto(APP);
  await expect(page.getByText('Administrateur préfectoral · Labé')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chiffres de votre zone' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Comptes' })).toHaveCount(0);
});
