// Critères d'acceptation de US-040 (partie API : US-040a), de bout en bout : API, Keycloak
// (domaine « sabou-public »), Valkey, PostgreSQL et stockage S3 (SeaweedFS) réels. Le
// praticien s'inscrit, se connecte comme l'application mobile (US-040b) et agit avec son
// jeton : depuis US-068, la session du site n'ouvre plus les routes du praticien.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  API,
  bearer,
  lastSms,
  newPhone,
  psql,
  signInLikeTheApp,
  signUpThroughApi,
} from './helpers';

const PASSWORD = '40718293';
const root = join(import.meta.dirname, '..', '..', '..');

// Petits fichiers réels : en-tête JPEG et document PDF minimal
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

// Praticien inscrit, connecté comme l'application mobile (jeton d'accès) : seule voie vers ses
// routes depuis US-068 ; le site ne lui ouvre que les fonctions du citoyen
async function signInAsPractitioner(page: Page): Promise<{ phone: string; token: string }> {
  const phone = newPhone();
  await signUpThroughApi(phone, 'Mariama', PASSWORD, { profile: 'praticien', lastName: 'Soumah' });
  const { access_token: token } = await signInLikeTheApp(page, phone, PASSWORD);
  return { phone, token };
}

// Requêtes du praticien avec le jeton de l'application, directement à l'API
const api = (token: string) => {
  const call = (method: string, path: string, body?: BodyInit, type?: string) =>
    fetch(
      `${API}/api/praticien/${path}`,
      bearer(token, { method, body, headers: type ? { 'content-type': type } : {} }),
    );
  return {
    view: () => call('GET', 'dossier'),
    saveProfile: () =>
      call(
        'PUT',
        'fiche',
        JSON.stringify({
          specialiteId: 1,
          prefectureId: 4,
          languePrincipale: 'pul',
          anneesExperience: 12,
        }),
        'application/json',
      ),
    upload: (type: string, body: Buffer, contentType: string) =>
      call('POST', `dossier/pieces/${type}`, new Uint8Array(body), contentType),
    submit: () => call('POST', 'dossier/soumission'),
  };
};

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
  const { phone, token } = await signInAsPractitioner(page);
  const praticien = api(token);

  expect((await praticien.saveProfile()).status).toBe(204);
  const dossier = await (await praticien.view()).json();
  expect(dossier).toMatchObject({
    praticien: { statut: 'en_attente', prefectureId: 4 },
    dossier: { etape: 1, piecesManquantes: ['identite', 'photo'] },
  });

  expect((await praticien.upload('identite', PDF, 'application/pdf')).status).toBe(201);

  // Critère 2 : la photo manque
  const blocked = await praticien.submit();
  expect(blocked.status).toBe(422);
  expect(await blocked.json()).toMatchObject({
    error: 'missing_pieces',
    piecesManquantes: ['photo'],
  });

  // Un fichier qui n'est pas une image est refusé, même annoncé comme JPEG
  expect((await praticien.upload('photo', Buffer.from('<svg/>'), 'image/jpeg')).status).toBe(415);
  expect((await praticien.upload('photo', JPEG, 'image/jpeg')).status).toBe(201);

  // Critère 1 : étape 2 et accusé de réception, à l'écran et par SMS
  const submitted = await praticien.submit();
  expect(submitted.status).toBe(200);
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
  expect((await praticien.upload('justificatif', PDF, 'application/pdf')).status).toBe(409);
  expect((await praticien.saveProfile()).status).toBe(409);
});

test('critère 3 : moins de 12 mois après un rejet définitif, un nouveau dossier est refusé', async ({
  page,
}) => {
  const { phone, token } = await signInAsPractitioner(page);
  const praticien = api(token);
  expect((await praticien.saveProfile()).status).toBe(204);

  // Rejet définitif prononcé par la DG (compte du jeu d'exemple) par praticien_rejeter, seule
  // voie depuis US-047, puis reporté d'un mois en arrière (décision, recours et dossier)
  psql(`BEGIN; SET LOCAL search_path = sabou, public;
    SELECT sabou.contexte_ouvrir(md5('sabou:dg@sabou-sante.gn')::uuid);
    SELECT sabou.praticien_rejeter(p.id, sabou.contexte_utilisateur(), 'fraude_documentaire',
                                   'Pièce d''identité falsifiée.')
      FROM sabou.praticien p JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
     WHERE u.telephone = '+224${phone}';
    UPDATE sabou.rejet_definitif r
       SET decide_le = r.decide_le - interval '1 month',
           recours_jusquau = ((r.decide_le - interval '1 month') AT TIME ZONE 'Africa/Conakry')::date + 30
      FROM sabou.praticien p JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
     WHERE r.praticien_id = p.id AND u.telephone = '+224${phone}';
    UPDATE sabou.dossier_certification d SET cloture_le = now() - interval '1 month'
      FROM sabou.praticien p JOIN sabou.utilisateur u ON u.id = p.utilisateur_id
     WHERE d.praticien_id = p.id AND u.telephone = '+224${phone}';
    COMMIT;`);

  const refused = await praticien.saveProfile();
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ error: 'rejection_delay' });
});

// US-068, critère 3 : un praticien connecté au site n'y a que les fonctions du citoyen ; la
// session du site n'ouvre plus ses routes, même par le relais /api du site
test('US-068 : connecté au site, le praticien n’a ni Studio ni accès à ses routes', async ({
  page,
}) => {
  const phone = newPhone();
  await signUpThroughApi(phone, 'Mariama', PASSWORD, { profile: 'praticien', lastName: 'Soumah' });
  await page.goto('/connexion');
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.getByLabel('Numéro de téléphone').fill(phone);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Connexion' }).click();
  await expect(page.getByText('Bonjour Mariama Soumah.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Studio/ })).toHaveCount(0);

  expect((await page.request.get('/api/praticien/dossier')).status()).toBe(401);
  expect((await page.request.get('/api/praticien/traitements')).status()).toBe(401);
  expect((await page.goto('/studio'))?.status()).toBe(404);
});
