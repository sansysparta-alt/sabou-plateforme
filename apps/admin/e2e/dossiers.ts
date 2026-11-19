// Dossiers de test créés directement en base, à une étape donnée du workflow (US-042 à
// US-044), avec leur visite terrain (US-041).
import { randomInt } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { psql } from './audit';
import { APP } from './keycloak';

// Les files de dossiers sont paginées (US-019b) et la base locale garde les dossiers des essais
// précédents : chaque essai donne à ses praticiens un nom qui lui est propre, et ne garde à
// l'écran que ses dossiers en le cherchant dans la file.
export const RUN = String(randomInt(100_000, 1_000_000));

export async function showRunDossiers(page: Page) {
  // L'ossature pré-générée (US-017b) est remplacée par la page à son chargement : une saisie
  // faite trop tôt est perdue. On ressaisit jusqu'à ce que la valeur tienne.
  const search = page.getByRole('searchbox', { name: 'Rechercher un dossier' });
  await expect(async () => {
    await search.fill(RUN);
    await page.waitForTimeout(500);
    await expect(search).toHaveValue(RUN, { timeout: 100 });
  }).toPass({ timeout: 15_000 });
}

const PREFECTURES = ['Koubia', 'Labé', 'Kankan'] as const;

// Praticien neuf de la préfecture donnée et son dossier à l'étape donnée (3 à 5), visite
// réalisée avec compte rendu signé. Renvoie le code du dossier.
export function dossierAtStep(
  step: 3 | 4 | 5,
  prefecture: (typeof PREFECTURES)[number],
  author: string,
): string {
  // Seuls un identifiant Keycloak vérifié, une préfecture et une étape de la liste et un
  // numéro tiré au hasard (plage 666…, sans abonné réel) entrent dans la requête
  if (!/^[0-9a-f-]{36}$/.test(author)) throw new Error(`Compte invalide : ${author}`);
  if (!PREFECTURES.includes(prefecture) || ![3, 4, 5].includes(step)) {
    throw new Error(`Dossier de test invalide : ${prefecture}, étape ${step}`);
  }
  const phone = `+224666${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  const authorId = `(SELECT id FROM sabou.utilisateur WHERE keycloak_id = '${author}')`;
  const output = psql(`SET search_path = sabou, public;
    WITH u AS (
      INSERT INTO sabou.utilisateur (telephone, prenom, nom, role_code, statut, keycloak_id)
      VALUES ('${phone}', 'Essai', 'Workflow ${RUN}', 'praticien', 'actif', gen_random_uuid()) RETURNING id),
    p AS (
      INSERT INTO sabou.praticien (utilisateur_id, specialite_id, prefecture_id, langue_principale, annees_experience)
      SELECT u.id, 1, (SELECT id FROM sabou.prefecture WHERE nom = '${prefecture}'), 'pul', 5 FROM u RETURNING id),
    d AS (
      INSERT INTO sabou.dossier_certification (praticien_id, etape_courante)
      SELECT id, ${step} FROM p RETURNING id, code),
    v AS (
      INSERT INTO sabou.visite_terrain (dossier_id, admin_id, prevue_le, realisee_le, statut,
                                        constats, avis, empreinte_sha3, signe_par, signe_le)
      SELECT id, ${authorId}, now() - interval '2 days', now() - interval '1 day', 'realisee',
             'Lieu conforme.', 'favorable', repeat('b', 64), ${authorId}, now() - interval '1 day' FROM d)
    SELECT code FROM d;`);
  const code = output.trim().split('\n').at(-1)!.trim();
  expect(code).toMatch(/^DS-\d+$/);
  return code;
}

// Praticien neuf et son dossier à l'étape 2, dans la préfecture donnée, avec une visite de
// l'admin préfectoral indiqué : réalisée avec compte rendu signé, seulement planifiée, ou
// aucune. Renvoie le code du dossier.
export function dossierAtStep2(
  prefecture: 'Labé' | 'Kankan',
  admin: string,
  visit: 'realisee' | 'planifiee' | 'aucune',
): string {
  // Seuls un identifiant Keycloak vérifié et un numéro tiré au hasard (plage 666…, sans
  // abonné réel) entrent dans la requête
  if (!/^[0-9a-f-]{36}$/.test(admin)) throw new Error(`Compte invalide : ${admin}`);
  if (!['Labé', 'Kankan'].includes(prefecture)) throw new Error(`Préfecture : ${prefecture}`);
  const phone = `+224666${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  const adminId = `(SELECT id FROM sabou.utilisateur WHERE keycloak_id = '${admin}')`;
  const visitRows = {
    realisee: `,
      v AS (
        INSERT INTO sabou.visite_terrain (dossier_id, admin_id, prevue_le, realisee_le, statut,
                                          constats, avis, empreinte_sha3, signe_par, signe_le)
        SELECT id, ${adminId}, now() - interval '1 day', now(), 'realisee',
               'Lieu conforme.', 'favorable', repeat('b', 64), ${adminId}, now() FROM d)`,
    planifiee: `,
      v AS (
        INSERT INTO sabou.visite_terrain (dossier_id, admin_id, prevue_le, statut)
        SELECT id, ${adminId}, now() + interval '2 days', 'planifiee' FROM d)`,
    aucune: '',
  }[visit];
  const output = psql(`SET search_path = sabou, public;
    WITH u AS (
      INSERT INTO sabou.utilisateur (telephone, prenom, nom, role_code, statut, keycloak_id)
      VALUES ('${phone}', 'Essai', 'Terrain ${RUN}', 'praticien', 'actif', gen_random_uuid()) RETURNING id),
    p AS (
      INSERT INTO sabou.praticien (utilisateur_id, specialite_id, prefecture_id, langue_principale, annees_experience)
      SELECT u.id, 1, (SELECT id FROM sabou.prefecture WHERE nom = '${prefecture}'), 'pul', 5 FROM u RETURNING id),
    d AS (
      INSERT INTO sabou.dossier_certification (praticien_id, etape_courante)
      SELECT id, 2 FROM p RETURNING id, code)${visitRows}
    SELECT code FROM d;`);
  const code = output.trim().split('\n').at(-1)!.trim();
  expect(code).toMatch(/^DS-\d+$/);
  return code;
}

export const stepOf = (code: string) =>
  Number(
    psql(`SELECT etape_courante FROM sabou.dossier_certification WHERE code = '${code}'`).trim(),
  );

export const decide = (page: Page, code: string, body: unknown) =>
  page.request.post(`${APP}/api/dossiers/${code}/decision`, {
    headers: { origin: APP },
    data: body,
  });

// US-047 : praticien neuf de Kankan, déjà certifié, sans dossier en cours (dossier approuvé,
// certificat actif factice : seule sa révocation est vérifiée ici, sa signature l'est par
// approbation.spec.ts). Renvoie les codes du praticien et du certificat.
export function certifiedPractitioner(): { praticien: string; certificat: string } {
  const phone = `+224666${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  const suffix = String(randomInt(0, 1_000)).padStart(3, '0').replace(/[01]/g, 'K');
  const output = psql(`SET search_path = sabou, public;
    WITH u AS (
      INSERT INTO sabou.utilisateur (telephone, prenom, nom, role_code, statut, keycloak_id)
      VALUES ('${phone}', 'Essai', 'Certifié', 'praticien', 'actif', gen_random_uuid()) RETURNING id),
    p AS (
      INSERT INTO sabou.praticien (utilisateur_id, specialite_id, prefecture_id, langue_principale,
                                   annees_experience, statut)
      SELECT u.id, 1, (SELECT id FROM sabou.prefecture WHERE nom = 'Kankan'), 'mal', 8, 'certifie'
        FROM u RETURNING id, code),
    d AS (
      INSERT INTO sabou.dossier_certification (praticien_id, etape_courante, statut, cloture_le)
      SELECT id, 6, 'approuve', now() FROM p RETURNING id, praticien_id),
    c AS (
      INSERT INTO sabou.certificat (numero, praticien_id, dossier_id, emis_par, emis_le, expire_le,
                                    empreinte_sha3, signature, cle_id)
      SELECT 'SAB-' || extract(year FROM current_date) || '-' || replace(p.code, '-', '') || '-${suffix}',
             p.id, d.id, (SELECT id FROM sabou.utilisateur WHERE role_code = 'dg' ORDER BY id LIMIT 1),
             current_date, current_date + 360, repeat('e', 64), 'ZmFjdGljZQ==',
             (SELECT id FROM sabou.cle_signature ORDER BY id LIMIT 1)
        FROM p JOIN d ON d.praticien_id = p.id RETURNING numero, praticien_id)
    SELECT p.code || ' ' || c.numero FROM p JOIN c ON c.praticien_id = p.id;`);
  const [praticien, certificat] = output.trim().split('\n').at(-1)!.trim().split(' ');
  expect(praticien).toMatch(/^PR-\d+$/);
  expect(certificat).toMatch(/^SAB-\d{4}-PR\d+-[A-Z2-9]{3}$/);
  return { praticien: praticien!, certificat: certificat! };
}
