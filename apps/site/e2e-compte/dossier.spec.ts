// Critères d'acceptation de US-040 (partie API : US-040a), de bout en bout : API, Keycloak
// (domaine « sabou-public »), Valkey, PostgreSQL et stockage S3 (SeaweedFS) réels. Le
// praticien s'inscrit, se connecte par la page de Keycloak, puis agit par le relais /api
// du site, comme le fera l'application mobile (US-040b) avec son propre jeton.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { lastSms, newPhone, psql, signUpThroughApi, SITE } from './helpers';

const PASSWORD = '40718293';
const root = join(import.meta.dirname, '..', '..', '..');

// Petits fichiers réels : en-tête JPEG et document PDF minimal
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

async function signInAsPractitioner(page: Page): Promise<string> {
  const phone = newPhone();
  await signUpThroughApi(phone, 'Mariama', PASSWORD, { profile: 'praticien', lastName: 'Soumah' });
  await page.goto('/connexion');
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.getByLabel('Numéro de téléphone').fill(phone);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Connexion' }).click();
  await expect(page.getByText('Bonjour Mariama Soumah.')).toBeVisible();
  return phone;
}

// Requêtes du praticien connecté (cookie de session du navigateur), depuis l'origine du site
const api = (request: APIRequestContext) => ({
  saveProfile: () =>
    request.put('/api/praticien/fiche', {
      headers: { origin: SITE },
      data: { specialiteId: 1, prefectureId: 4, languePrincipale: 'pul', anneesExperience: 12 },
    }),
  upload: (type: string, body: Buffer, contentType: string) =>
    request.post(`/api/praticien/dossier/pieces/${type}`, {
      headers: { origin: SITE, 'content-type': contentType },
      data: body,
    }),
  submit: () => request.post('/api/praticien/dossier/soumission', { headers: { origin: SITE } }),
});

// Objet présent dans le seau des pièces (lu par le filer de SeaweedFS, dans son conteneur)
function storedObject(key: string): boolean {
  if (!/^pieces\/[0-9a-f-]{36}\.(jpg|png|pdf)$/.test(key)) throw new Error(`Clé invalide : ${key}`);
  try {
    execFileSync(
      'docker',
      [
        'compose',
        '--file',
        'infra/local/compose.yaml',
        '--env-file',
        '.env',
        'exec',
        '-T',
        'seaweedfs',
        'wget',
        '-q',
        '--spider',
        `http://127.0.0.1:8888/buckets/sabou-pieces/${key}`,
      ],
      { cwd: root, stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

test('critères 1 et 2 : soumission bloquée sans photo, puis dossier complet à l’étape 2 avec accusé', async ({
  page,
}) => {
  const phone = await signInAsPractitioner(page);
  const praticien = api(page.request);

  expect((await praticien.saveProfile()).status()).toBe(204);
  const dossier = await (await page.request.get('/api/praticien/dossier')).json();
  expect(dossier).toMatchObject({
    praticien: { statut: 'en_attente', prefectureId: 4 },
    dossier: { etape: 1, piecesManquantes: ['identite', 'photo'] },
  });

  expect((await praticien.upload('identite', PDF, 'application/pdf')).status()).toBe(201);

  // Critère 2 : la photo manque
  const blocked = await praticien.submit();
  expect(blocked.status()).toBe(422);
  expect(await blocked.json()).toMatchObject({
    error: 'missing_pieces',
    piecesManquantes: ['photo'],
  });

  // Un fichier qui n'est pas une image est refusé, même annoncé comme JPEG
  expect((await praticien.upload('photo', Buffer.from('<svg/>'), 'image/jpeg')).status()).toBe(415);
  expect((await praticien.upload('photo', JPEG, 'image/jpeg')).status()).toBe(201);

  // Critère 1 : étape 2 et accusé de réception, à l'écran et par SMS
  const submitted = await praticien.submit();
  expect(submitted.status()).toBe(200);
  const receipt = (await submitted.json()) as { code: string; etape: number };
  expect(receipt).toMatchObject({ code: expect.stringMatching(/^DS-\d+$/), etape: 2 });
  await expect
    .poll(() => lastSms(phone), { timeout: 15_000, intervals: [500] })
    .toContain(`votre dossier ${receipt.code} est bien enregistré`);

  // Ce que la base et le stockage gardent réellement
  expect(
    psql(`SELECT etape_courante FROM sabou.dossier_certification WHERE code = '${receipt.code}'`),
  ).toBe('2');
  const keys = psql(
    `SELECT string_agg(p.fichier_url, ' ' ORDER BY p.id) FROM sabou.dossier_piece p
       JOIN sabou.dossier_certification d ON d.id = p.dossier_id WHERE d.code = '${receipt.code}'`,
  ).split(' ');
  expect(keys).toHaveLength(2);
  for (const key of keys) expect(storedObject(key)).toBe(true);

  // Dossier en cours d'examen : plus de dépôt ni de changement de préfecture
  expect((await praticien.upload('justificatif', PDF, 'application/pdf')).status()).toBe(409);
  expect((await praticien.saveProfile()).status()).toBe(409);
});

test('critère 3 : moins de 12 mois après un rejet définitif, un nouveau dossier est refusé', async ({
  page,
}) => {
  const phone = await signInAsPractitioner(page);
  const praticien = api(page.request);
  expect((await praticien.saveProfile()).status()).toBe(204);

  // Rejet définitif prononcé par la DG (compte du jeu d'exemple), il y a un mois
  psql(`BEGIN; SET LOCAL search_path = sabou, public;
    SELECT sabou.contexte_ouvrir(md5('sabou:dg@sabou-sante.gn')::uuid);
    SELECT sabou.dossier_transition(d.id, 'rejet_definitif', 1, 'Fraude documentaire')
      FROM sabou.dossier_certification d JOIN sabou.praticien p ON p.id = d.praticien_id
      JOIN sabou.utilisateur u ON u.id = p.utilisateur_id WHERE u.telephone = '+224${phone}';
    UPDATE sabou.dossier_certification d SET cloture_le = now() - interval '1 month'
      FROM sabou.praticien p JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
     WHERE d.praticien_id = p.id AND u.telephone = '+224${phone}';
    COMMIT;`);

  const refused = await praticien.saveProfile();
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toMatchObject({ error: 'rejection_delay' });
});
