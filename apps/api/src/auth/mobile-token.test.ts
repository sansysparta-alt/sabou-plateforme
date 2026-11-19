// US-040b (§2.29) : vérification des jetons d'accès de l'application mobile. Clés tirées pour
// le test ; la chaîne réelle avec Keycloak est prouvée par apps/site/e2e-compte/mobile.spec.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
  type CryptoKey,
} from 'jose';
import { InvalidMobileTokenError, JoseMobileTokenVerifier } from './mobile-token';

const ISSUER = 'http://localhost:8080/realms/sabou-public';
const SUB = '50505050-5050-4050-8050-505050505050';

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let verifier: JoseMobileTokenVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  verifier = new JoseMobileTokenVerifier({
    issuer: ISSUER,
    audience: 'sabou-api',
    clientId: 'sabou-mobile',
    keys: createLocalJWKSet({ keys: [jwk] }),
  });
});

const CLAIMS: JWTPayload = {
  typ: 'Bearer',
  azp: 'sabou-mobile',
  roles: ['praticien', 'offline_access'],
};

function token(
  claims: JWTPayload = {},
  options: { key?: CryptoKey; aud?: string; iss?: string; exp?: string | number } = {},
) {
  return new SignJWT({ ...CLAIMS, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
    .setSubject(SUB)
    .setIssuer(options.iss ?? ISSUER)
    .setAudience(options.aud ?? 'sabou-api')
    .setIssuedAt()
    .setExpirationTime(options.exp ?? '5m')
    .sign(options.key ?? privateKey);
}

describe('jeton d’accès de l’application mobile', () => {
  it('accepte un jeton valable et en tire le compte et ses rôles', async () => {
    await expect(verifier.verify(await token())).resolves.toEqual({
      sub: SUB,
      roles: ['praticien', 'offline_access'],
      amr: [],
    });
  });

  it('rend les méthodes d’authentification du claim « amr » (second facteur, US-082)', async () => {
    const identity = await verifier.verify(await token({ amr: ['pwd', 'otp', 7] }));
    expect(identity.amr).toEqual(['pwd', 'otp']);
  });

  it.each([
    ['signé par une autre clé', () => token({}, { key: otherKey })],
    ['expiré', () => token({}, { exp: Math.floor(Date.now() / 1000) - 60 })],
    ['d’un autre domaine Keycloak', () => token({}, { iss: 'http://localhost:8080/realms/sabou' })],
    ['pour une autre audience', () => token({}, { aud: 'account' })],
    ['délivré à un autre client (le site)', () => token({ azp: 'sabou-site' })],
    ['qui n’est pas un jeton d’accès (jeton d’identité)', () => token({ typ: 'ID' })],
    ['de rafraîchissement hors ligne', () => token({ typ: 'Offline' })],
  ])('refuse un jeton %s', async (_label, make) => {
    await expect(verifier.verify(await make())).rejects.toBeInstanceOf(InvalidMobileTokenError);
  });

  it('refuse un jeton non signé (« alg: none ») ou signé par secret partagé', async () => {
    const body = (claims: object) => Buffer.from(JSON.stringify(claims)).toString('base64url');
    const payload = body({ ...CLAIMS, sub: SUB, iss: ISSUER, aud: 'sabou-api', exp: 9e9, iat: 1 });
    const unsigned = `${body({ alg: 'none', typ: 'JWT' })}.${payload}.`;
    await expect(verifier.verify(unsigned)).rejects.toBeInstanceOf(InvalidMobileTokenError);

    const hs = await new SignJWT({ ...CLAIMS })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setSubject(SUB)
      .setIssuer(ISSUER)
      .setAudience('sabou-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('un-secret-partage-de-32-caracteres!!'));
    await expect(verifier.verify(hs)).rejects.toBeInstanceOf(InvalidMobileTokenError);
  });

  it('ignore des rôles mal formés plutôt que de les accepter', async () => {
    const result = await verifier.verify(await token({ roles: ['praticien', 42, { a: 1 }] }));
    expect(result.roles).toEqual(['praticien']);
  });
});
