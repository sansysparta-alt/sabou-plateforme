// US-047 : la DG prononce un rejet définitif depuis l'application de gestion, de bout en
// bout (vrai Keycloak avec second facteur, vraie API, vraie base). Deux cas décidés par le
// maître d'œuvre le 14 novembre 2026 : dossier en cours, praticien déjà certifié sans dossier.
// Un autre rôle n'a ni l'écran ni l'API (critère 1).
import { expect, test, type Page } from '@playwright/test';
import { psql } from './audit';
import { certifiedPractitioner, dossierAtStep } from './dossiers';
import { administrator, expectAccessible, firstAdministratorLogin } from './helpers';
import { APP } from './keycloak';

async function findPractitioner(page: Page, query: string, code: RegExp) {
  await page.getByLabel('Praticien', { exact: true }).fill(query);
  await page.getByRole('button', { name: 'Rechercher' }).click();
  return page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 3, name: code }) });
}

test('US-047 : la DG rejette un dossier en cours, puis un praticien déjà certifié', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const prefectoral = await administrator('admin_prefectoral', { prefecture: 'Kankan' });
  const dg = await administrator('dg', { national: true });
  await firstAdministratorLogin(page, dg);
  const dossier = dossierAtStep(4, 'Kankan', prefectoral.id);
  const praticien = psql(
    `SELECT p.code FROM sabou.praticien p JOIN sabou.dossier_certification d
        ON d.praticien_id = p.id WHERE d.code = '${dossier}'`,
  ).trim();

  // Cas 1 : dossier en cours à l'étape 4, pratique dangereuse avec avis du Comité
  await page.goto(APP);
  await page.getByRole('link', { name: 'Rejet définitif' }).click();
  let card = await findPractitioner(page, dossier, new RegExp(praticien));
  await expect(card.getByText(`${dossier}, étape 4 sur 6`)).toBeVisible();
  await card.getByRole('button', { name: /^Prononcer le rejet définitif/ }).click();
  await card.getByLabel(/Pratique dangereuse avérée/).check();
  await card.getByLabel('Date de l’avis du Comité scientifique').fill('2026-11-10');
  await card.getByLabel('Référence de l’avis du Comité').fill('AV-2026-014');
  await card
    .getByLabel('Faits qui fondent le rejet')
    .fill('Décoction toxique servie à des enfants, constatée par le Comité.');
  await expect(card.getByText(`Le dossier ${dossier} est clos à l’étape 4.`)).toBeVisible();
  await expectAccessible(page, 'rejet définitif : formulaire');
  await card.getByRole('checkbox').check();
  await card.getByRole('button', { name: 'Prononcer le rejet définitif' }).click();
  // Le message de réussite reçoit le focus (le formulaire a disparu)
  await expect(
    card.getByRole('status').filter({ hasText: 'Rejet définitif prononcé' }),
  ).toBeFocused();
  await expect(card.getByText('Rejeté définitivement')).toBeVisible();

  const [state, sms, avis] = psql(
    `SELECT concat_ws(';',
              p.statut || '|' || d.statut || '|' || d.etape_courante,
              n.modele || '|' || n.objet_id || '|' ||
                ((n.parametres->>'recoursJusquau')::date - current_date),
              r.motif || '|' || r.avis_comite_reference || '|' || r.avis_comite_le)
       FROM sabou.dossier_certification d
       JOIN sabou.praticien p ON p.id = d.praticien_id
       JOIN sabou.notification n ON n.destinataire_id = p.utilisateur_id
                                AND n.modele = 'praticien.rejet_definitif'
       JOIN sabou.rejet_definitif r ON r.dossier_id = d.id
      WHERE d.code = '${dossier}'`,
  )
    .trim()
    .split(';');
  expect(state).toBe('rejete|rejete_definitif|4');
  expect(sms).toBe(`praticien.rejet_definitif|${dossier}|30`);
  expect(avis).toBe('pratique_dangereuse|AV-2026-014|2026-11-10');

  // Cas 2 : praticien certifié sans dossier en cours, trouvé par son numéro de certificat
  const certified = certifiedPractitioner();
  await page.goto(`${APP}/rejet-definitif`);
  card = await findPractitioner(page, certified.certificat, new RegExp(certified.praticien));
  await expect(card.getByText('Certifié', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: /^Prononcer le rejet définitif/ }).click();
  await card.getByLabel('Fraude documentaire').check();
  await card.getByLabel('Faits qui fondent le rejet').fill('Diplôme falsifié.');
  await expect(card.getByText(`Le certificat ${certified.certificat} est révoqué.`)).toBeVisible();
  await card.getByRole('checkbox').check();
  await card.getByRole('button', { name: 'Prononcer le rejet définitif' }).click();
  await expect(card.getByText('Rejet définitif prononcé')).toBeVisible();
  await expectAccessible(page, 'rejet définitif : décision prononcée');
  expect(
    psql(
      `SELECT p.statut || '|' || c.statut || '|' || c.motif_revocation
         FROM sabou.certificat c JOIN sabou.praticien p ON p.id = c.praticien_id
        WHERE c.numero = '${certified.certificat}'`,
    ).trim(),
  ).toBe('rejete|revoque|Rejet définitif : Fraude documentaire');
});

test('US-047, critère 1 : un admin régional n’a ni l’écran ni l’API du rejet définitif', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const regional = await administrator('admin_regional', { region: 'Kankan' });
  await firstAdministratorLogin(page, regional);
  await page.goto(APP);
  await expect(page.getByRole('link', { name: 'Consolidation régionale' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Rejet définitif' })).toHaveCount(0);
  // Adresse saisie directement : l'accueil s'affiche, pas l'écran de la DG
  await page.goto(`${APP}/rejet-definitif`);
  await expect(page.getByRole('heading', { level: 1, name: 'Rejet définitif' })).toHaveCount(0);

  const { praticien, certificat } = certifiedPractitioner();
  const search = await page.request.get(`${APP}/api/praticiens/recherche?q=${praticien}`);
  expect(search.status()).toBe(403);
  const reject = await page.request.post(`${APP}/api/praticiens/${praticien}/rejet-definitif`, {
    headers: { origin: APP },
    data: { dossier: null, motif: 'fraude_documentaire', detail: 'Essai', confirmation: true },
  });
  expect(reject.status()).toBe(403);
  expect(psql(`SELECT statut FROM sabou.certificat WHERE numero = '${certificat}'`).trim()).toBe(
    'actif',
  );
});
