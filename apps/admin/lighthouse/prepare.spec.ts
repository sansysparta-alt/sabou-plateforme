// Préparation de Lighthouse CI (US-016) : ouvre les sessions nécessaires pour mesurer chaque
// page livrée, y compris celles qui exigent une connexion ou une étape Keycloak en cours.
// Écrit .lighthouse/pages.json : groupes de pages, chacun avec les cookies de sa session
// (comptes de test jetables du poste ou du pipeline, fichier ignoré par Git).
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { psql } from '../e2e/audit';
import {
  administrator,
  configureTotp,
  firstAdministratorLogin,
  startLogin,
  submitPassword,
} from '../e2e/helpers';
import { APP, createUser, KEYCLOAK, type TestUser } from '../e2e/keycloak';

export interface PageGroup {
  name: string;
  // En-tête Cookie envoyé par Lighthouse avec chaque requête du groupe
  cookie: string;
  urls: string[];
}

async function cookieHeader(context: BrowserContext): Promise<string> {
  return (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
}

// Compte Keycloak d'administrateur neuf, arrêté sur la page Keycloak voulue
async function stoppedAt(browser: Browser, step: 'totp' | 'codes-de-secours') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await startLogin(page);
  await submitPassword(page, await createUser('dg'));
  await expect(page.locator('#kc-totp-settings')).toBeVisible();
  if (step === 'codes-de-secours') {
    await configureTotp(page);
    await expect(page.locator('#kc-recovery-codes-list')).toBeVisible();
  }
  return { context, url: page.url() };
}

// DG liée à une ligne en base : le tableau de bord affiche les chiffres nationaux
function linkToPlatform(user: TestUser): void {
  if (!/^[0-9a-f-]{36}$/.test(user.id) || !/^[a-z_]+-[0-9a-f]{8}$/.test(user.username)) {
    throw new Error(`Compte de test invalide : ${user.username}`);
  }
  psql(`SET search_path = sabou, public;
        INSERT INTO sabou.utilisateur (email, prenom, nom, role_code, statut, keycloak_id)
        VALUES ('${user.username}@exemple.invalid', 'Essai', 'Mesure', 'dg', 'actif', '${user.id}')`);
}

test('sessions des pages mesurées par Lighthouse', async ({ browser }) => {
  test.setTimeout(240_000);

  // DG connectée (premier passage : TOTP, codes de secours, puis code)
  const dgContext = await browser.newContext();
  const dgPage = await dgContext.newPage();
  const dg = await createUser('dg');
  linkToPlatform(dg);
  await firstAdministratorLogin(dgPage, dg);

  // Lien d'invitation valide : la page d'acceptation est mesurée formulaire affiché
  const tag = dg.username.split('-')[1];
  const invitation = await dgPage.request.post(`${APP}/api/comptes`, {
    headers: { origin: APP },
    data: {
      email: `mesure-${tag}@exemple.invalid`,
      firstName: 'Fanta',
      lastName: 'Mesure',
      role: 'dg',
      regionId: null,
      prefectureId: null,
      interfaceLanguage: 'fr',
      listeningLanguage: null,
      languages: [],
    },
  });
  expect(invitation.status()).toBe(201);
  const { link } = (await invitation.json()) as { link: string };

  // Saisie du code à la connexion suivante (DG déjà équipée), dans un autre navigateur
  const codeContext = await browser.newContext();
  const codePage = await codeContext.newPage();
  await startLogin(codePage);
  await submitPassword(codePage, dg);
  await expect(codePage.locator('#otp')).toBeVisible();

  // Admin préfectoral de Labé connecté : page de vérification terrain (US-042)
  const prefectoralContext = await browser.newContext();
  await firstAdministratorLogin(
    await prefectoralContext.newPage(),
    await administrator('admin_prefectoral', { prefecture: 'Labé' }),
  );

  // Admin régional de Labé connecté : page de consolidation (US-043)
  const regionalContext = await browser.newContext();
  await firstAdministratorLogin(
    await regionalContext.newPage(),
    await administrator('admin_regional', { region: 'Labé' }),
  );

  // Membre du Comité scientifique connecté : page d'expertise (US-044)
  const committeeContext = await browser.newContext();
  await firstAdministratorLogin(
    await committeeContext.newPage(),
    await administrator('comite', { national: true }),
  );

  const totp = await stoppedAt(browser, 'totp');
  const recovery = await stoppedAt(browser, 'codes-de-secours');

  // Page de connexion Keycloak (thème SABOU) : demande d'autorisation sans session
  const keycloakLogin =
    `${KEYCLOAK}/realms/sabou/protocol/openid-connect/auth?client_id=sabou-admin` +
    `&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(`${APP}/auth/callback`)}` +
    `&code_challenge=${'A'.repeat(43)}&code_challenge_method=S256&state=lighthouse`;

  const groups: PageGroup[] = [
    { name: 'sans session', cookie: '', urls: [`${APP}/`, keycloakLogin, link] },
    {
      name: 'DG connectée',
      cookie: await cookieHeader(dgContext),
      // « ?vue= » distingue l'accueil connecté de l'accueil sans session dans les rapports
      // Approbation et certificat à imprimer (US-045) : certificat du jeu d'exemple ;
      // rejet définitif (US-047) ; entonnoir des 6 étapes (US-048)
      urls: [
        `${APP}/?vue=tableau-de-bord`,
        `${APP}/comptes`,
        `${APP}/referentiels`,
        `${APP}/approbation`,
        `${APP}/certificats/SAB-2026-PR1042-KX7`,
        `${APP}/rejet-definitif`,
        `${APP}/entonnoir`,
      ],
    },
    {
      name: 'admin préfectoral connecté',
      cookie: await cookieHeader(prefectoralContext),
      urls: [`${APP}/verification-terrain`],
    },
    {
      name: 'admin régional connecté',
      cookie: await cookieHeader(regionalContext),
      urls: [`${APP}/consolidation`],
    },
    {
      name: 'Comité scientifique connecté',
      cookie: await cookieHeader(committeeContext),
      urls: [`${APP}/expertise`],
    },
    { name: 'saisie du code', cookie: await cookieHeader(codeContext), urls: [codePage.url()] },
    { name: 'activation du code', cookie: await cookieHeader(totp.context), urls: [totp.url] },
    {
      name: 'codes de secours',
      cookie: await cookieHeader(recovery.context),
      urls: [recovery.url],
    },
  ];
  mkdirSync('.lighthouse', { recursive: true });
  writeFileSync('.lighthouse/pages.json', JSON.stringify(groups, null, 2));
});
