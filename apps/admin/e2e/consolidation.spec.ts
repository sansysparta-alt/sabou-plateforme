// US-043 : l'admin régional consolide un dossier à l'étape 3, de bout en bout. Vrai Keycloak
// (second facteur), vraie API, vraie base. Les dossiers sont créés en base à l'étape 3, avec
// leur visite réalisée : la saisie des visites terrain arrive avec US-041.
import { randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { psql } from './audit';
import { administrator, expectAccessible, firstAdministratorLogin } from './helpers';
import { APP } from './keycloak';

// Praticien neuf de la préfecture donnée et son dossier à l'étape 3, visite réalisée avec
// compte rendu signé. Renvoie le code du dossier.
function dossierAtStep3(prefecture: 'Koubia' | 'Labé' | 'Kankan', author: string): string {
  // Seuls un identifiant Keycloak vérifié, un nom de préfecture de la liste ci-dessus et un
  // numéro tiré au hasard (plage 666…, sans abonné réel) entrent dans la requête
  if (!/^[0-9a-f-]{36}$/.test(author)) throw new Error(`Compte invalide : ${author}`);
  const phone = `+224666${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  const authorId = `(SELECT id FROM sabou.utilisateur WHERE keycloak_id = '${author}')`;
  const output = psql(`SET search_path = sabou, public;
    WITH u AS (
      INSERT INTO sabou.utilisateur (telephone, prenom, nom, role_code, statut, keycloak_id)
      VALUES ('${phone}', 'Essai', 'Consolidation', 'praticien', 'actif', gen_random_uuid()) RETURNING id),
    p AS (
      INSERT INTO sabou.praticien (utilisateur_id, specialite_id, prefecture_id, langue_principale, annees_experience)
      SELECT u.id, 1, (SELECT id FROM sabou.prefecture WHERE nom = '${prefecture}'), 'pul', 5 FROM u RETURNING id),
    d AS (
      INSERT INTO sabou.dossier_certification (praticien_id, etape_courante)
      SELECT id, 3 FROM p RETURNING id, code),
    cr AS (
      INSERT INTO sabou.dossier_piece (dossier_id, type, fichier_url, sha256, depose_par)
      SELECT id, 'compte_rendu_visite', 'pieces/e2e/visite.pdf', repeat('b', 64), ${authorId}
        FROM d RETURNING id, dossier_id),
    v AS (
      INSERT INTO sabou.visite_terrain (dossier_id, admin_id, prevue_le, realisee_le, compte_rendu_piece_id, statut)
      SELECT dossier_id, ${authorId}, now() - interval '2 days', now() - interval '1 day', id, 'realisee' FROM cr)
    SELECT code FROM d;`);
  const code = output.trim().split('\n').at(-1)!.trim();
  expect(code).toMatch(/^DS-\d+$/);
  return code;
}

const stepOf = (code: string) =>
  Number(
    psql(`SELECT etape_courante FROM sabou.dossier_certification WHERE code = '${code}'`).trim(),
  );

const decide = (page: Page, code: string, body: unknown) =>
  page.request.post(`${APP}/api/dossiers/${code}/decision`, {
    headers: { origin: APP },
    data: body,
  });

test('US-043 : le régional valide (étape 4) et rejette avec motif (étape 2) ; hors région, refus', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await administrator('admin_regional', { region: 'Labé' });
  await firstAdministratorLogin(page, user);
  // Deux préfectures de la région de Labé, et une autre région
  const toValidate = dossierAtStep3('Koubia', user.id);
  const toReject = dossierAtStep3('Labé', user.id);
  const elsewhere = dossierAtStep3('Kankan', user.id);

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
