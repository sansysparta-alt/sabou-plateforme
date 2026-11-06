// Lot B (US-011) : cloisonnement par zone de bout en bout. Vrai Keycloak (second facteur),
// vraie API, vraie base : l'appel direct à l'API ne renvoie que la zone du compte.
// Jeu d'exemple : PR-1041 et PR-1042 à Labé ; PR-1043 à Siguiri (région de Kankan).
import { expect, test, type Page } from '@playwright/test';
import { psql } from './audit';
import { firstAdministratorLogin } from './helpers';
import { APP, createUser, type TestUser } from './keycloak';

// Compte d'administration lié à un compte Keycloak neuf, avec sa zone en base
async function administrator(
  keycloakRole: 'admin_prefectoral' | 'admin_regional',
  zone: { prefecture: string } | { region: string },
): Promise<TestUser> {
  const user = await createUser(keycloakRole);
  // Identifiant Keycloak et nom de test contrôlés : rien d'autre n'entre dans la requête
  if (!/^[0-9a-f-]{36}$/.test(user.id) || !/^[a-z_]+-[0-9a-f]{8}$/.test(user.username)) {
    throw new Error(`Compte de test invalide : ${user.username}`);
  }
  const [role, region, prefecture] =
    'prefecture' in zone
      ? [
          'prefectoral',
          'NULL',
          `(SELECT id FROM sabou.prefecture WHERE nom = '${zone.prefecture}')`,
        ]
      : ['regional', `(SELECT id FROM sabou.region_admin WHERE nom = '${zone.region}')`, 'NULL'];
  // Schéma en tête du search_path, comme pour l'API : les déclencheurs en dépendent
  psql(`SET search_path = sabou, public;
        INSERT INTO sabou.utilisateur (email, prenom, nom, role_code, region_admin_id, prefecture_id,
          statut, keycloak_id)
        VALUES ('${user.username}@exemple.invalid', 'Essai', 'Zone', '${role}', ${region}, ${prefecture},
          'actif', '${user.id}')`);
  return user;
}

async function list<T>(page: Page, path: string): Promise<T[]> {
  const response = await page.request.get(`${APP}${path}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { elements: T[] }).elements;
}

test('US-011 : l’admin préfectoral de Labé ne voit que les praticiens de Labé, même par appel direct', async ({
  page,
}) => {
  const user = await administrator('admin_prefectoral', { prefecture: 'Labé' });
  await firstAdministratorLogin(page, user);

  const practitioners = await list<{ code: string; prefecture: string }>(page, '/api/praticiens');
  expect(practitioners.map((p) => p.code)).toEqual(expect.arrayContaining(['PR-1041', 'PR-1042']));
  expect(new Set(practitioners.map((p) => p.prefecture))).toEqual(new Set(['Labé']));

  // Une zone demandée dans la requête est refusée, pas appliquée
  expect((await page.request.get(`${APP}/api/praticiens?prefecture_id=9`)).status()).toBe(400);
  // Pages successives : toujours la seule zone de Labé
  const first = await page.request.get(`${APP}/api/praticiens?limite=1`);
  const { suivant } = (await first.json()) as { suivant: string };
  const next = await list<{ prefecture: string }>(
    page,
    `/api/praticiens?limite=100&apres=${suivant}`,
  );
  expect(new Set(next.map((p) => p.prefecture))).toEqual(new Set(['Labé']));
});

test('US-011 : l’admin régional de Kankan ne voit que les dossiers des préfectures de sa région', async ({
  page,
}) => {
  const user = await administrator('admin_regional', { region: 'Kankan' });
  await firstAdministratorLogin(page, user);

  const dossiers = await list<{ code: string; prefecture: string }>(page, '/api/dossiers');
  expect(dossiers.map((d) => d.code)).toContain('DS-1043');
  for (const dossier of dossiers) expect(['Kankan', 'Siguiri']).toContain(dossier.prefecture);
});
