// US-040b (§2.29), de bout en bout côté serveur : le parcours de connexion de l'application
// mobile (code + PKCE par la page de Keycloak, client public « sabou-mobile »), puis le dossier
// rempli et soumis avec le jeton d'accès, sans cookie ni origine. Keycloak, API, Valkey,
// PostgreSQL et SeaweedFS réels. Les écrans Flutter sont prouvés par apps/mobile/test.
import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { API, newPhone, signUpThroughApi } from './helpers';

const PASSWORD = '40718293';
const KEYCLOAK = `http://localhost:${process.env.KEYCLOAK_PORT ?? 8080}/realms/sabou-public`;
const OIDC = `${KEYCLOAK}/protocol/openid-connect`;
const CLIENT_ID = 'sabou-mobile';
const REDIRECT_URI = 'gn.sabou.mobile:/oauth2redirect';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

interface Tokens {
  access_token: string;
  refresh_token: string;
  refresh_expires_in: number;
  scope: string;
}

const claims = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;

// Ce que fait l'application (flutter_appauth) : page de Keycloak dans le navigateur, retour
// vers le schéma de l'application avec le code, échange du code avec le vérificateur PKCE
async function signInLikeTheApp(page: Page, phone: string): Promise<Tokens> {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const authorize = new URL(`${OIDC}/auth`);
  authorize.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'openid offline_access',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'login',
  }).toString();
  await page.goto(authorize.href);
  await page.getByLabel('Numéro de téléphone').fill(phone);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  // Le navigateur ne sait pas ouvrir « gn.sabou.mobile: » : on lit la redirection elle-même
  const [redirect] = await Promise.all([
    page.waitForResponse((r) => r.headers()['location']?.startsWith(REDIRECT_URI) ?? false),
    page.getByRole('button', { name: 'Connexion' }).click(),
  ]);
  const back = new URL(redirect.headers()['location']!);
  expect(back.searchParams.get('state')).toBe(state);

  const exchange = await fetch(`${OIDC}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: back.searchParams.get('code')!,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  expect(exchange.status).toBe(200);
  return (await exchange.json()) as Tokens;
}

const bearer = (token: string, init: RequestInit = {}) =>
  ({ ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } }) as RequestInit;

test('critère 1 : connexion par la page de Keycloak, jeton accepté par l’API, session de 30 jours', async ({
  page,
}) => {
  const phone = newPhone();
  await signUpThroughApi(phone, 'Fanta', PASSWORD, { profile: 'praticien', lastName: 'Camara' });
  const tokens = await signInLikeTheApp(page, phone);

  // Jeton d'accès émis pour l'API, au client mobile ; jeton de rafraîchissement hors ligne
  expect(claims(tokens.access_token)).toMatchObject({
    azp: CLIENT_ID,
    aud: expect.arrayContaining(['sabou-api']),
    roles: expect.arrayContaining(['praticien']),
  });
  expect(claims(tokens.refresh_token)).toMatchObject({ typ: 'Offline' });
  expect(tokens.scope.split(' ')).toContain('offline_access');
  // Délai d'inactivité de la session hors ligne : 30 jours (décision du maître d'œuvre)
  expect(tokens.refresh_expires_in).toBe(30 * 24 * 3600);

  // Le praticien n'a pas encore de fiche : 404 (et non 401) prouve que le jeton est accepté
  expect((await fetch(`${API}/api/praticien/dossier`, bearer(tokens.access_token))).status).toBe(
    404,
  );
  const lists = await fetch(`${API}/api/praticien/referentiels`, bearer(tokens.access_token));
  expect(lists.status).toBe(200);
  const referentials = (await lists.json()) as { prefectures: unknown[]; langues: unknown[] };
  expect(referentials.prefectures.length).toBeGreaterThanOrEqual(33);
  expect(referentials.langues.length).toBeGreaterThan(0);

  // Rafraîchissement, puis déconnexion (révocation) : le jeton hors ligne ne sert plus
  const refresh = () =>
    fetch(`${OIDC}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: tokens.refresh_token,
      }),
    });
  expect((await refresh()).status).toBe(200);
  const revoke = await fetch(`${OIDC}/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      token: tokens.refresh_token,
      token_type_hint: 'refresh_token',
    }),
  });
  expect(revoke.status).toBe(200);
  expect((await refresh()).status).toBe(400);
});

test('critère 3 : depuis l’application, pièces manquantes affichées puis accusé de réception', async ({
  page,
}) => {
  const phone = newPhone();
  await signUpThroughApi(phone, 'Fanta', PASSWORD, { profile: 'praticien', lastName: 'Camara' });
  const { access_token: token } = await signInLikeTheApp(page, phone);
  const call = (method: string, path: string, body?: BodyInit, type?: string) =>
    fetch(
      `${API}/api/praticien/${path}`,
      bearer(token, { method, body, headers: type ? { 'content-type': type } : {} }),
    );

  const fiche = JSON.stringify({
    specialiteId: 1,
    prefectureId: 4,
    languePrincipale: 'pul',
    anneesExperience: 7,
  });
  expect((await call('PUT', 'fiche', fiche, 'application/json')).status).toBe(204);
  expect((await call('POST', 'dossier/pieces/identite', JPEG, 'image/jpeg')).status).toBe(201);

  const blocked = await call('POST', 'dossier/soumission');
  expect(blocked.status).toBe(422);
  expect(await blocked.json()).toMatchObject({ piecesManquantes: ['photo'] });

  expect((await call('POST', 'dossier/pieces/photo', JPEG, 'image/jpeg')).status).toBe(201);
  const receipt = await call('POST', 'dossier/soumission');
  expect(receipt.status).toBe(200);
  expect(await receipt.json()).toMatchObject({ code: expect.stringMatching(/^DS-/), etape: 2 });
});

test('un jeton non signé ou mal formé est refusé par l’API', async () => {
  const forged = ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJ4In0', ''].join('.');
  for (const token of [forged, 'a.b.c']) {
    expect((await fetch(`${API}/api/praticien/dossier`, bearer(token))).status).toBe(401);
  }
});
