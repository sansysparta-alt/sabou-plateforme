// US-050 : le Comité crée une fiche plante, ajoute ses photos et change la principale, de
// bout en bout (vrai Keycloak avec second facteur, vraie API, vraie base, vrai stockage S3).
// Un autre profil n'a ni l'écran ni l'API.
import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { psql } from './audit';
import { administrator, expectAccessible, firstAdministratorLogin } from './helpers';
import { APP } from './keycloak';

// PNG valide de 1 × 1 pixel
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('US-050 : créer une fiche plante, ses photos, une seule principale', async ({ page }) => {
  test.setTimeout(120_000);
  const committee = await administrator('comite', { national: true });
  await firstAdministratorLogin(page, committee);
  // Nom unique à chaque exécution : la base locale garde les fiches des passages précédents
  const name = `Combretum essai ${randomBytes(3).toString('hex')}`;

  await page.goto(APP);
  await page.getByRole('link', { name: 'Fiches plantes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Fiches plantes' })).toBeVisible();
  await expectAccessible(page, 'fiches plantes');

  await page.getByRole('button', { name: 'Nouvelle fiche plante' }).click();
  await page.getByLabel('Nom scientifique').fill(name);
  await page.getByLabel('Famille').fill('Combretaceae');
  await page.getByLabel('Nom français').fill('Kinkéliba d’essai');
  await page.getByRole('button', { name: 'Créer la fiche' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Kinkéliba d’essai' })).toBeVisible();
  const code = (await page.getByText(/^Fiche PL-\d+$/).textContent())!.replace('Fiche ', '');
  await expect(page.getByText('En revue')).toBeVisible();

  // Première photo : principale d'office
  const add = page.locator('form', {
    has: page.getByRole('heading', { name: 'Ajouter une photo' }),
  });
  await add.getByLabel('Photo', { exact: true }).setInputFiles({
    name: 'feuilles.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await add.getByLabel('Texte alternatif', { exact: true }).fill('Feuilles séchées');
  await add.getByLabel('Ce que montre la photo').selectOption('feuille');
  await add.getByRole('button', { name: 'Ajouter la photo' }).click();
  await expect(page.getByText('Photo ajoutée.')).toBeVisible();
  const leaves = page.getByRole('img', { name: 'Feuilles séchées' });
  await expect(leaves).toBeVisible();
  // La photo est bien servie par l'API (chargée par le navigateur)
  expect(await leaves.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

  // Seconde photo, puis elle devient la principale : une seule principale
  await add.getByLabel('Photo', { exact: true }).setInputFiles({
    name: 'arbre.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await add.getByLabel('Texte alternatif', { exact: true }).fill('Arbuste entier');
  await add.getByRole('button', { name: 'Ajouter la photo' }).click();
  await page
    .getByRole('button', { name: 'Choisir comme photo principale : Arbuste entier' })
    .click();
  await expect(page.getByText('Photo principale changée.')).toBeVisible();
  const principal = psql(`SELECT i.alt_text_fr FROM sabou.plante_image i
      JOIN sabou.plante p ON p.id = i.plante_id WHERE p.code = '${code}' AND i.principale`);
  expect(principal.trim().split('\n').at(-1)!.trim()).toBe('Arbuste entier');
  await expectAccessible(page, 'fiche plante');
});

test('US-050 : un admin régional n’a ni l’écran ni l’API des fiches plantes', async ({ page }) => {
  test.setTimeout(90_000);
  const regional = await administrator('admin_regional', { region: 'Kankan' });
  await firstAdministratorLogin(page, regional);
  await page.goto(APP);
  await expect(page.getByRole('link', { name: 'Consolidation régionale' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Fiches plantes' })).toHaveCount(0);
  expect((await page.request.get(`${APP}/api/plantes`)).status()).toBe(403);
});
