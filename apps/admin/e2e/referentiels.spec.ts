// Critères d'acceptation du lot C (US-020, US-021), de bout en bout : application de gestion
// (compilée), API, Keycloak et PostgreSQL réels, écran vérifié par axe (WCAG 2.2 AA).
// Les refus tenus par la base (voix en anglais, langue nationale écrite…) sont prouvés par
// packages/db/test/referentiels.test.ts.
import { randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { administrator, expectAccessible, firstAdministratorLogin } from './helpers';
import { APP } from './keycloak';

test.setTimeout(240_000);

// Code de langue libre : la base de bout en bout garde les langues des passages précédents
async function freeLanguageCode(page: Page): Promise<string> {
  const taken = await page.getByRole('region', { name: 'Langues' }).textContent();
  for (;;) {
    const code = Array.from({ length: 3 }, () => String.fromCharCode(97 + randomInt(26))).join('');
    if (!taken?.includes(`(${code})`)) return code;
  }
}

// Tableau des langues paginé par 10 (US-019b) : avance jusqu'à la page de la langue cherchée
async function languagesPageOf(page: Page, code: string): Promise<void> {
  const table = page.getByRole('table', { name: 'Langues' });
  // Tableau chargé d'abord (le français est toujours en première page)
  await expect(table.getByRole('rowheader', { name: /^Français/ })).toBeVisible();
  const row = table.getByRole('row').filter({ hasText: `(${code})` });
  const pages = page.getByRole('navigation', { name: 'Pages : Langues' });
  for (let turn = 0; turn < 50 && !(await row.isVisible()); turn += 1) {
    const next = pages.getByRole('button', { name: /^Suiv/ });
    if (!(await next.isVisible()) || (await next.isDisabled())) break;
    await next.click();
  }
}

test('la DG paramètre langues, territoires et spécialités sans modifier le code', async ({
  page,
}) => {
  // Compte DG complet (Keycloak et ligne utilisateur) : le redécoupage vérifie l'acteur en base
  const dg = await administrator('dg', { national: true });
  await firstAdministratorLogin(page, dg);
  await page.getByRole('link', { name: 'Gérer les référentiels' }).click();
  await expect(page).toHaveURL(`${APP}/referentiels`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Référentiels');
  await expectAccessible(page, 'Référentiels');

  // US-020 : l'anglais n'a pas de voix ; Conakry est en Basse Guinée, soussou par défaut
  // Un onglet par référentiel, un tableau par onglet (US-019)
  const tab = (name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
  const languages = page.getByRole('table', { name: 'Langues' });
  const english = languages.getByRole('row').filter({ hasText: 'Anglais' });
  await expect(english.getByRole('cell').nth(1)).toHaveText('texte');
  await tab('Territoires');
  const conakry = page
    .getByRole('table', { name: 'Territoires' })
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: 'Conakry', exact: true }) });
  await expect(conakry).toContainText('Basse Guinée');
  await expect(conakry).toContainText('Soussou');
  await tab('Langues');

  // US-020 : une langue nationale ajoutée, inactive, puis activée…
  const code = await freeLanguageCode(page);
  const languagesCount = page.getByRole('tab', { name: /^Langues/ }).locator('.ui-tabs__count');
  const before = Number(await languagesCount.textContent());
  const name = `Langue ${code}`;
  await page.getByRole('button', { name: 'Ajouter une langue' }).click();
  const form = page.getByRole('form', { name: 'Ajouter une langue' });
  await form.getByLabel('Nom en français').fill(name);
  await form.getByLabel('Code', { exact: true }).fill(code);
  await expect(form.getByLabel('Texte')).toBeDisabled();
  await form.getByRole('button', { name: 'Ajouter la langue' }).click();
  await expect(page.getByRole('status')).toHaveText(`Langue ${name} ajoutée, inactive.`);
  // Liste relue après l'ajout (le message paraît avant) : une langue de plus
  await expect(languagesCount).toHaveText(String(before + 1));
  const added = languages.getByRole('row').filter({ hasText: `(${code})` });
  // Tableau paginé par 10 (US-019b) et langues des essais précédents gardées en base : la
  // langue ajoutée peut être sur une page suivante
  await languagesPageOf(page, code);
  await expect(added).toContainText('Inactive');
  await added.getByRole('button', { name: `Activer la langue ${name}` }).click();
  await expect(added).toContainText('Active');

  // … est aussitôt proposée dans la gestion des comptes, comme langue de travail
  await page.goto(`${APP}/comptes`);
  await page.getByRole('button', { name: 'Inviter un compte' }).click();
  const invite = page.getByRole('region', { name: 'Inviter un compte' });
  await expect(invite.getByRole('rowheader', { name, exact: true })).toBeVisible();

  // … puis désactivée : la base de bout en bout reste dans son état (cinq langues de voix du
  // cahier des charges), et une langue inactive n'est plus proposée
  await page.goto(`${APP}/referentiels#langues`);
  await languagesPageOf(page, code);
  const again = languages.getByRole('row').filter({ hasText: `(${code})` });
  await again.getByRole('button', { name: `Désactiver la langue ${name}` }).click();
  await expect(again).toContainText('Inactive');
  await page.goto(`${APP}/comptes`);
  await page.getByRole('button', { name: 'Inviter un compte' }).click();
  await expect(invite.getByRole('rowheader', { name, exact: true })).toHaveCount(0);

  // US-021 : les 8 spécialités, en français et en anglais
  await page.goto(`${APP}/referentiels#specialites`);
  const specialties = page.getByRole('table', { name: 'Spécialités' }).getByRole('row');
  for (const [fr, en] of [
    ['Phytothérapie', 'Herbal medicine'],
    ['Pédiatrie', 'Paediatrics'],
    ['Os et fractures', 'Bones and fractures'],
    ['Nutrition', 'Nutrition'],
    ['Gynécologie et santé maternelle', 'Gynaecology and maternal health'],
    ['Santé mentale', 'Mental health'],
    ['Maladies de la peau', 'Skin diseases'],
    ['Morsures et envenimations', 'Bites and envenomations'],
  ]) {
    const item = specialties.filter({
      has: page.getByRole('rowheader', { name: fr, exact: true }),
    });
    await expect(item).toContainText(en);
  }

  // Ajout d'un territoire : la sous-préfecture apparaît sous sa préfecture
  await tab('Territoires');
  await page.getByRole('button', { name: 'Ajouter un territoire' }).click();
  const territory = page.getByRole('form', { name: 'Ajouter un territoire' });
  const subPrefecture = `Essai ${code}`;
  await territory.getByLabel('Préfecture').selectOption({ label: 'Labé' });
  await territory.getByLabel('Nom').fill(subPrefecture);
  await territory.getByRole('button', { name: 'Ajouter le territoire' }).click();
  await expect(
    page
      .getByRole('table', { name: 'Territoires' })
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: 'Labé', exact: true }) }),
  ).toContainText(subPrefecture);

  // Renommage : l'ancien nom disparaît, le nouveau apparaît
  await page.getByRole('button', { name: 'Renommer un territoire' }).click();
  const rename = page.getByRole('form', { name: 'Renommer un territoire' });
  await rename.getByLabel('Niveau').selectOption({ label: 'Sous-préfecture' });
  await rename.getByLabel('Sous-préfecture à renommer').selectOption({ label: subPrefecture });
  await rename.getByLabel('Nouveau nom').fill(`${subPrefecture} bis`);
  await rename.getByRole('button', { name: 'Renommer' }).click();
  await expect(page.getByRole('status')).toHaveText(`Territoire renommé en ${subPrefecture} bis.`);

  // US-022 : découpage, la sous-préfecture passe de Labé à Mamou après aperçu et confirmation
  await page.getByRole('button', { name: 'Redécouper' }).click();
  const redistrict = page.getByRole('form', { name: 'Redécouper' });
  await redistrict
    .getByLabel('Opération')
    .selectOption({ label: 'Rattacher une sous-préfecture à une autre préfecture' });
  await redistrict.getByLabel('Sous-préfecture').selectOption({ label: `${subPrefecture} bis` });
  await redistrict.getByLabel('Nouvelle préfecture').selectOption({ label: 'Mamou' });
  await redistrict.getByRole('button', { name: 'Voir ce qui bouge' }).click();
  const preview = redistrict.getByRole('region');
  await expect(preview).toContainText('Praticiens');
  await expect(preview).toContainText('perd ce territoire');
  await preview.getByRole('button', { name: 'Confirmer le redécoupage' }).click();
  await expect(page.getByRole('status')).toHaveText(
    `Sous-préfecture ${subPrefecture} bis rattachée à la préfecture Mamou.`,
  );
  await expect(
    page
      .getByRole('table', { name: 'Territoires' })
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: 'Mamou', exact: true }) }),
  ).toContainText(`${subPrefecture} bis`);

  // Spécialité désactivée puis réactivée (la base de bout en bout reste dans son état)
  await tab('Spécialités');
  const nutrition = specialties.filter({
    has: page.getByRole('rowheader', { name: 'Nutrition', exact: true }),
  });
  await nutrition.getByRole('button', { name: 'Désactiver la spécialité Nutrition' }).click();
  await expect(nutrition).toContainText('Inactive');
  await nutrition.getByRole('button', { name: 'Activer la spécialité Nutrition' }).click();
  await expect(nutrition).toContainText('Active');
});
