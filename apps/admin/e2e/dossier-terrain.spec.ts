// US-040c : l'admin préfectoral crée le dossier d'un praticien sans smartphone, dépose ses
// pièces et le soumet ; le dossier entre dans le circuit habituel. De bout en bout : vrai
// Keycloak (second facteur de l'agent ; compte du praticien créé sans mot de passe dans le
// domaine public), vraie API, vraie base.
import { randomInt } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { psql } from './audit';
import { administrator, expectAccessible, firstAdministratorLogin } from './helpers';
import { APP } from './keycloak';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);

test('US-040c : dossier terrain créé, pièces déposées, soumis par l’agent, SMS et journal', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await administrator('admin_prefectoral', { prefecture: 'Labé' });
  await firstAdministratorLogin(page, user);
  const phone = `66${String(randomInt(0, 1e7)).padStart(7, '0')}`;

  await page.goto(APP);
  await page.getByRole('link', { name: 'Dossiers terrain' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dossiers terrain');
  await page.getByRole('button', { name: 'Nouveau dossier terrain' }).click();
  const form = page.getByRole('region', { name: 'Nouveau dossier terrain' });
  await expect(form.getByText(/préfecture de Labé/)).toBeVisible();

  // Erreurs sous les champs avant tout envoi
  await form.getByRole('button', { name: 'Créer le dossier' }).click();
  await expect(form.getByText('Indiquez votre prénom.')).toBeVisible();
  await expectAccessible(page, 'dossier terrain : erreurs de saisie');

  await form.getByLabel('Prénom').fill('Mamadou');
  await form.getByLabel('Nom', { exact: true }).fill('Barry');
  await form.getByLabel('Téléphone du praticien').fill(phone);
  await form.getByLabel('Spécialité').selectOption({ index: 1 });
  await form.getByLabel('Années d’expérience').fill('20');
  await form.getByLabel('Langue principale').selectOption({ index: 1 });
  await form.getByRole('button', { name: 'Créer le dossier' }).click();
  await expect(page.getByRole('status')).toContainText('créé pour Mamadou Barry');
  const code = /DS-\d+/.exec((await page.getByRole('status').textContent()) ?? '')?.[0];
  expect(code).toBeTruthy();

  // Critère 2 : créé par l'agent, journalisé ; SMS d'invitation au praticien en file
  expect(
    psql(`SELECT a.keycloak_id::text || ' ' || u.telephone || ' ' || u.role_code
            FROM sabou.dossier_certification d
            JOIN sabou.utilisateur a ON a.id = d.cree_par
            JOIN sabou.praticien p ON p.id = d.praticien_id
            JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
           WHERE d.code = '${code}'`).trim(),
  ).toBe(`${user.id} +224${phone} praticien`);
  expect(
    psql(`SELECT count(*) FROM sabou.notification
           WHERE objet_id = '${code}' AND modele = 'dossier.terrain_cree'`).trim(),
  ).toBe('1');
  expect(
    psql(`SELECT count(*) FROM sabou.journal_audit
           WHERE action = 'dossier.terrain_cree' AND objet_id = '${code}'
             AND compte = '${user.id}'`).trim(),
  ).toBe('1');

  // Pièces obligatoires, déposées par l'agent ; la soumission attend qu'elles y soient
  // Ligne du dossier, ouverte à sa création ; une ligne par pièce, dépôt en un geste
  const card = page
    .getByRole('heading', { level: 3, name: /Mamadou Barry/ })
    .locator('xpath=ancestor::li[1]');
  await expect(card.getByRole('button', { name: /Soumettre le dossier/ })).toBeDisabled();
  for (const [type, label] of [
    ['identite', 'Pièce d’identité'],
    ['photo', 'Photo du praticien'],
  ] as const) {
    await card
      .getByLabel(`Déposer la ${label.toLowerCase()}`)
      .setInputFiles({ name: `${type}.jpg`, mimeType: 'image/jpeg', buffer: JPEG });
    await expect(page.getByRole('status')).toContainText(`${label} ajoutée au dossier ${code}`);
  }
  await expectAccessible(page, 'dossier terrain : pièces');

  // Critère 1 : soumis par l'agent, le dossier entre dans le circuit (étape 2, sa préfecture)
  await card.getByRole('button', { name: /Soumettre le dossier/ }).click();
  await expect(page.getByRole('status')).toContainText(`Dossier ${code} soumis`);
  expect(
    psql(`SELECT d.etape_courante || ' ' || (SELECT count(*) FROM sabou.notification n
                                               WHERE n.objet_id = d.code AND n.modele = 'dossier.soumis')
            FROM sabou.dossier_certification d WHERE d.code = '${code}'`).trim(),
  ).toBe('2 1');
  await page.getByRole('link', { name: 'Vérification terrain' }).click();
  await page.getByRole('searchbox', { name: 'Rechercher un dossier' }).fill(code!);
  await expect(page.getByRole('heading', { name: new RegExp(`^${code} `) })).toBeVisible();
});
