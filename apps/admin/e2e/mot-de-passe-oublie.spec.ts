// Mot de passe oublié et alertes de sécurité par e-mail pour les comptes de gestion (décision
// du maître d'œuvre du 17/11/2026) : flux natif de Keycloak, e-mails lus dans Mailpit.
import { expect, test } from '@playwright/test';
import { expectAccessible, firstAdministratorLogin, startLogin, submitPassword } from './helpers';
import { createUser, msUntilNextPeriod, totp } from './keycloak';
import { mailsTo, waitForMail } from './mailpit';

test('mot de passe oublié : lien par e-mail, nouveau mot de passe, double facteur toujours demandé, alertes', async ({
  page,
}) => {
  const user = await createUser('admin_regional');
  const address = `${user.username}@exemple.invalid`;

  // Première connexion : configuration du double facteur, signalée par e-mail
  const secret = await firstAdministratorLogin(page, user);
  await waitForMail(address, /^Mise à jour de l'OTP$/);
  await page.context().clearCookies();

  // Demande depuis la page de connexion, par l'identifiant
  await startLogin(page);
  await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
  await expectAccessible(page, 'Mot de passe oublié');
  await page.getByLabel(/Nom d'utilisateur/).fill(user.username);
  await page.getByRole('button', { name: /Soumettre|Envoyer|Valider/ }).click();
  await expect(page.getByText(/recevoir un courriel|e-mail|courriel/i).first()).toBeVisible();

  // Lien reçu par e-mail, à usage unique
  const reset = await waitForMail(address, /^Réinitialiser le mot de passe$/);
  const link = reset.text.match(/https?:\/\/\S+action-token\S+/)?.[0];
  expect(link, reset.text).toBeTruthy();
  await page.goto(link!);

  // La boîte e-mail ne suffit pas : le code du double facteur est demandé avant tout changement
  await expect(page.locator('#otp')).toBeVisible();
  await page.waitForTimeout(msUntilNextPeriod());
  await page.locator('#otp').fill(totp(secret));
  await page.getByRole('button', { name: 'Connexion' }).click();

  const newPassword = `Nouveau-${user.password}`;
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirmation du mot de passe').fill(newPassword);
  await page.getByRole('button', { name: /Valider|Soumettre/ }).click();
  await expect(page).toHaveURL(/localhost:\d+\/(?!realms)/);

  // Alerte du changement de mot de passe
  await waitForMail(address, /^Mise à jour du mot de passe$/);

  // L'ancien mot de passe ne fonctionne plus, le nouveau si
  await page.context().clearCookies();
  await startLogin(page);
  await submitPassword(page, user);
  await expect(page.getByText(/invalide/i).first()).toBeVisible();
  await submitPassword(page, user, newPassword);
  await expect(page.locator('#otp')).toBeVisible();

  // Une alerte par changement, aucune pour un simple échec de connexion
  const subjects = (await mailsTo(address)).map((mail) => mail.subject).sort();
  expect(subjects).toEqual([
    "Mise à jour de l'OTP",
    'Mise à jour du mot de passe',
    'Réinitialiser le mot de passe',
  ]);
});
