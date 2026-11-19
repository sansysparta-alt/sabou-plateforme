// US-040d : l'admin régional désigne l'agent qui vérifie un dossier terrain (la préfecture
// n'a qu'un agent, l'auteur, qui ne vérifie pas lui-même). De bout en bout : vrai Keycloak
// (second facteur), vraie API, vraie base. Le dossier terrain est préparé en base, dans le
// contexte de son auteur (la création elle-même est couverte par dossier-terrain.spec.ts).
import { randomInt, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { psql } from './audit';
import { administrator, expectAccessible, firstAdministratorLogin } from './helpers';
import { APP } from './keycloak';

test('US-040d : désignation par le régional, journalisée ; l’agent désigné voit et vérifie le dossier', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  // Autre préfecture de la région de Labé, choisie en base
  const neighbour = psql(`SELECT nom FROM sabou.prefecture
                           WHERE region_admin_id = (SELECT id FROM sabou.region_admin WHERE nom = 'Labé')
                             AND nom <> 'Labé' ORDER BY id LIMIT 1`).trim();
  const author = await administrator('admin_prefectoral', { prefecture: 'Labé' });
  const verifier = await administrator('admin_prefectoral', { prefecture: neighbour });
  const regional = await administrator('admin_regional', { region: 'Labé' });
  const verifierId = psql(
    `SELECT id FROM sabou.utilisateur WHERE keycloak_id = '${verifier.id}'`,
  ).trim();

  // Dossier terrain soumis par son auteur : il attend la vérification de l'étape 2
  const phone = `+22466${String(randomInt(0, 1e7)).padStart(7, '0')}`;
  const praticienKc = randomUUID();
  const code = psql(`SET search_path = sabou, public;
    SELECT contexte_ouvrir('${author.id}');
    CREATE TEMP TABLE d AS SELECT * FROM dossier_terrain_ouvrir('${praticienKc}', '${phone}',
      'Saliou', 'Diallo', 1::smallint, NULL::smallint, 'pul', 15::smallint);
    INSERT INTO dossier_piece (dossier_id, type, fichier_url, sha256, depose_par, type_mime, taille_octets)
    SELECT dossier_id, t, 'pieces/e2e/' || t, repeat('a', 64), contexte_utilisateur(), 'image/jpeg', 1000
      FROM d, unnest(ARRAY['identite', 'photo']) AS t;
    SELECT dossier_transition((SELECT dossier_id FROM d), 'soumis', contexte_utilisateur());
    SELECT dossier_code FROM d;`)
    .trim()
    .split('\n')
    .pop()!
    .trim();
  expect(code).toMatch(/^DS-\d+$/);

  // Critère 1 : le régional désigne l'agent de la préfecture voisine
  await firstAdministratorLogin(page, regional);
  await page.goto(APP);
  await page.getByRole('link', { name: 'Agents de vérification' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Agents de vérification');
  // Ligne repliable du dossier, ouverte pour la désignation
  const title = page.getByRole('heading', { level: 3, name: new RegExp(code) });
  await title.click();
  const card = title.locator('xpath=ancestor::li[1]');
  await expect(card.getByText('Un agent de la préfecture, autre que l’auteur')).toBeVisible();
  // L'auteur n'est pas proposé
  const select = card.getByLabel('Désigner un agent');
  await expect(select.locator(`option[value="${verifierId}"]`)).toHaveCount(1);
  const authorId = psql(
    `SELECT id FROM sabou.utilisateur WHERE keycloak_id = '${author.id}'`,
  ).trim();
  await expect(select.locator(`option[value="${authorId}"]`)).toHaveCount(0);
  await expectAccessible(page, 'agents de vérification');
  await select.selectOption(verifierId);
  await card.getByRole('button', { name: 'Désigner' }).click();
  await expect(page.getByRole('status')).toContainText('est désigné pour la vérification');
  await expect(card.getByText('Désigné')).toBeVisible();
  expect(
    psql(`SELECT d.verificateur_designe || ' ' || count(a.id)
            FROM sabou.dossier_certification d
            JOIN sabou.journal_audit a ON a.objet_id = d.code AND a.action = 'dossier.verificateur_designe'
           WHERE d.code = '${code}' GROUP BY d.verificateur_designe`).trim(),
  ).toBe(`${verifierId} 1`);

  // Critère 2 : l'agent désigné voit le dossier dans sa file de vérification terrain
  const context = await browser.newContext();
  const verifierPage = await context.newPage();
  await firstAdministratorLogin(verifierPage, verifier);
  await verifierPage.goto(APP);
  await verifierPage.getByRole('link', { name: 'Vérification terrain' }).click();
  await verifierPage.getByLabel('Rechercher un dossier').fill('Saliou Diallo');
  await expect(
    verifierPage.getByRole('heading', { level: 3, name: new RegExp(code) }),
  ).toBeVisible();
  await context.close();
});
