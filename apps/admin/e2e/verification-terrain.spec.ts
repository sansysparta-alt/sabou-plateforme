// US-042 : l'admin préfectoral valide ou rejette un dossier à l'étape 2, de bout en bout.
// Vrai Keycloak (second facteur), vraie API, vraie base. Les dossiers et leurs visites sont
// créés en base pour chaque test ; la saisie des visites à l'écran est prouvée par
// visites-terrain.spec.ts (US-041).
import { expect, test } from '@playwright/test';
import { psql } from './audit';
import { decide, dossierAtStep2, showRunDossiers, stepOf } from './dossiers';
import { administrator, expectAccessible, firstAdministratorLogin } from './helpers';
import { APP } from './keycloak';

test('US-042 : le préfectoral valide après la visite et rejette avec motif ; hors zone et sans visite, refus', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await administrator('admin_prefectoral', { prefecture: 'Labé' });
  await firstAdministratorLogin(page, user);
  const visited = dossierAtStep2('Labé', user.id, 'realisee');
  const notVisited = dossierAtStep2('Labé', user.id, 'planifiee');
  // Visite réalisée : seule la zone peut justifier le refus
  const elsewhere = dossierAtStep2('Kankan', user.id, 'realisee');

  await page.goto(APP);
  await page.getByRole('link', { name: 'Vérification terrain' }).click();
  await showRunDossiers(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Vérification terrain' })).toBeVisible();
  const card = (code: string) =>
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: new RegExp(`^${code} `) }) });
  await expect(card(visited)).toBeVisible();
  // Le dossier de Kankan n'apparaît pas dans la liste de Labé
  await expect(card(elsewhere)).toHaveCount(0);
  // Dossiers repliés sur une ligne (US-019) : on ouvre celui qu'on traite
  await card(visited).locator('summary').click();
  await card(notVisited).locator('summary').click();
  await expectAccessible(page, 'vérification terrain');

  // Critère 2 : sans visite réalisée, pas de bouton à l'écran, et l'API refuse aussi
  await expect(card(notVisited).getByRole('button', { name: /^Valider/ })).toHaveCount(0);
  const refused = await decide(page, notVisited, { etape: 2, decision: 'valide' });
  expect(refused.status()).toBe(409);
  expect(((await refused.json()) as { error: string }).error).toBe('visit_required');
  expect(stepOf(notVisited)).toBe(2);

  // Critère 4 : dossier d'une autre préfecture, refusé sans dire s'il existe
  const outside = await decide(page, elsewhere, { etape: 2, decision: 'valide' });
  expect(outside.status()).toBe(404);
  expect(stepOf(elsewhere)).toBe(2);

  // Étape vue différente de l'étape réelle (dossier qui a bougé entre-temps) : refus
  const stale = await decide(page, visited, { etape: 3, decision: 'valide' });
  expect(stale.status()).toBe(409);
  expect(((await stale.json()) as { error: string }).error).toBe('stale');
  expect(stepOf(visited)).toBe(2);

  // Critère 1 : visite réalisée, validation → étape 3
  await card(visited)
    .getByRole('button', { name: /^Valider/ })
    .click();
  await expect(page.getByRole('status')).toHaveText(
    `Dossier ${visited} validé : il passe à la consolidation régionale.`,
  );
  await expect(card(visited)).toHaveCount(0);
  expect(stepOf(visited)).toBe(3);

  // Critère 3 : rejet sans motif refusé (écran et API), avec motif → étape 1
  await card(notVisited)
    .getByRole('button', { name: /^Rejeter/ })
    .click();
  await card(notVisited).getByRole('button', { name: 'Confirmer le rejet' }).click();
  await expect(card(notVisited).getByText('Indiquez le motif du rejet.')).toBeVisible();
  expect((await decide(page, notVisited, { etape: 2, decision: 'rejete' })).status()).toBe(400);
  await expectAccessible(page, 'rejet d’un dossier');
  await card(notVisited)
    .getByLabel('Motif du rejet')
    .fill('Lieu de pratique introuvable à l’adresse indiquée');
  await card(notVisited).getByRole('button', { name: 'Confirmer le rejet' }).click();
  await expect(card(notVisited)).toHaveCount(0);
  expect(stepOf(notVisited)).toBe(1);
  expect(
    psql(`SELECT motif FROM sabou.dossier_historique h JOIN sabou.dossier_certification d ON d.id = h.dossier_id
           WHERE d.code = '${notVisited}' ORDER BY h.id DESC LIMIT 1`).trim(),
  ).toBe('Lieu de pratique introuvable à l’adresse indiquée');
});
