// Outils communs des tests de bout en bout de l'application de gestion
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { APP, KEYCLOAK, msUntilNextPeriod, totp, type TestUser } from './keycloak';

export async function expectAccessible(page: Page, screen: string): Promise<void> {
  // Page complète (feuilles de style comprises) : sinon un bouton pas encore mis en forme
  // peut sembler trop petit (target-size), selon la vitesse du réseau
  await page.waitForLoadState('load');
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  // Élément fautif cité : un échec dans le pipeline se comprend sans le reproduire
  expect(
    violations.map(
      (v) => `${screen} — ${v.id} : ${v.help} [${v.nodes.map((n) => n.html).join(' | ')}]`,
    ),
  ).toEqual([]);
}

export async function submitPassword(page: Page, user: TestUser, password = user.password) {
  // Identifiant absent quand Keycloak le connaît déjà (il redemande seulement le mot de passe)
  const username = page.getByLabel("Nom d'utilisateur");
  if (await username.isVisible()) await username.fill(user.username);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Connexion' }).click();
}

export async function startLogin(page: Page) {
  await page.goto(APP);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(new RegExp(`^${KEYCLOAK}/realms/sabou/`));
}

// Écran « configurer l'authentification par mobile » : lit le secret, saisit le code
export async function configureTotp(page: Page): Promise<string> {
  const secret = await page.locator('input[name="totpSecret"]').inputValue();
  await page.locator('#totp').fill(totp(secret));
  await page.locator('#userLabel').fill('Téléphone de service');
  await page.locator('#saveTOTPBtn').click();
  return secret;
}

export async function sessionStatus(page: Page): Promise<number> {
  return (await page.request.get(`${APP}/auth/session`)).status();
}

// Première connexion d'un administrateur : mot de passe, configuration du TOTP et des codes
// de secours, puis reconnexion avec le code (§2.20). Renvoie le secret TOTP.
export async function firstAdministratorLogin(page: Page, user: TestUser): Promise<string> {
  await startLogin(page);
  await submitPassword(page, user);
  const secret = await configureTotp(page);
  await page.locator('#kcRecoveryCodesConfirmationCheck').check();
  await page.locator('#saveRecoveryAuthnCodesBtn').click();
  await expect(page).toHaveURL(`${APP}/`);
  await loginWithCode(page, user, secret);
  return secret;
}

export async function loginWithCode(page: Page, user: TestUser, secret: string): Promise<void> {
  await startLogin(page);
  await submitPassword(page, user);
  await expect(page.locator('#otp')).toBeVisible();
  // Un code ne sert qu'une fois par période de 30 s
  await page.waitForTimeout(msUntilNextPeriod());
  await page.locator('#otp').fill(totp(secret));
  await page.getByRole('button', { name: 'Connexion' }).click();
  await expect(page).toHaveURL(`${APP}/`);
  expect(await sessionStatus(page)).toBe(200);
}
