import { jwtVerify, SignJWT } from 'jose';

// Jetons de synchronisation (US-004) : les mêmes pour PowerSync (lecture) et pour l'API
// (envoi). Développement : HS256 avec la clé partagée ; production : Keycloak (US-010).
export const SYNC_AUDIENCE = 'sabou-mobile';
const KEY_ID = 'sabou-dev';

export interface SyncAgent {
  id: number;
  role: string;
  prefectureId: number | null;
}

const key = (secret: string) => Buffer.from(secret, 'base64url');

// Lève une erreur si le jeton est absent, mal signé, expiré ou destiné à un autre service
export async function verifySyncToken(token: string, secret: string): Promise<SyncAgent> {
  const { payload } = await jwtVerify(token, key(secret), {
    algorithms: ['HS256'],
    audience: SYNC_AUDIENCE,
    requiredClaims: ['sub', 'exp', 'iat'],
  });
  const id = Number(payload.sub);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Identifiant d’agent invalide');
  const prefectureId = payload['prefecture_id'];
  return {
    id,
    role: typeof payload['role'] === 'string' ? payload['role'] : '',
    prefectureId: typeof prefectureId === 'number' ? prefectureId : null,
  };
}

// Jeton de développement (script sync:token) : jamais en recette ni en production
export async function signSyncToken(
  agent: SyncAgent,
  secret: string,
  lifetimeSeconds = 12 * 3600,
): Promise<string> {
  return new SignJWT({ role: agent.role, prefecture_id: agent.prefectureId })
    .setProtectedHeader({ alg: 'HS256', kid: KEY_ID })
    .setSubject(String(agent.id))
    .setAudience(SYNC_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + lifetimeSeconds)
    .sign(key(secret));
}
