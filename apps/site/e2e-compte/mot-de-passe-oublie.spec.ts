// US-069 de bout en bout : site public compilé, API, Keycloak (domaine « sabou-public »),
// Valkey et PostgreSQL réels. Chaque écran traversé, pages de Keycloak comprises, est vérifié
// par axe (WCAG 2.2 AA).
import { expect, test, type Page } from '@playwright/test';
import { auditActions, expectAccessible, newPhone, signUpThroughApi, smsCode } from './helpers';

const OLD_PASSWORD = '40718293';
const NEW_PASSWORD = '51829304';

async function keycloakLogin(page: Page, phone: string, password: string) {
  await page.getByLabel('Numéro de téléphone').fill(phone);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Connexion' }).click();
}

test('mot de passe oublié par SMS depuis la page de connexion : sessions fermées, journal', async ({
  browser,
}) => {
  const phone = newPhone();
  await signUpThroughApi(phone, 'Fanta', OLD_PASSWORD);

  // Une session ouverte ailleurs (téléphone perdu, par exemple)
  const elsewhereContext = await browser.newContext();
  const elsewhere = await elsewhereContext.newPage();
  await elsewhere.goto('/connexion');
  await elsewhere.getByRole('link', { name: 'Se connecter' }).click();
  await keycloakLogin(elsewhere, phone, OLD_PASSWORD);
  await expect(elsewhere.getByText('Bonjour Fanta.')).toBeVisible();

  // Lien « Mot de passe oublié ? » de la page de Keycloak, vers la page du site
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/connexion');
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
  await expect(page).toHaveURL(/\/mot-de-passe-oublie$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mot de passe oublié');
  await expectAccessible(page, 'Mot de passe oublié : numéro');

  await page.getByLabel('Numéro de téléphone', { exact: true }).fill(phone);
  await page.getByRole('button', { name: 'Recevoir le code' }).click();
  await expect(page.getByRole('heading', { name: 'Le code reçu par SMS' })).toBeFocused();
  await page.getByLabel('Code', { exact: true }).fill(await smsCode(phone));
  await page.getByRole('button', { name: 'Valider le code' }).click();
  await expect(page.getByRole('heading', { name: 'Votre nouveau mot de passe' })).toBeFocused();
  await expectAccessible(page, 'Mot de passe oublié : nouveau mot de passe');
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click();
  const done = page.getByRole('region', { name: 'Votre mot de passe est changé' });
  await expect(done).toBeVisible();

  // L'ancien mot de passe est refusé, le nouveau accepté
  await done.getByRole('link', { name: 'Se connecter' }).click();
  await keycloakLogin(page, phone, OLD_PASSWORD);
  await expect(page.getByText('Numéro de téléphone ou mot de passe incorrect.')).toBeVisible();
  await keycloakLogin(page, phone, NEW_PASSWORD);
  await expect(page.getByText('Bonjour Fanta.')).toBeVisible();

  // La session ouverte ailleurs est fermée côté Keycloak : se reconnecter demande le mot de passe
  await elsewhere.goto('/connexion');
  await elsewhere.getByRole('link', { name: 'Se connecter' }).click();
  await expect(elsewhere.getByLabel('Mot de passe', { exact: true })).toBeVisible();

  await expect
    .poll(() => auditActions(phone), { timeout: 20_000, intervals: [1_000] })
    .toEqual(expect.arrayContaining(['application:compte.mot_de_passe_reinitialise']));
  await Promise.all([context.close(), elsewhereContext.close()]);
});

test('numéro sans compte : même écran, aucun SMS envoyé', async ({ page }) => {
  const phone = newPhone();
  await page.goto('/mot-de-passe-oublie');
  await page.getByLabel('Numéro de téléphone', { exact: true }).fill(phone);
  await page.getByRole('button', { name: 'Recevoir le code' }).click();
  await expect(page.getByRole('heading', { name: 'Le code reçu par SMS' })).toBeFocused();
  await expect(smsCode(phone)).rejects.toThrow();
});
