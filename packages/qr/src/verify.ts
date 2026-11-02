// Vérification hors ligne d'un QR de certificat (UC-06, R-QR-03 à R-QR-05).
// Tourne dans le navigateur comme dans Node : aucune dépendance à node:crypto.
// Le statut « révoqué » d'un certificat n'est connu qu'en ligne (UC-06 2a) :
// le verdict hors ligne le signale par `revocationChecked: false`.
import { ed25519 } from '@noble/curves/ed25519.js';
import { decodeBase45 } from './base45.js';
import {
  certificateDigest,
  decodePayload,
  decodeProtectedHeader,
  decodeSign1,
  QR_MAX_LENGTH,
  QR_PREFIX,
  signatureInput,
  type CertificateData,
} from './format.js';

/** Clé publique de la DG au format JWK (RFC 8037), telle que publiée sur le site. */
export interface PublicKeyJwk {
  kty: 'OKP';
  crv: 'Ed25519';
  kid: string;
  /** Clé publique brute, 32 octets en base64url. */
  x: string;
  /** Clé compromise (R-QR-04) : tout certificat signé avec elle est refusé. */
  revoked?: boolean;
}

export type Verdict =
  | {
      color: 'vert';
      status: 'authentique';
      certificate: CertificateData;
      digest: string;
      kid: string;
      revocationChecked: false;
    }
  | {
      color: 'ambre';
      status: 'expire';
      certificate: CertificateData;
      digest: string;
      kid: string;
      revocationChecked: false;
    }
  | { color: 'rouge'; status: 'falsifie' | 'cle_inconnue' | 'cle_revoquee' };

/**
 * Relit une liste de clés publiques reçue de l'extérieur (variable d'environnement,
 * réponse du site, cache du navigateur). Toute entrée mal formée est écartée.
 */
export function parsePublicKeys(input: unknown): PublicKeyJwk[] {
  const list = Array.isArray(input) ? input : [];
  return list.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { kty, crv, kid, x, revoked } = entry as Record<string, unknown>;
    const valid =
      kty === 'OKP' &&
      crv === 'Ed25519' &&
      typeof kid === 'string' &&
      /^[\w-]{1,64}$/.test(kid) &&
      typeof x === 'string' &&
      // 32 octets en base64url sans remplissage
      /^[A-Za-z0-9_-]{43}$/.test(x) &&
      (revoked === undefined || typeof revoked === 'boolean');
    return valid ? [{ kty, crv, kid, x, ...(revoked ? { revoked } : {}) }] : [];
  });
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('base64url invalide');
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  );
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Date du jour à Conakry (UTC+0, sans heure d'été), au format AAAA-MM-JJ. */
export function todayInConakry(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Rend le verdict d'un texte lu dans un QR.
 * Rouge si le format, la clé, la signature ou l'empreinte ne vont pas ; ambre si le
 * certificat authentique a dépassé sa date d'expiration ; vert sinon.
 */
export function verifyCertificateQr(
  text: string,
  keys: readonly PublicKeyJwk[],
  now: Date = new Date(),
): Verdict {
  const forged = { color: 'rouge', status: 'falsifie' } as const;
  if (text.length > QR_MAX_LENGTH || !text.startsWith(QR_PREFIX)) return forged;

  let message: ReturnType<typeof decodeSign1>;
  let kid: string;
  try {
    message = decodeSign1(decodeBase45(text.slice(QR_PREFIX.length)));
    kid = decodeProtectedHeader(message.protectedHeader);
  } catch {
    return forged;
  }

  const key = keys.find((candidate) => candidate.kid === kid);
  if (!key || key.kty !== 'OKP' || key.crv !== 'Ed25519') {
    return { color: 'rouge', status: 'cle_inconnue' };
  }
  if (key.revoked) return { color: 'rouge', status: 'cle_revoquee' };

  let valid: boolean;
  try {
    const publicKey = fromBase64Url(key.x);
    // zip215 désactivé : règles strictes de la RFC 8032, comme OpenSSL côté serveur
    valid = ed25519.verify(
      message.signature,
      signatureInput(message.protectedHeader, message.payload),
      publicKey,
      { zip215: false },
    );
  } catch {
    valid = false;
  }
  if (!valid) return forged;

  let payload: ReturnType<typeof decodePayload>;
  try {
    payload = decodePayload(message.payload);
  } catch {
    return forged;
  }
  // Empreinte recalculée (R-QR-02) : elle doit être celle que la DG a signée
  if (!sameBytes(certificateDigest(payload.data), payload.digest)) return forged;

  const result = {
    certificate: payload.data,
    digest: toHex(payload.digest),
    kid,
    revocationChecked: false,
  } as const;
  return payload.data.expiresOn < todayInConakry(now)
    ? { color: 'ambre', status: 'expire', ...result }
    : { color: 'vert', status: 'authentique', ...result };
}
