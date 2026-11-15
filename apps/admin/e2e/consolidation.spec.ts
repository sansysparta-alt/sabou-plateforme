// US-043 : l'admin régional consolide un dossier à l'étape 3, de bout en bout. Vrai Keycloak
// (second facteur), vraie API, vraie base ; dossiers créés en base (e2e/dossiers.ts).
import { expect, test } from '@playwright/test';
import { psql } from './audit';
import { decide, dossierAtStep, stepOf } from './dossiers';
import { administrator, expectAccessible, firstAdministratorLogin } from './helpers';
import { APP } from './keycloak';

test('US-043 : le régional valide (étape 4) et rejette avec motif (étape 2) ; hors région, refus', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await administrator('admin_regional', { region: 'Labé' });
  await firstAdministratorLogin(page, user);
  // Deux préfectures de la région de Labé, et une autre région
  const toValidate = dossierAtStep(3, 'Koubia', user.id);
  const toReject = dossierAtStep(3, 'Labé', user.id);
  const elsewhere = dossierAtStep(3, 'Kankan', user.id);

  await page.goto(APP);
  await page.getByRole('link', { name: 'Consolidation régionale' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Consolidation régionale' }),
  ).toBeVisible();
  const card = (code: string) =>
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: new RegExp(`^${code} `) }) });
  await expect(card(toValidate)).toBeVisible();
  // Dossiers repliés sur une ligne (US-019) : on ouvre celui qu'on traite
  await card(toValidate).locator('summary').click();
  await card(toReject).locator('summary').click();
  await expect(card(toValidate).getByText('Koubia')).toBeVisible();
  await expect(card(toReject)).toBeVisible();
  // Le dossier de la région de Kankan n'apparaît pas dans la liste de Labé
  await expect(card(elsewhere)).toHaveCount(0);
  await expectAccessible(page, 'consolidation régionale');

  // Dossier d'une autre région : refusé sans dire s'il existe
  const outside = await decide(page, elsewhere, { etape: 3, decision: 'valide' });
  expect(outside.status()).toBe(404);
  expect(stepOf(elsewhere)).toBe(3);

  // Étape vue différente de l'étape réelle : refus, rien ne bouge
  const stale = await decide(page, toValidate, { etape: 2, decision: 'valide' });
  expect(stale.status()).toBe(409);
  expect(stepOf(toValidate)).toBe(3);

  // Critère : validation → étape 4
  await card(toValidate)
    .getByRole('button', { name: /^Valider/ })
    .click();
  await expect(page.getByRole('status')).toHaveText(
    `Dossier ${toValidate} validé : il passe à l’expertise du Comité scientifique.`,
  );
  await expect(card(toValidate)).toHaveCount(0);
  expect(stepOf(toValidate)).toBe(4);

  // Critère : rejet sans motif refusé (écran et API) ; avec motif → étape 2
  await card(toReject)
    .getByRole('button', { name: /^Rejeter/ })
    .click();
  await card(toReject).getByRole('button', { name: 'Confirmer le rejet' }).click();
  await expect(card(toReject).getByText('Indiquez le motif du rejet.')).toBeVisible();
  expect((await decide(page, toReject, { etape: 3, decision: 'rejete' })).status()).toBe(400);
  expect(stepOf(toReject)).toBe(3);
  await expectAccessible(page, 'rejet d’un dossier en consolidation');
  await card(toReject).getByLabel('Motif du rejet').fill('Compte rendu de visite incomplet');
  await card(toReject).getByRole('button', { name: 'Confirmer le rejet' }).click();
  await expect(page.getByRole('status')).toHaveText(
    `Dossier ${toReject} rejeté : il revient à la vérification terrain.`,
  );
  expect(stepOf(toReject)).toBe(2);
  expect(
    psql(`SELECT h.etape_depart || ' ' || h.motif FROM sabou.dossier_historique h
            JOIN sabou.dossier_certification d ON d.id = h.dossier_id
           WHERE d.code = '${toReject}' ORDER BY h.id DESC LIMIT 1`).trim(),
  ).toBe('3 Compte rendu de visite incomplet');
});
