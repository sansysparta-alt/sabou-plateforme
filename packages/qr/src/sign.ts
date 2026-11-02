// Signature d'un QR de certificat, côté serveur uniquement (node:crypto, Ed25519).
// En production, la clé privée de la DG reste dans un coffre (05_Choix_Techniques §2.9) ;
// le prototype n'utilise que des clés de test éphémères, jamais écrites sur disque.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { encodeBase45 } from './base45.js';
import {
  encodePayload,
  encodeProtectedHeader,
  encodeSign1,
  QR_PREFIX,
  signatureInput,
  type CertificateData,
} from './format.js';
import { toHex, type PublicKeyJwk } from './verify.js';

export interface SigningKey {
  kid: string;
  privateKey: KeyObject;
  publicJwk: PublicKeyJwk;
}

/** Texte à mettre dans le QR : préfixe de version + COSE_Sign1 en Base45. */
export function signCertificateQr(data: CertificateData, key: SigningKey): string {
  if (key.privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Clé Ed25519 attendue');
  const protectedHeader = encodeProtectedHeader(key.kid);
  const payload = encodePayload(data);
  const signature = sign(null, signatureInput(protectedHeader, payload), key.privateKey);
  return QR_PREFIX + encodeBase45(encodeSign1(protectedHeader, payload, signature));
}

/**
 * Clé de test éphémère. Son identifiant commence par « test- » suivi du début de
 * l'empreinte SHA3-256 de la clé publique : une clé de test se reconnaît à son nom.
 */
export function generateTestSigningKey(): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x;
  if (!x) throw new Error('Export de la clé publique impossible');
  const kid = `test-${toHex(sha3_256(Buffer.from(x, 'base64url'))).slice(0, 8)}`;
  return { kid, privateKey, publicJwk: { kty: 'OKP', crv: 'Ed25519', kid, x } };
}
