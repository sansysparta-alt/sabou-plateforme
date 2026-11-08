import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Env } from '../config/env';

export const MOBILE_TOKEN_VERIFIER = Symbol('MOBILE_TOKEN_VERIFIER');

// Identité portée par un jeton d'accès de l'application mobile (US-040b, §2.29)
export interface MobileIdentity {
  sub: string;
  roles: string[];
}

export interface MobileTokenVerifier {
  // Jeton valable : identité ; jeton refusé (signature, émetteur, audience, client, expiration) :
  // InvalidMobileTokenError. Une panne de Keycloak remonte telle quelle (503, pas 401).
  verify(token: string): Promise<MobileIdentity>;
}

export class InvalidMobileTokenError extends Error {}

// Forme d'un JWT compact ; tout le reste est refusé avant toute vérification
export const BEARER = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/;

// Les erreurs de jose qui décrivent un jeton refusé, par opposition à une clé injoignable
const REJECTIONS = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JOSEAlgNotAllowed,
  errors.JWKSNoMatchingKey,
  errors.JWKSMultipleMatchingKeys,
];

export interface MobileTokenOptions {
  issuer: string;
  audience: string;
  clientId: string;
  keys: JWTVerifyGetKey;
}

export class JoseMobileTokenVerifier implements MobileTokenVerifier {
  constructor(private readonly options: MobileTokenOptions) {}

  async verify(token: string): Promise<MobileIdentity> {
    const { issuer, audience, clientId, keys } = this.options;
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer,
        audience,
        // Keycloak signe en RS256 ; « none » et les algorithmes symétriques sont refusés
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5,
      }));
    } catch (error) {
      if (REJECTIONS.some((type) => error instanceof type)) throw new InvalidMobileTokenError();
      throw error;
    }
    // Jeton d'accès (pas un jeton d'identité ni de rafraîchissement) délivré à l'application
    // mobile elle-même : un jeton d'un autre client du domaine, même pour la même audience,
    // est refusé
    if (payload.typ !== 'Bearer' || payload.azp !== clientId || !payload.sub) {
      throw new InvalidMobileTokenError();
    }
    const roles = Array.isArray(payload.roles)
      ? payload.roles.filter((r: unknown): r is string => typeof r === 'string')
      : [];
    return { sub: payload.sub, roles };
  }
}

// Clés publiques du domaine « sabou-public », lues par l'adresse interne de Keycloak quand
// elle existe (réseau Docker), comme la découverte OIDC (identity-provider.ts). Mise en cache
// par jose : 10 minutes, nouvelle lecture au plus toutes les 30 s si une clé est inconnue
// (rotation des clés).
export function keycloakMobileTokenVerifier(env: Env): JoseMobileTokenVerifier {
  const issuer = new URL(env.PUBLIC_KEYCLOAK_ISSUER);
  const certs = new URL(`${issuer.href.replace(/\/$/, '')}/protocol/openid-connect/certs`);
  const internal = env.KEYCLOAK_INTERNAL_URL ? new URL(env.KEYCLOAK_INTERNAL_URL) : undefined;
  if (internal) {
    certs.protocol = internal.protocol;
    certs.host = internal.host;
  }
  const keys = createRemoteJWKSet(certs, {
    timeoutDuration: 10_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  });
  return new JoseMobileTokenVerifier({
    issuer: env.PUBLIC_KEYCLOAK_ISSUER,
    audience: env.API_AUDIENCE,
    clientId: env.MOBILE_CLIENT_ID,
    keys,
  });
}
