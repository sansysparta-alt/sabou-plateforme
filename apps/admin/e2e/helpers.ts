// Outils communs des tests de bout en bout de l'application de gestion
import { expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { psql } from './audit';
import { APP, createUser, KEYCLOAK, msUntilNextPeriod, totp, type TestUser } from './keycloak';

export async function expectAccessible(page: Page, screen: string): Promise<void> {
  // Page complète (feuilles de style comprises) : sinon un bouton pas encore mis en forme
  // peut sembler trop petit (target-size), selon la vitesse du réseau
  await page.waitForLoadState('load');
  // Animations terminées (ouverture du panneau : opacité de 0 à 1) : sinon axe mesure le
  // contraste d'un bouton encore à demi transparent et l'échec dépend de la vitesse du poste
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        // Une animation sans fin (indicateur de chargement) ne doit pas bloquer le test
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished),
    ),
  );
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

// Sans session, l'application ouvre directement la page de connexion unique (US-019)
export async function startLogin(page: Page) {
  await page.goto(APP);
  await expect(page).toHaveURL(new RegExp(`^${KEYCLOAK}/realms/sabou/`));
}

// Écran « activer la double authentification » : lit le secret, saisit le code. Le nom de
// l'appareil est pré-rempli (« Téléphone – date du jour »), sans champ à remplir.
export async function configureTotp(page: Page): Promise<string> {
  const secret = await page.locator('input[name="totpSecret"]').inputValue();
  await expect(page.locator('#userLabel')).toHaveValue(/^Téléphone – \d{2}\/\d{2}\/\d{4}$/);
  await expect(page.locator('#userLabel')).toBeHidden();
  await page.locator('#totp').fill(totp(secret));
  await page.locator('#saveTOTPBtn').click();
  return secret;
}

export async function sessionStatus(page: Page): Promise<number> {
  return (await page.request.get(`${APP}/auth/session`)).status();
}

// Première connexion d'un administrateur : mot de passe, configuration du TOTP (code saisi et
// vérifié) et des codes de secours, puis directement l'application (§2.20, §2.55). Renvoie le
// secret TOTP.
export async function firstAdministratorLogin(page: Page, user: TestUser): Promise<string> {
  await startLogin(page);
  await submitPassword(page, user);
  const secret = await configureTotp(page);
  await page.locator('#kcRecoveryCodesConfirmationCheck').check();
  await page.locator('#saveRecoveryAuthnCodesBtn').click();
  await expect(page).toHaveURL(new RegExp(`^${APP}/`));
  expect(await sessionStatus(page)).toBe(200);
  return secret;
}

export async function loginWithCode(page: Page, user: TestUser, secret: string): Promise<void> {
  await startLogin(page);
  await submitPassword(page, user);
  await submitCode(page, secret);
}

async function submitCode(page: Page, secret: string): Promise<void> {
  await expect(page.locator('#otp')).toBeVisible();
  // Un code ne sert qu'une fois par période de 30 s
  await page.waitForTimeout(msUntilNextPeriod());
  await page.locator('#otp').fill(totp(secret));
  await page.getByRole('button', { name: 'Connexion' }).click();
  await expect(page).toHaveURL(new RegExp(`^${APP}/`));
  expect(await sessionStatus(page)).toBe(200);
}

// Compte d'administration lié à un compte Keycloak neuf, avec sa zone en base
export async function administrator(
  keycloakRole: 'admin_prefectoral' | 'admin_regional' | 'comite' | 'dg',
  // Le Comité scientifique et la DG sont nationaux : pas de zone
  zone: { prefecture: string } | { region: string } | { national: true },
): Promise<TestUser> {
  const user = await createUser(keycloakRole);
  // Identifiant Keycloak et nom de test contrôlés : rien d'autre n'entre dans la requête
  if (!/^[0-9a-f-]{36}$/.test(user.id) || !/^[a-z_]+-[0-9a-f]{8}$/.test(user.username)) {
    throw new Error(`Compte de test invalide : ${user.username}`);
  }
  const [role, region, prefecture] =
    'national' in zone
      ? [keycloakRole === 'dg' ? 'dg' : 'scientifique', 'NULL', 'NULL']
      : 'prefecture' in zone
        ? [
            'prefectoral',
            'NULL',
            `(SELECT id FROM sabou.prefecture WHERE nom = '${zone.prefecture}')`,
          ]
        : ['regional', `(SELECT id FROM sabou.region_admin WHERE nom = '${zone.region}')`, 'NULL'];
  // Un seul compte DG actif (US-024) : la DG d'essai prend la place des précédentes
  const handOver =
    role === 'dg'
      ? `UPDATE sabou.utilisateur SET statut = 'suspendu' WHERE role_code = 'dg' AND statut = 'actif';`
      : '';
  // Schéma en tête du search_path, comme pour l'API : les déclencheurs en dépendent
  psql(`SET search_path = sabou, public; ${handOver}
        INSERT INTO sabou.utilisateur (email, prenom, nom, role_code, region_admin_id, prefecture_id,
          statut, keycloak_id)
        VALUES ('${user.username}@exemple.invalid', 'Essai', 'Zone', '${role}', ${region}, ${prefecture},
          'actif', '${user.id}')`);
  return user;
}

// Ouvre le panneau d'un dossier (clic sur sa ligne, 05 §2.76) et le rend ; un seul panneau
// à la fois, comme pour l'utilisateur. Sans effet s'il est déjà ouvert.
export async function openDossier(page: Page, code: string): Promise<Locator> {
  const panel = page.getByRole('dialog', { name: new RegExp(`^${code} `) });
  if (!(await panel.isVisible())) {
    await page
      .getByRole('heading', { level: 3, name: new RegExp(`^${code} `) })
      .getByRole('button')
      .click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

// Referme le panneau ouvert (bouton « Fermer »)
export async function closeDossier(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: /^Fermer/ }).click();
  await expect(panel).toBeHidden();
}
