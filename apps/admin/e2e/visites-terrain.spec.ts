// US-041 : l'admin préfectoral planifie une visite, le praticien reçoit son rappel, puis la
// visite est enregistrée avec son compte rendu signé, de bout en bout. Vrai Keycloak (second
// facteur), vraie API (faux fournisseur de SMS « journal », file relevée toutes les 5 s sur
// le poste local), vraie base.
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { psql } from './audit';
import { decide, dossierAtStep2, showRunDossiers, stepOf } from './dossiers';
import { administrator, expectAccessible, firstAdministratorLogin, openDossier } from './helpers';
import { APP } from './keycloak';

// Heure de Conakry (UTC) au format des champs datetime-local, dans h heures
const inHours = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000).toISOString().slice(0, 16);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);

test('US-041 : planifier, rappel la veille, compte rendu signé obligatoire, photo, puis validation', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await administrator('admin_prefectoral', { prefecture: 'Labé' });
  await firstAdministratorLogin(page, user);
  const code = dossierAtStep2('Labé', user.id, 'aucune');
  const visitRow = (columns: string) =>
    psql(`SELECT ${columns} FROM sabou.visite_terrain vt
            JOIN sabou.dossier_certification d ON d.id = vt.dossier_id
           WHERE d.code = '${code}' ORDER BY vt.id DESC LIMIT 1`).trim();

  await page.goto(APP);
  await page.getByRole('link', { name: 'Vérification terrain' }).click();
  await showRunDossiers(page);
  // Détail dans le panneau du dossier (05 §2.76)
  const card = page.getByRole('dialog', { name: new RegExp(`^${code} `) });
  await openDossier(page, code);
  await expect(card.getByText('Visite attendue')).toBeVisible();
  await expect(card.getByRole('button', { name: /^Valider/ })).toHaveCount(0);

  // Planifier : dans moins d'un jour, le rappel est dû aussitôt (la veille est passée)
  const when = inHours(3);
  await card.getByRole('button', { name: `Planifier la visite du dossier ${code}` }).click();
  await card.getByLabel('Date et heure de la visite').fill(when);
  await expectAccessible(page, 'planification d’une visite');
  await card.getByRole('button', { name: 'Enregistrer la date' }).click();
  await expect(page.getByRole('status').first()).toContainText(
    'Le praticien sera prévenu la veille.',
  );
  expect(
    visitRow(
      `vt.statut || ' ' || to_char(vt.prevue_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI')`,
    ),
  ).toBe(`planifiee ${when}`);

  // Critère 1 : le rappel part au praticien (mis en file puis envoyé par la relève des SMS)
  await expect
    .poll(
      () =>
        psql(`SELECT statut || ' ' || (parametres->>'prevueLe')
                FROM sabou.notification
               WHERE objet_id = '${code}' AND modele = 'visite.rappel'`).trim(),
      { timeout: 30_000 },
    )
    .toBe(`envoyee ${when}`);

  // Critère 2 : sans attestation (signature), l'écran et l'API refusent
  await page.reload();
  // Le rechargement vide la recherche : sans elle, le dossier peut tomber en page 2
  await showRunDossiers(page);
  await openDossier(page, code);
  await card.getByRole('button', { name: /^Enregistrer le compte rendu/ }).click();
  await card.getByLabel('Favorable', { exact: true }).check();
  await card.getByLabel('Constats').fill('Lieu d’exercice conforme ; plantes séchées à l’abri.');
  await card.getByRole('button', { name: 'Signer le compte rendu' }).click();
  await expect(card.getByText('Cochez l’attestation pour signer le compte rendu.')).toBeVisible();
  await expectAccessible(page, 'compte rendu de visite');
  const visitId = Number(visitRow('vt.id'));
  const today = new Date().toISOString().slice(0, 10);
  const unsigned = await page.request.post(`${APP}/api/dossiers/${code}/visite/compte-rendu`, {
    headers: { origin: APP },
    data: {
      visite: visitId,
      realiseeLe: today,
      avis: 'favorable',
      constats: 'RAS',
      attestation: false,
    },
  });
  expect(unsigned.status()).toBe(400);
  expect(visitRow('vt.statut')).toBe('planifiee');

  // Signé : la visite est réalisée, le texte figé avec son empreinte, son auteur, l'heure
  await card.getByLabel(/Je certifie avoir réalisé cette visite/).check();
  await card.getByRole('button', { name: 'Signer le compte rendu' }).click();
  await expect(page.getByRole('status').first()).toHaveText(
    'Compte rendu signé : la visite est enregistrée.',
  );
  await expect(card.getByText('Visite faite')).toBeVisible();
  const [statut, author, stored, fingerprint] = visitRow(
    `vt.statut || '|' || vt.signe_par || '|' || vt.constats || '|' || vt.empreinte_sha3`,
  ).split('|');
  expect(statut).toBe('realisee');
  // L'empreinte enregistrée est bien le SHA3-256 du texte signé, recalculé ici
  const canonical = [
    'SABOU compte rendu de visite v1',
    `dossier=${code}`,
    `visite=${visitId}`,
    `date=${today}`,
    'avis=favorable',
    `auteur=${author}`,
    'constats=',
    stored,
  ].join('\n');
  expect(fingerprint).toBe(createHash('sha3-256').update(canonical, 'utf8').digest('hex'));
  expect(
    psql(
      `SELECT action FROM sabou.journal_audit WHERE objet_id = '${code}' ORDER BY id DESC LIMIT 1`,
    ).trim(),
  ).toBe('visite.realisee');

  // Le compte rendu signé ne s'enregistre pas deux fois
  const again = await page.request.post(`${APP}/api/dossiers/${code}/visite/compte-rendu`, {
    headers: { origin: APP },
    data: {
      visite: visitId,
      realiseeLe: today,
      avis: 'defavorable',
      constats: 'Autre',
      attestation: true,
    },
  });
  expect(again.status()).toBe(409);

  // Photo facultative de la fiche papier
  // Dépôt en un geste : la photo choisie part aussitôt
  await card
    .getByLabel(/^Joindre la photo de la fiche papier/)
    .setInputFiles({ name: 'fiche.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await expect(card.getByText('Jointe')).toBeVisible();
  expect(visitRow('vt.compte_rendu_piece_id IS NOT NULL')).toBe('t');

  // La visite enregistrée rend la validation possible (US-042)
  await card.getByRole('button', { name: /^Valider/ }).click();
  await expect(card).toHaveCount(0);
  expect(stepOf(code)).toBe(3);
  expect((await decide(page, code, { etape: 2, decision: 'valide' })).status()).toBe(409);
});
