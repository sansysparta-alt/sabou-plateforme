// Signature d'un QR de certificat, côté serveur uniquement (Ed25519).
// La clé privée de la DG reste dans un coffre (OpenBao Transit, 05_Choix_Techniques §2.34) :
// l'API lui confie les octets à signer (signCertificateQrWith). Les tests utilisent des clés
// éphémères, jamais écrites sur disque (signCertificateQr, generateTestSigningKey).
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { encodeBase45 } from './base45.js';
import {
  certificateDigest,
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

/** Signature confiée à un tiers (le coffre) : reçoit les octets à signer, rend 64 octets. */
export type Ed25519Signer = (input: Uint8Array) => Promise<Uint8Array>;

export interface SignedCertificateQr {
  /** Texte du QR : préfixe de version + COSE_Sign1 en Base45. */
  qr: string;
  /** Empreinte SHA3-256 des données, en hexadécimal (R-QR-02). */
  digest: string;
  /** Signature Ed25519 de la structure Signature1, en base64 (R-QR-03). */
  signature: string;
}

/** Comme signCertificateQr, mais la clé privée n'est jamais en mémoire : `sign` la tient. */
export async function signCertificateQrWith(
  data: CertificateData,
  kid: string,
  sign: Ed25519Signer,
): Promise<SignedCertificateQr> {
  const protectedHeader = encodeProtectedHeader(kid);
  const payload = encodePayload(data);
  const signature = await sign(signatureInput(protectedHeader, payload));
  if (signature.length !== 64) throw new Error('Signature Ed25519 de 64 octets attendue');
  return {
    qr: QR_PREFIX + encodeBase45(encodeSign1(protectedHeader, payload, signature)),
    digest: toHex(certificateDigest(data)),
    signature: Buffer.from(signature).toString('base64'),
  };
}

/**
 * Identifiant d'une clé de la DG : « dg- » suivi des 8 premiers caractères de l'empreinte
 * SHA3-256 de la clé publique brute (32 octets). Deux clés différentes ont deux identifiants.
 */
export function keyIdFor(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error('Clé publique Ed25519 de 32 octets attendue');
  return `dg-${toHex(sha3_256(publicKey)).slice(0, 8)}`;
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
