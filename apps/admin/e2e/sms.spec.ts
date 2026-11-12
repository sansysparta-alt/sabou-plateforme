// US-031 : SMS au praticien à chaque étape, de bout en bout. Vraie API (faux fournisseur
// « journal », file relevée toutes les 5 s sur le poste local), vraie base, vrai Keycloak.
import { expect, test } from '@playwright/test';
import { psql } from './audit';
import { decide, dossierAtStep } from './dossiers';
import { administrator, expectAccessible, firstAdministratorLogin } from './helpers';
import { APP } from './keycloak';

// Dernier SMS du dossier : « statut tentatives raison »
const lastSms = (code: string) =>
  psql(`SELECT statut || ' ' || tentatives || ' ' || coalesce(derniere_erreur, '-')
          FROM sabou.notification WHERE objet_id = '${code}' AND canal = 'sms'
         ORDER BY id DESC LIMIT 1`).trim();
const smsCount = (code: string) =>
  Number(psql(`SELECT count(*) FROM sabou.notification WHERE objet_id = '${code}'`).trim());

test('US-031 : SMS envoyé après la décision, aucun pour une décision refusée ; échec visible par la DG', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const regional = await administrator('admin_regional', { region: 'Labé' });
  await firstAdministratorLogin(page, regional);
  const delivered = dossierAtStep(3, 'Labé', regional.id);
  const unreachable = dossierAtStep(3, 'Koubia', regional.id);
  // Numéro que le faux fournisseur refuse (plage d'essai +224 669 99…, voir apps/api/src/sms/sms.ts)
  psql(`UPDATE sabou.utilisateur SET telephone = '+22466999' || lpad((random() * 9999)::int::text, 4, '0')
         WHERE id = (SELECT p.utilisateur_id FROM sabou.praticien p
                       JOIN sabou.dossier_certification d ON d.praticien_id = p.id
                      WHERE d.code = '${unreachable}')`);

  // Critère 2 : décision refusée (rejet sans motif), aucun SMS en file
  expect((await decide(page, delivered, { etape: 3, decision: 'rejete' })).status()).toBe(400);
  expect(smsCount(delivered)).toBe(0);

  // Critère 1 : décision validée, le SMS part sans attendre (ici en quelques secondes)
  expect((await decide(page, delivered, { etape: 3, decision: 'valide' })).status()).toBe(200);
  await expect
    .poll(() => lastSms(delivered), { timeout: 30_000, intervals: [1_000] })
    .toBe('envoyee 1 -');

  // Critère 3 : refus du fournisseur, l'échec est enregistré puis montré à la DG (les 3
  // nouveaux essais d'une erreur passagère sont prouvés en base : notification-sms.test.ts)
  expect((await decide(page, unreachable, { etape: 3, decision: 'valide' })).status()).toBe(200);
  await expect
    .poll(() => lastSms(unreachable), { timeout: 30_000, intervals: [1_000] })
    .toBe('echec 1 Numéro refusé par le fournisseur (essai)');
  expect(
    psql(`SELECT action FROM sabou.journal_audit
           WHERE objet_id = '${unreachable}' ORDER BY id DESC LIMIT 1`).trim(),
  ).toBe('notification.echec');

  const context = await browser.newContext();
  try {
    const dgPage = await context.newPage();
    const dg = await administrator('dg', { national: true });
    await firstAdministratorLogin(dgPage, dg);
    await dgPage.goto(APP);
    const failures = dgPage.getByRole('region', { name: 'SMS non remis' });
    await expect(
      failures.getByRole('row', { name: new RegExp(`${unreachable}.*Numéro refusé`) }),
    ).toBeVisible();
    // Le dossier livré n'y figure pas
    await expect(failures.getByRole('row', { name: new RegExp(delivered) })).toHaveCount(0);
    await expectAccessible(dgPage, 'tableau de bord de la DG avec SMS non remis');
  } finally {
    await context.close();
  }

  // Le régional ne voit pas les échecs d'envoi (DG seule)
  await page.goto(APP);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('SMS non remis')).toHaveCount(0);
});
