// US-044 : un membre du Comité scientifique expertise un dossier à l'étape 4, de bout en bout.
// Vrai Keycloak (second facteur), vraie API, vraie base ; dossiers créés en base
// (e2e/dossiers.ts). Le Comité est national : il voit les dossiers de toutes les régions.
import { expect, test } from '@playwright/test';
import { psql } from './audit';
import { decide, dossierAtStep, showRunDossiers, stepOf } from './dossiers';
import {
  administrator,
  closeDossier,
  expectAccessible,
  firstAdministratorLogin,
  openDossier,
} from './helpers';
import { APP } from './keycloak';

test('US-044 : le Comité valide (étape 5) et rejette avec motif (étape 3), toutes régions', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await administrator('comite', { national: true });
  await firstAdministratorLogin(page, user);
  // Deux régions différentes : Labé et Kankan
  const toValidate = dossierAtStep(4, 'Labé', user.id);
  const toReject = dossierAtStep(4, 'Kankan', user.id);
  // Dossier encore en consolidation : absent de la liste, et refusé s'il est décidé ici
  const notYet = dossierAtStep(3, 'Labé', user.id);

  await page.goto(APP);
  await page.getByRole('link', { name: 'Expertise des dossiers' }).click();
  await showRunDossiers(page);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Expertise des dossiers' }),
  ).toBeVisible();
  const card = (code: string) =>
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: new RegExp(`^${code} `) }) });
  await expect(card(toValidate)).toBeVisible();
  // Détail dans le panneau du dossier (05 §2.76), un seul ouvert à la fois
  const other = await openDossier(page, toReject);
  await expect(other.getByText('Kankan, région de Kankan')).toBeVisible();
  await closeDossier(other);
  const validating = await openDossier(page, toValidate);
  await expect(validating.getByText('Labé, région de Labé')).toBeVisible();
  await expect(card(notYet)).toHaveCount(0);
  await expectAccessible(page, 'expertise des dossiers');

  // Le Comité ne décide pas à la place du régional : étape 3, refus, rien ne bouge
  const notResponsible = await decide(page, notYet, { etape: 3, decision: 'valide' });
  expect(notResponsible.status()).toBe(403);
  expect(stepOf(notYet)).toBe(3);

  // Critère : validation → étape 5
  await validating.getByRole('button', { name: /^Valider/ }).click();
  await expect(page.getByRole('status')).toHaveText(
    `Dossier ${toValidate} validé : il passe à l’approbation de la Direction Générale.`,
  );
  await expect(card(toValidate)).toHaveCount(0);
  expect(stepOf(toValidate)).toBe(5);

  // Critère : rejet sans motif refusé (écran et API) ; avec motif → étape 3
  const rejecting = await openDossier(page, toReject);
  await rejecting.getByRole('button', { name: /^Rejeter/ }).click();
  await rejecting.getByRole('button', { name: 'Confirmer le rejet' }).click();
  await expect(rejecting.getByText('Indiquez le motif du rejet.')).toBeVisible();
  expect((await decide(page, toReject, { etape: 4, decision: 'rejete' })).status()).toBe(400);
  expect(stepOf(toReject)).toBe(4);
  await expectAccessible(page, 'rejet d’un dossier en expertise');
  await rejecting.getByLabel('Motif du rejet').fill('Dosage des décoctions à préciser');
  await rejecting.getByRole('button', { name: 'Confirmer le rejet' }).click();
  await expect(page.getByRole('status')).toHaveText(
    `Dossier ${toReject} rejeté : il revient à la consolidation régionale.`,
  );
  expect(stepOf(toReject)).toBe(3);
  expect(
    psql(`SELECT h.etape_depart || ' ' || h.motif FROM sabou.dossier_historique h
            JOIN sabou.dossier_certification d ON d.id = h.dossier_id
           WHERE d.code = '${toReject}' ORDER BY h.id DESC LIMIT 1`).trim(),
  ).toBe('4 Dosage des décoctions à préciser');
});
