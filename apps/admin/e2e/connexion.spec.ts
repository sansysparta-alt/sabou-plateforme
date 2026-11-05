// Critères d'acceptation de US-010, de bout en bout : application de gestion (compilée),
// API, Keycloak et Valkey réels. Chaque écran traversé est vérifié par axe (WCAG 2.2 AA).
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  APP,
  bruteForceStatus,
  createUser,
  KEYCLOAK,
  msUntilNextPeriod,
  totp,
  userEvents,
  type TestUser,
} from './keycloak';

async function expectAccessible(page: Page, screen: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(violations.map((v) => `${screen} — ${v.id} : ${v.help}`)).toEqual([]);
}

async function submitPassword(page: Page, user: TestUser, password = user.password) {
  // Identifiant absent quand Keycloak le connaît déjà (il redemande seulement le mot de passe)
  const username = page.getByLabel("Nom d'utilisateur");
  if (await username.isVisible()) await username.fill(user.username);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Connexion' }).click();
}

async function startLogin(page: Page) {
  await page.goto(APP);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(new RegExp(`^${KEYCLOAK}/realms/sabou/`));
}

// Écran « configurer l'authentification par mobile » : lit le secret, saisit le code
async function configureTotp(page: Page): Promise<string> {
  const secret = await page.locator('input[name="totpSecret"]').inputValue();
  await page.locator('#totp').fill(totp(secret));
  await page.locator('#userLabel').fill('Téléphone de service');
  await page.locator('#saveTOTPBtn').click();
  return secret;
}

async function sessionStatus(page: Page): Promise<number> {
  return (await page.request.get(`${APP}/auth/session`)).status();
}

test('administrateur sans double facteur : activation obligatoire avant d’accéder à l’application', async ({
  page,
}) => {
  const dg = await createUser('dg');

  await page.goto(APP);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Application de gestion');
  await expectAccessible(page, 'Accueil sans session');

  await page.getByRole('link', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connexion à SABOU');
  await expect(
    page.getByText('Mot de passe oublié ? Contactez votre administrateur.'),
  ).toBeVisible();
  await expectAccessible(page, 'Connexion Keycloak');

  await submitPassword(page, dg);
  // Pas d'accès tant que le second facteur n'est pas configuré
  await expect(page.locator('#kc-totp-settings')).toBeVisible();
  expect(await sessionStatus(page)).toBe(401);
  await expectAccessible(page, 'Configuration du code à usage unique');

  const secret = await configureTotp(page);
  // Puis les codes de secours, en cas de perte du téléphone
  await expect(page.locator('#kc-recovery-codes-list')).toBeVisible();
  expect(await sessionStatus(page)).toBe(401);
  await expectAccessible(page, 'Codes de secours');
  await page.locator('#kcRecoveryCodesConfirmationCheck').check();
  await page.locator('#saveRecoveryAuthnCodesBtn').click();

  // La première connexion vérifie le code tout juste enregistré : sans lui, pas de session
  await expect(page).toHaveURL(`${APP}/`);
  await expect(page.getByRole('alert')).toContainText(
    'Si vous venez de l’activer, reconnectez-vous',
  );
  expect(await sessionStatus(page)).toBe(401);
  await expectAccessible(page, 'Reconnexion demandée');

  // Connexion : mot de passe, puis code de l'application d'authentification
  await startLogin(page);
  await submitPassword(page, dg);
  await expect(page.locator('#otp')).toBeVisible();
  await expectAccessible(page, 'Saisie du code à usage unique');
  await page.waitForTimeout(msUntilNextPeriod());
  await page.locator('#otp').fill(totp(secret));
  await page.getByRole('button', { name: 'Connexion' }).click();

  await expect(page).toHaveURL(`${APP}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bonjour, Essai dg');
  await expect(page.getByText('Direction Générale')).toBeVisible();
  expect(await sessionStatus(page)).toBe(200);
  await expectAccessible(page, 'Accueil connecté');

  // Le cookie de session n'est pas lisible par le JavaScript de la page
  expect(await page.evaluate(() => document.cookie)).not.toContain('sabou_session');

  // Déconnexion : session de l'API fermée, et Keycloak redemande l'identification
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible();
  expect(await sessionStatus(page)).toBe(401);
  await startLogin(page);
  await expect(page.getByLabel('Mot de passe', { exact: true })).toBeVisible();
});

test('praticien et citoyen : double facteur proposé, pas imposé', async ({ page }) => {
  const praticien = await createUser('praticien');
  await startLogin(page);
  await submitPassword(page, praticien);
  // Aucun écran de second facteur : accès direct
  await expect(page).toHaveURL(`${APP}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bonjour, Essai praticien');

  // Proposé : il l'active depuis l'application
  await page.getByRole('link', { name: 'Activer le double facteur' }).click();
  // Mot de passe redemandé avant de modifier la sécurité du compte
  await submitPassword(page, praticien);
  const secret = await configureTotp(page);
  await expect(page.getByRole('status')).toContainText('Double facteur activé');
  await expectAccessible(page, 'Double facteur activé');

  // Une fois activé, il lui est demandé à chaque connexion
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await startLogin(page);
  await submitPassword(page, praticien);
  await expect(page.locator('#otp')).toBeVisible();
  await page.waitForTimeout(msUntilNextPeriod());
  await page.locator('#otp').fill(totp(secret));
  await page.getByRole('button', { name: 'Connexion' }).click();
  await expect(page.getByText('Oui', { exact: true })).toBeVisible();

  const citoyen = await createUser('citoyen');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await startLogin(page);
  await submitPassword(page, citoyen);
  await expect(page).toHaveURL(`${APP}/`);
  // Connecté sans second facteur, mais l'application de gestion ne lui est pas ouverte
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Accès non autorisé');
  await expectAccessible(page, 'Accès non autorisé');
});

test('5 échecs : la 6e tentative est refusée, même avec le bon mot de passe, et journalisée', async ({
  page,
}) => {
  const user = await createUser('admin_prefectoral');
  await startLogin(page);
  for (let attempt = 1; attempt <= 5; attempt++) {
    await submitPassword(page, user, `mauvais-${attempt}-${user.password}`);
    await expect(page.locator('#input-error')).toBeVisible();
    // Au-delà de la détection des tentatives trop rapprochées (1 s), qui bloquerait plus tôt
    await page.waitForTimeout(1_100);
  }
  await expectAccessible(page, 'Erreur de connexion');

  await submitPassword(page, user);
  await expect(page).toHaveURL(new RegExp(`^${KEYCLOAK}/`));
  await expect(page.locator('#input-error')).toBeVisible();
  expect(await sessionStatus(page)).toBe(401);

  expect(await bruteForceStatus(user.id)).toMatchObject({ disabled: true, numFailures: 5 });
  const events = await userEvents(user.id);
  expect(events.filter((e) => e.type === 'LOGIN_ERROR').length).toBeGreaterThanOrEqual(6);
  expect(events.some((e) => e.type === 'USER_DISABLED_BY_TEMPORARY_LOCKOUT')).toBe(true);
  expect(events.some((e) => e.error === 'user_temporarily_disabled')).toBe(true);
});
