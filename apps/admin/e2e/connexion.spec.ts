// Critères d'acceptation de US-010, de bout en bout : application de gestion (compilée),
// API, Keycloak et Valkey réels. Chaque écran traversé est vérifié par axe (WCAG 2.2 AA).
import { expect, test } from '@playwright/test';
import {
  configureTotp,
  expectAccessible,
  sessionStatus,
  startLogin,
  submitPassword,
} from './helpers';
import {
  APP,
  bruteForceStatus,
  createUser,
  KEYCLOAK,
  msUntilNextPeriod,
  totp,
  userEvents,
} from './keycloak';
import { auditLines } from './audit';

// La relève des événements Keycloak a lieu toutes les 5 s en local (AUDIT_POLL_SECONDS)
const AUDIT_DELAY = { timeout: 20_000, intervals: [1_000] };
const ipAddress = expect.stringMatching(/^[0-9a-f.:]+$/);

test('administrateur sans double facteur : activation obligatoire avant d’accéder à l’application', async ({
  page,
}) => {
  const dg = await createUser('dg');

  // Page de connexion unique (US-019) : ouverte directement, panneau SABOU et formulaire
  await page.goto(APP);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connexion à SABOU');
  await expect(page.getByRole('complementary', { name: 'Présentation de SABOU' })).toContainText(
    'Application de gestion',
  );
  await expect(
    page.getByText('Mot de passe oublié ? Contactez votre administrateur.'),
  ).toBeVisible();
  await expectAccessible(page, 'Connexion Keycloak');

  await submitPassword(page, dg);
  // Pas d'accès tant que le second facteur n'est pas configuré
  await expect(page.locator('#kc-totp-settings')).toBeVisible();
  expect(await sessionStatus(page)).toBe(401);
  // Encadré général du thème (template.ftl) : avertissement annoncé, icône dessinée décorative
  const notice = page.getByRole('status').filter({ hasText: /authentification/i });
  await expect(notice).toBeVisible();
  await expect(notice.locator('svg.sabou-alert__icon[aria-hidden="true"]')).toBeVisible();
  await expectAccessible(page, 'Configuration du code à usage unique');

  const secret = await configureTotp(page);
  // Puis les codes de secours, en cas de perte du téléphone
  await expect(page.locator('#kc-recovery-codes-list')).toBeVisible();
  expect(await sessionStatus(page)).toBe(401);
  await expectAccessible(page, 'Codes de secours');
  await page.locator('#kcRecoveryCodesConfirmationCheck').check();
  await page.locator('#saveRecoveryAuthnCodesBtn').click();

  // Le code tout juste enregistré est demandé aussitôt (niveau 2 seul, §2.28) : pas de
  // mot de passe à retaper, pas de session sans lui
  await expect(page.locator('#otp')).toBeVisible();
  await expect(page.getByLabel('Mot de passe', { exact: true })).toBeHidden();
  expect(await sessionStatus(page)).toBe(401);
  await expectAccessible(page, 'Saisie du code juste après l’activation');
  // Un code ne sert qu'une fois par période de 30 s
  await page.waitForTimeout(msUntilNextPeriod());
  await page.locator('#otp').fill(totp(secret));
  await page.getByRole('button', { name: 'Connexion' }).click();
  await expect(page.getByRole('status')).toContainText('Double facteur activé');

  // Connexion suivante : mot de passe, puis code de l'application d'authentification
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await startLogin(page);
  await submitPassword(page, dg);
  await expect(page.locator('#otp')).toBeVisible();
  await expectAccessible(page, 'Saisie du code à usage unique');
  await page.waitForTimeout(msUntilNextPeriod());
  await page.locator('#otp').fill(totp(secret));
  await page.getByRole('button', { name: 'Connexion' }).click();

  await expect(page).toHaveURL(`${APP}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bonjour, Essai dg');
  // Compte Keycloak de test sans ligne en base : profil en bas du menu (US-019), chiffres
  // refusés en clair
  await expect(
    page.getByRole('navigation', { name: 'Navigation principale' }).getByText('Direction Générale'),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('rattaché à aucune zone active');
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

  // Niveau 1 demandé par une adresse forgée : Keycloak exige quand même le code (§2.28)
  await page.goto(
    `${KEYCLOAK}/realms/sabou/protocol/openid-connect/auth?client_id=sabou-admin` +
      `&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(`${APP}/auth/callback`)}` +
      `&code_challenge=${'A'.repeat(43)}&code_challenge_method=S256&state=forge&acr_values=1`,
  );
  await submitPassword(page, dg);
  await expect(page.locator('#otp')).toBeVisible();
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
  // Code demandé aussitôt, sans retaper le mot de passe (§2.28)
  await expect(page.locator('#otp')).toBeVisible();
  await page.waitForTimeout(msUntilNextPeriod());
  await page.locator('#otp').fill(totp(secret));
  await page.getByRole('button', { name: 'Connexion' }).click();
  await expect(page.getByRole('status')).toContainText('Double facteur activé');
  await expect(page.getByText('Double facteur actif')).toBeVisible();
  await expectAccessible(page, 'Double facteur activé');

  // Une fois activé, il lui est demandé à chaque connexion
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await startLogin(page);
  await submitPassword(page, praticien);
  await expect(page.locator('#otp')).toBeVisible();
  await page.waitForTimeout(msUntilNextPeriod());
  await page.locator('#otp').fill(totp(secret));
  await page.getByRole('button', { name: 'Connexion' }).click();
  await expect(page.getByText('Double facteur actif')).toBeVisible();

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

  // US-030 : échecs et blocage versés au journal d'audit, avec l'IP. Le 6e échec suit le
  // blocage et peut n'être relevé qu'au passage suivant : on attend les deux conditions.
  const summary = () => {
    const actions = auditLines(user.id).map((line) => line.action);
    return {
      lockout: actions.includes('keycloak.user_disabled_by_temporary_lockout'),
      enoughErrors: actions.filter((action) => action === 'keycloak.login_error').length >= 6,
    };
  };
  await expect.poll(summary, AUDIT_DELAY).toEqual({ lockout: true, enoughErrors: true });
  const errors = auditLines(user.id).filter((line) => line.action === 'keycloak.login_error');
  expect(errors[0]).toMatchObject({ source: 'keycloak', ip: ipAddress });
});

test('journal d’audit : échec, connexion et déconnexion, avec l’IP (US-030)', async ({ page }) => {
  const user = await createUser('praticien');
  // Contre-épreuve : une IP annoncée par le client lui-même n'est jamais retenue
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '203.0.113.9' });
  await startLogin(page);
  await submitPassword(page, user, `mauvais-${user.password}`);
  await expect(page.locator('#input-error')).toBeVisible();
  await page.waitForTimeout(1_100);
  await submitPassword(page, user);
  await expect(page).toHaveURL(`${APP}/`);
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible();

  await expect
    .poll(() => auditLines(user.id).map((line) => `${line.source}:${line.action}`), AUDIT_DELAY)
    .toEqual(
      expect.arrayContaining([
        'keycloak:keycloak.login_error',
        'keycloak:keycloak.login',
        'application:connexion.reussie',
        'application:deconnexion',
      ]),
    );
  const lines = auditLines(user.id);
  expect(lines.every((line) => line.ip !== null && line.ip !== '203.0.113.9')).toBe(true);
  expect(lines.find((line) => line.action === 'connexion.reussie')).toMatchObject({
    ip: ipAddress,
    details: { identifiant: user.username, second_facteur: false },
  });
});
