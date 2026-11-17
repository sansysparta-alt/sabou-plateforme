// US-048 : la DG ouvre l'entonnoir des 6 étapes et voit les dossiers bloqués, de bout en bout
// (vrai Keycloak avec second facteur, vraie API, vraie base). Un autre rôle n'a ni l'écran
// ni l'API.
import { expect, test } from '@playwright/test';
import { psql } from './audit';
import { dossierAtStep } from './dossiers';
import { administrator, expectAccessible, firstAdministratorLogin } from './helpers';
import { APP } from './keycloak';

test('US-048 : nombre par étape, délai moyen et dossiers sans décision depuis plus de 15 jours', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const prefectoral = await administrator('admin_prefectoral', { prefecture: 'Kankan' });
  const dg = await administrator('dg', { national: true });
  await firstAdministratorLogin(page, dg);
  // Dossier à l'étape 4 depuis 20 jours : bloqué (R-CER-07)
  const dossier = dossierAtStep(4, 'Kankan', prefectoral.id);
  psql(`UPDATE sabou.dossier_certification SET etape_entree_le = now() - interval '20 days'
         WHERE code = '${dossier}'`);
  const atStep4 = Number(
    psql(`SELECT count(*) FROM sabou.dossier_certification
           WHERE statut = 'en_cours' AND etape_courante = 4`).trim(),
  );

  await page.goto(APP);
  await page.getByRole('link', { name: 'Entonnoir de certification' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Entonnoir de certification' }),
  ).toBeVisible();

  const steps = page.getByRole('table', { name: 'Dossiers par étape et délai moyen' });
  await expect(steps.getByRole('row')).toHaveCount(7);
  const step4 = steps.getByRole('row', { name: /^4\. Expertise du Comité/ });
  await expect(step4.getByRole('cell').nth(1)).toHaveText(String(atStep4));
  // Délai moyen : le jeu d'exemple a des passages à chaque étape (05 §2.38)
  await expect(
    steps
      .getByRole('row', { name: /^3\. Consolidation régionale/ })
      .getByRole('cell')
      .nth(3),
  ).toHaveText(/\d j$/);

  const blocked = page.getByRole('table', { name: 'Dossiers bloqués' });
  await expect(blocked.getByRole('row', { name: new RegExp(dossier) })).toContainText(
    /Expertise du Comité.*Kankan.*20 j/,
  );
  await expectAccessible(page, 'entonnoir de certification');
});

test('US-048 : un admin préfectoral n’a ni l’écran ni l’API de l’entonnoir', async ({ page }) => {
  test.setTimeout(90_000);
  const prefectoral = await administrator('admin_prefectoral', { prefecture: 'Labé' });
  await firstAdministratorLogin(page, prefectoral);
  await page.goto(APP);
  await expect(page.getByRole('link', { name: 'Vérification terrain' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Entonnoir de certification' })).toHaveCount(0);
  await page.goto(`${APP}/entonnoir`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Entonnoir de certification' }),
  ).toHaveCount(0);
  expect((await page.request.get(`${APP}/api/entonnoir`)).status()).toBe(403);
});
