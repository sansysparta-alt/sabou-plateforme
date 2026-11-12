// US-042 : l'admin préfectoral valide ou rejette un dossier à l'étape 2, de bout en bout.
// Vrai Keycloak (second facteur), vraie API, vraie base. Les dossiers sont créés en base pour
// chaque test : la saisie des visites terrain arrive avec US-041 (décision du maître
// d'œuvre du 9/11/2026).
import { randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { psql } from './audit';
import { administrator, expectAccessible, firstAdministratorLogin } from './helpers';
import { APP } from './keycloak';

// Praticien neuf et son dossier à l'étape 2, dans la préfecture donnée, avec une visite de
// l'admin préfectoral indiqué : réalisée avec compte rendu signé, ou seulement planifiée.
// Renvoie le code du dossier.
function dossierAtStep2(
  prefecture: 'Labé' | 'Kankan',
  admin: string,
  visit: 'realisee' | 'planifiee',
): string {
  // Seuls un identifiant Keycloak vérifié et un numéro tiré au hasard (plage 666…, sans
  // abonné réel) entrent dans la requête
  if (!/^[0-9a-f-]{36}$/.test(admin)) throw new Error(`Compte invalide : ${admin}`);
  const phone = `+224666${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  const adminId = `(SELECT id FROM sabou.utilisateur WHERE keycloak_id = '${admin}')`;
  const visitRows =
    visit === 'realisee'
      ? `cr AS (
           INSERT INTO sabou.dossier_piece (dossier_id, type, fichier_url, sha256, depose_par)
           SELECT id, 'compte_rendu_visite', 'pieces/e2e/visite.pdf', repeat('b', 64), ${adminId}
             FROM d RETURNING id, dossier_id),
         v AS (
           INSERT INTO sabou.visite_terrain (dossier_id, admin_id, prevue_le, realisee_le, compte_rendu_piece_id, statut)
           SELECT dossier_id, ${adminId}, now() - interval '1 day', now(), id, 'realisee' FROM cr)`
      : `v AS (
           INSERT INTO sabou.visite_terrain (dossier_id, admin_id, prevue_le, statut)
           SELECT id, ${adminId}, now() + interval '2 days', 'planifiee' FROM d)`;
  const output = psql(`SET search_path = sabou, public;
    WITH u AS (
      INSERT INTO sabou.utilisateur (telephone, prenom, nom, role_code, statut, keycloak_id)
      VALUES ('${phone}', 'Essai', 'Terrain', 'praticien', 'actif', gen_random_uuid()) RETURNING id),
    p AS (
      INSERT INTO sabou.praticien (utilisateur_id, specialite_id, prefecture_id, langue_principale, annees_experience)
      SELECT u.id, 1, (SELECT id FROM sabou.prefecture WHERE nom = '${prefecture}'), 'pul', 5 FROM u RETURNING id),
    d AS (
      INSERT INTO sabou.dossier_certification (praticien_id, etape_courante)
      SELECT id, 2 FROM p RETURNING id, code),
    ${visitRows}
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
  await expect(page.getByRole('heading', { level: 1, name: 'Vérification terrain' })).toBeVisible();
  const card = (code: string) =>
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: new RegExp(`^${code} `) }) });
  await expect(card(visited)).toBeVisible();
  // Le dossier de Kankan n'apparaît pas dans la liste de Labé
  await expect(card(elsewhere)).toHaveCount(0);
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
