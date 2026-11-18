// Critères d'acceptation du lot A (US-012, US-013), de bout en bout : application de gestion
// (compilée), API, Keycloak, Valkey et PostgreSQL réels. Chaque écran traversé est vérifié
// par axe (WCAG 2.2 AA). Le jeu d'exemple fournit les régions et les langues.
import { randomBytes } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { accountAuditActions, accountRow } from './audit';
import {
  expectAccessible,
  firstAdministratorLogin,
  loginWithCode,
  sessionStatus,
  startLogin,
  submitPassword,
} from './helpers';
import { APP, createUser, keycloakUser, realmRoles, type TestUser } from './keycloak';

// Parcours complets avec double facteur (attente d'une période TOTP à chaque connexion)
test.setTimeout(240_000);

interface Invitee {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

function newInvitee(): Invitee {
  const tag = randomBytes(4).toString('hex');
  return {
    firstName: 'Fanta',
    lastName: `Essai-${tag}`,
    email: `essai-${tag}@exemple.invalid`,
    password: `Une phrase de passe ${randomBytes(6).toString('hex')}`,
  };
}

async function dgOnAccountsPage(page: Page): Promise<void> {
  const dg = await createUser('dg');
  await firstAdministratorLogin(page, dg);
  await page.getByRole('link', { name: 'Gérer les comptes' }).click();
  await expect(page).toHaveURL(`${APP}/comptes`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Comptes');
}

async function fillIdentity(page: Page, invitee: Invitee, role: string): Promise<void> {
  // Formulaire ouvert à la demande (US-019)
  const opener = page.getByRole('button', { name: 'Inviter un compte' });
  if ((await opener.getAttribute('aria-expanded')) !== 'true') await opener.click();
  const form = page.getByRole('region', { name: 'Inviter un compte' });
  await form.getByLabel('Prénom').fill(invitee.firstName);
  await form.getByLabel('Nom', { exact: true }).fill(invitee.lastName);
  await form.getByLabel('Adresse e-mail').fill(invitee.email);
  // Téléphone obligatoire (US-012b, MOE 17/11/2026), saisi librement, enregistré en +224
  await form.getByLabel('Téléphone', { exact: true }).fill('621 23 45 67');
  await form.getByLabel('Rôle').selectOption({ label: role });
}

async function submitInvitation(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Créer l’invitation' }).click();
}

async function invitationLink(page: Page, invitee: Invitee): Promise<string> {
  const panel = page.getByRole('region', {
    name: `Lien d’invitation pour ${invitee.firstName} ${invitee.lastName}`,
  });
  await expect(panel).toBeVisible();
  return panel.getByLabel('Lien').inputValue();
}

// L'invité ouvre le lien dans son propre navigateur et choisit son mot de passe
async function accept(browser: Browser, link: string, invitee: Invitee): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    `Bienvenue, ${invitee.firstName}`,
  );
  // Le jeton est retiré de la barre d'adresse dès la lecture
  await expect(page).toHaveURL(`${APP}/invitation`);
  await page.getByLabel('Choisissez un mot de passe').fill(invitee.password);
  await page.getByLabel('Saisissez-le une seconde fois').fill(invitee.password);
  await page.getByRole('button', { name: 'Enregistrer mon mot de passe' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Compte activé');
  return page;
}

const asTestUser = (invitee: Invitee, id: string): TestUser => ({
  id,
  username: invitee.email,
  password: invitee.password,
});

test('US-012 : invitation acceptée, le compte a exactement le rôle, la zone et les langues attribués', async ({
  page,
  browser,
}) => {
  await dgOnAccountsPage(page);
  await expectAccessible(page, 'Comptes');
  const invitee = newInvitee();

  // Critère 2 : rôle régional sans région, enregistrement refusé
  await fillIdentity(page, invitee, 'Administrateur régional');
  await submitInvitation(page);
  // Refusé avant l'envoi, message sous le champ ; le serveur refuse aussi (tests de l'API)
  await expect(page.getByText('Choisissez une région.')).toBeVisible();
  await expect(page.getByLabel('Région')).toBeFocused();
  expect(accountRow(invitee.email)).toBeNull();
  await expectAccessible(page, 'Invitation refusée');

  // Critère 1 : rôle, zone et langues de travail attribués
  await page.getByLabel('Région').selectOption({ label: 'Kindia' });
  await page.getByRole('checkbox', { name: 'Enregistrer en Soussou' }).check();
  await page.getByRole('checkbox', { name: 'Valider en Soussou' }).check();
  await submitInvitation(page);
  const link = await invitationLink(page, invitee);
  expect(new URL(link).hash).toMatch(/^#[\w-]{43}$/);
  await expectAccessible(page, 'Lien d’invitation');
  expect(accountRow(invitee.email)).toMatchObject({ status: 'invite', keycloakId: null });

  // Mot de passe trop court : refusé avant tout envoi
  const invitePage = await (await browser.newContext()).newPage();
  await invitePage.goto(link);
  await expectAccessible(invitePage, 'Acceptation de l’invitation');
  await invitePage.getByLabel('Choisissez un mot de passe').fill('court');
  await invitePage.getByLabel('Saisissez-le une seconde fois').fill('court');
  await invitePage.getByRole('button', { name: 'Enregistrer mon mot de passe' }).click();
  // Message sous le champ concerné, qui reçoit le focus
  await expect(invitePage.getByText('Au moins 12 caractères.')).toBeVisible();
  await expect(invitePage.getByLabel('Choisissez un mot de passe')).toBeFocused();
  await invitePage.context().close();

  const accepted = await accept(browser, link, invitee);
  await expectAccessible(accepted, 'Compte activé');

  const row = accountRow(invitee.email)!;
  expect(row).toMatchObject({
    phone: '+224621234567',
    role: 'regional',
    region: 'Kindia',
    prefecture: null,
    status: 'actif',
    languages: [{ code: 'sou', record: true, translate: false, validate: true }],
  });
  const roles = await realmRoles(row.keycloakId!);
  expect(roles).toEqual(expect.arrayContaining(['admin_regional', 'administrateur']));
  expect(roles).not.toContain('dg');
  expect(accountAuditActions(row.id)).toEqual(['compte.invite', 'compte.active']);

  // Le lien ne sert qu'une fois (nouvelle page : sur /invitation, le même lien ne
  // changerait que le fragment, sans recharger)
  const reused = await accepted.context().newPage();
  await reused.goto(link);
  await expect(reused.getByRole('alert')).toContainText('n’est plus valable');
});

test('US-013 : suspension en un clic, sessions révoquées, nouvelle connexion refusée, journalisée', async ({
  page,
  browser,
}) => {
  await dgOnAccountsPage(page);
  const invitee = newInvitee();
  await fillIdentity(page, invitee, 'Comité scientifique');
  await submitInvitation(page);
  const link = await invitationLink(page, invitee);
  const target = await accept(browser, link, invitee);
  const row = accountRow(invitee.email)!;
  const user = asTestUser(invitee, row.keycloakId!);
  const secret = await firstAdministratorLogin(target, user);
  expect(await sessionStatus(target)).toBe(200);

  // Un clic de la DG
  await page.reload();
  // Tableau paginé (US-019) : le compte est retrouvé par la recherche
  await page.getByRole('searchbox', { name: 'Rechercher un compte' }).fill(invitee.email);
  const item = page.getByRole('row').filter({ hasText: invitee.email });
  await item
    .getByRole('button', {
      name: `Suspendre le compte de ${invitee.firstName} ${invitee.lastName}`,
    })
    .click();
  await expect(item.getByText('Suspendu', { exact: true })).toBeVisible();
  await expectAccessible(page, 'Compte suspendu');

  // Session en cours révoquée dans la minute (ici, immédiatement)
  await expect.poll(() => sessionStatus(target), { timeout: 60_000 }).toBe(401);
  // Nouvelle connexion refusée par Keycloak
  expect((await keycloakUser(invitee.email))?.enabled).toBe(false);
  await startLogin(target);
  await submitPassword(target, user);
  await expect(target.locator('#input-error, .alert-error, [role="alert"]').first()).toBeVisible();
  expect(await sessionStatus(target)).toBe(401);
  expect(accountAuditActions(row.id)).toContain('compte.suspendu');

  // Réactivation : l'accès revient
  await item
    .getByRole('button', {
      name: `Réactiver le compte de ${invitee.firstName} ${invitee.lastName}`,
    })
    .click();
  await expect(item.getByText('Actif', { exact: true })).toBeVisible();
  expect((await keycloakUser(invitee.email))?.enabled).toBe(true);
  await loginWithCode(target, user, secret);
  expect(accountAuditActions(row.id)).toEqual(
    expect.arrayContaining(['compte.suspendu', 'compte.reactive']),
  );
});
