// Dossiers de test créés directement en base, à une étape donnée du workflow (US-042 à
// US-044), avec leur visite terrain (US-041).
import { randomInt } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { psql } from './audit';
import { APP } from './keycloak';

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
      VALUES ('${phone}', 'Essai', 'Workflow', 'praticien', 'actif', gen_random_uuid()) RETURNING id),
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
      VALUES ('${phone}', 'Essai', 'Terrain', 'praticien', 'actif', gen_random_uuid()) RETURNING id),
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
