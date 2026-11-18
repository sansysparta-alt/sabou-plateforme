// Critères d'acceptation de US-014, de bout en bout : site public compilé, API, Keycloak
// (domaine « sabou-public »), Valkey et PostgreSQL réels. Chaque écran traversé, pages de
// Keycloak comprises, est vérifié par axe (WCAG 2.2 AA).
import { expect, test, type Page } from '@playwright/test';
import { auditActions, expectAccessible, newPhone, signUpThroughApi, smsCode } from './helpers';

const PASSWORD = '40718293';

async function enterPhone(page: Page, phone: string) {
  await page.goto('/inscription');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Créer un compte gratuit');
  await page.getByLabel('Numéro de téléphone', { exact: true }).fill(phone);
  await page.getByRole('button', { name: 'Recevoir le code' }).click();
  await expect(page.getByRole('heading', { name: 'Le code reçu par SMS' })).toBeFocused();
}

async function enterCode(page: Page, phone: string) {
  await page.getByLabel('Code', { exact: true }).fill(await smsCode(phone));
  await page.getByRole('button', { name: 'Valider le code' }).click();
}

test('critère 1 : un numéro valide reçoit un code par SMS ; le compte est créé après le code', async ({
  page,
}) => {
  const phone = newPhone();
  const spaced = phone.replace(/^(\d{3})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4');

  await page.goto('/inscription');
  await expectAccessible(page, 'Inscription : numéro');
  await enterPhone(page, spaced);
  await expect(page.getByText(`au ${spaced}`)).toBeVisible();
  await expectAccessible(page, 'Inscription : code');

  // Un mauvais code est refusé, avec les essais restants
  const code = await smsCode(phone);
  await page.getByLabel('Code', { exact: true }).fill(code === '000000' ? '000001' : '000000');
  await page.getByRole('button', { name: 'Valider le code' }).click();
  await expect(page.locator('#inscription-erreur')).toHaveText(
    'Code incorrect. Il vous reste 4 essais.',
  );
  await expectAccessible(page, 'Inscription : mauvais code');

  await enterCode(page, phone);
  await expect(
    page.getByRole('heading', { name: 'Votre profil et votre mot de passe' }),
  ).toBeFocused();
  await expectAccessible(page, 'Inscription : prénom et mot de passe');
  await page.getByLabel('Prénom', { exact: true }).fill('Aïssatou');
  await page.getByLabel('Mot de passe', { exact: true }).fill('12345678');
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  // Erreur sous le champ concerné, qui reçoit le focus (WCAG 3.3.1)
  const password = page.getByLabel('Mot de passe', { exact: true });
  await expect(page.locator('#password-erreur')).toHaveText(
    'Ce mot de passe est trop facile à deviner.',
  );
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await expect(password).toBeFocused();
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page.getByRole('heading', { name: 'Votre compte est créé' })).toBeFocused();
  await expectAccessible(page, 'Inscription : compte créé');

  // Connexion par Keycloak : numéro pré-rempli, puis « Mon compte »
  await page
    .getByRole('region', { name: 'Votre compte est créé' })
    .getByRole('link', { name: 'Se connecter' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Se connecter à SABOU');
  await expect(page.getByLabel('Numéro de téléphone')).toHaveValue(phone);
  await expect(page.getByText('Les 9 chiffres de votre numéro')).toBeVisible();
  await expectAccessible(page, 'Connexion Keycloak (site public)');
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Connexion' }).click();

  await expect(page).toHaveURL(/\/compte$/);
  await expect(page.getByText('Bonjour Aïssatou.')).toBeVisible();
  await expect(page.getByText(`Numéro de téléphone : ${spaced}`)).toBeVisible();
  await expectAccessible(page, 'Mon compte');

  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/compte');
  await expect(page.getByText('Vous n’êtes pas connecté.')).toBeVisible();
});

test('critère 2 : un numéro déjà inscrit se voit proposer de se connecter, après le code', async ({
  page,
}) => {
  const phone = newPhone();
  await signUpThroughApi(phone, 'Mamadou', PASSWORD);

  await enterPhone(page, phone);
  await enterCode(page, phone);
  await expect(page.getByRole('heading', { name: 'Vous avez déjà un compte' })).toBeFocused();
  await expectAccessible(page, 'Inscription : déjà inscrit');

  await page
    .getByRole('region', { name: 'Vous avez déjà un compte' })
    .getByRole('link', { name: 'Se connecter' })
    .click();
  await expect(page.getByLabel('Numéro de téléphone')).toHaveValue(phone);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Connexion' }).click();
  await expect(page.getByText('Bonjour Mamadou.')).toBeVisible();
});

test('connexion : numéro saisi avec indicatif et espaces, mauvais mot de passe refusé', async ({
  page,
}) => {
  const phone = newPhone();
  await signUpThroughApi(phone, 'Fanta', PASSWORD);

  await page.goto('/connexion');
  await expectAccessible(page, 'Connexion (site)');
  await page.getByRole('link', { name: 'Se connecter' }).click();
  const field = page.getByLabel('Numéro de téléphone');
  await expect(field).toHaveValue('');

  await field.fill(`+224 ${phone.slice(0, 3)} ${phone.slice(3)}`);
  await page.getByLabel('Mot de passe', { exact: true }).fill('99999999');
  await page.getByRole('button', { name: 'Connexion' }).click();
  await expect(page.getByText('Numéro de téléphone ou mot de passe incorrect.')).toBeVisible();
  await expectAccessible(page, 'Connexion Keycloak : erreur');

  await field.fill(`+224 ${phone.slice(0, 3)} ${phone.slice(3)}`);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Connexion' }).click();
  await expect(page.getByText('Bonjour Fanta.')).toBeVisible();

  // Toute connexion est journalisée (R-ACC-05) : l'échec, relevé dans le domaine des
  // citoyens (toutes les 5 s en local), et la réussite, écrite par l'API
  await expect
    .poll(() => auditActions(phone), { timeout: 20_000, intervals: [1_000] })
    .toEqual(
      expect.arrayContaining([
        'application:compte.inscription',
        'keycloak-public:keycloak.login_error',
        'application:connexion.reussie',
      ]),
    );
});
