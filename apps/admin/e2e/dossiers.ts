// Dossiers de test créés directement en base, à une étape donnée du workflow (US-043,
// US-044) : la saisie des visites terrain arrive avec US-041.
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

export const stepOf = (code: string) =>
  Number(
    psql(`SELECT etape_courante FROM sabou.dossier_certification WHERE code = '${code}'`).trim(),
  );

export const decide = (page: Page, code: string, body: unknown) =>
  page.request.post(`${APP}/api/dossiers/${code}/decision`, {
    headers: { origin: APP },
    data: body,
  });
