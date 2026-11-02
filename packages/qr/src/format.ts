// Format du QR d'un certificat (R-QR-02, R-QR-03, R-QR-04) :
//   « SB1: » + Base45( COSE_Sign1 (RFC 9052, étiquette CBOR 18) )
// Charge utile : table CBOR à clés entières (compacte), qui porte les données
// du certificat et leur empreinte SHA3-256. Signature Ed25519 (algorithme COSE
// EdDSA, -8) sur la structure « Signature1 » de COSE, donc sur l'en-tête protégé
// (algorithme, identifiant de la clé) et sur toute la charge utile.
import { decode, encode, Tagged, type DecodeOptions } from 'cborg';
import { sha3_256 } from '@noble/hashes/sha3.js';

/** Préfixe de version : un format futur changera de préfixe, l'ancien restera lisible. */
export const QR_PREFIX = 'SB1:';
/** Au-delà, le texte ne peut pas venir d'un QR SABOU : on le refuse sans le décoder. */
export const QR_MAX_LENGTH = 1024;

const COSE_SIGN1_TAG = 18;
const COSE_HEADER_ALG = 1;
const COSE_HEADER_KID = 4;
const COSE_ALG_EDDSA = -8;
const FORMAT_VERSION = 1;

/** Données du certificat portées par le QR (colonnes de la table `certificat`). */
export interface CertificateData {
  /** Numéro du certificat (`certificat.numero`). */
  number: string;
  /** Nom complet du praticien. */
  practitioner: string;
  /** Date d'émission, AAAA-MM-JJ (`certificat.emis_le`). */
  issuedOn: string;
  /** Date d'expiration, AAAA-MM-JJ (`certificat.expire_le`). */
  expiresOn: string;
  /** Autorité émettrice. */
  authority: string;
}

const CLAIM = { version: 1, number: 2, practitioner: 3, issuedOn: 4, expiresOn: 5, authority: 6 };
const CLAIM_DIGEST = 7;

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TEXT_MAX_LENGTH = 200;

// Décodage strict : encodages minimaux, pas de clé en double, UTF-8 valide,
// pas de longueur indéfinie ni d'« undefined » ; seule l'étiquette COSE_Sign1 est admise.
const STRICT: DecodeOptions = {
  strict: true,
  useMaps: true,
  rejectDuplicateMapKeys: true,
  strictUtf8: true,
  allowIndefinite: false,
  allowUndefined: false,
};

export function decodeStrict(bytes: Uint8Array, allowSign1Tag = false): unknown {
  const tags: DecodeOptions['tags'] = {};
  if (allowSign1Tag) tags[COSE_SIGN1_TAG] = Tagged.decoder(COSE_SIGN1_TAG);
  return decode(bytes, { ...STRICT, tags });
}

export function assertCertificateData(data: CertificateData): void {
  for (const field of ['number', 'practitioner', 'authority'] as const) {
    const value = data[field];
    if (typeof value !== 'string' || value.trim() === '' || value.length > TEXT_MAX_LENGTH) {
      throw new Error(`Certificat : champ « ${field} » invalide`);
    }
  }
  for (const field of ['issuedOn', 'expiresOn'] as const) {
    if (typeof data[field] !== 'string' || !DATE.test(data[field])) {
      throw new Error(`Certificat : date « ${field} » invalide`);
    }
  }
  if (data.expiresOn <= data.issuedOn) throw new Error('Certificat : expiration avant émission');
}

function claimsMap(data: CertificateData): Map<number, unknown> {
  return new Map<number, unknown>([
    [CLAIM.version, FORMAT_VERSION],
    [CLAIM.number, data.number],
    [CLAIM.practitioner, data.practitioner],
    [CLAIM.issuedOn, data.issuedOn],
    [CLAIM.expiresOn, data.expiresOn],
    [CLAIM.authority, data.authority],
  ]);
}

/** Empreinte SHA3-256 des données du certificat (R-QR-02), sur leur encodage CBOR déterministe. */
export function certificateDigest(data: CertificateData): Uint8Array {
  return sha3_256(encode(claimsMap(data)));
}

export function encodePayload(data: CertificateData): Uint8Array {
  assertCertificateData(data);
  const claims = claimsMap(data);
  claims.set(CLAIM_DIGEST, certificateDigest(data));
  return encode(claims);
}

/** Relit la charge utile ; lève une erreur si sa forme n'est pas exactement celle attendue. */
export function decodePayload(bytes: Uint8Array): { data: CertificateData; digest: Uint8Array } {
  const claims = decodeStrict(bytes);
  if (!(claims instanceof Map) || claims.size !== 7) throw new Error('Charge utile invalide');
  if (claims.get(CLAIM.version) !== FORMAT_VERSION) throw new Error('Version de format inconnue');
  const data = {
    number: claims.get(CLAIM.number),
    practitioner: claims.get(CLAIM.practitioner),
    issuedOn: claims.get(CLAIM.issuedOn),
    expiresOn: claims.get(CLAIM.expiresOn),
    authority: claims.get(CLAIM.authority),
  } as CertificateData;
  assertCertificateData(data);
  const digest = claims.get(CLAIM_DIGEST);
  if (!(digest instanceof Uint8Array) || digest.length !== 32)
    throw new Error('Empreinte invalide');
  return { data, digest };
}

export function encodeProtectedHeader(kid: string): Uint8Array {
  return encode(
    new Map<number, unknown>([
      [COSE_HEADER_ALG, COSE_ALG_EDDSA],
      [COSE_HEADER_KID, new TextEncoder().encode(kid)],
    ]),
  );
}

/** Identifiant de la clé lu dans l'en-tête protégé ; seul l'algorithme EdDSA est admis. */
export function decodeProtectedHeader(bytes: Uint8Array): string {
  const header = decodeStrict(bytes);
  if (!(header instanceof Map) || header.size !== 2) throw new Error('En-tête invalide');
  if (header.get(COSE_HEADER_ALG) !== COSE_ALG_EDDSA) throw new Error('Algorithme refusé');
  const kid = header.get(COSE_HEADER_KID);
  if (!(kid instanceof Uint8Array) || kid.length === 0 || kid.length > 64) {
    throw new Error('Identifiant de clé invalide');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(kid);
}

/** Données signées : structure « Signature1 » de COSE (RFC 9052 §4.4), sans donnée externe. */
export function signatureInput(protectedHeader: Uint8Array, payload: Uint8Array): Uint8Array {
  return encode(['Signature1', protectedHeader, new Uint8Array(0), payload]);
}

export function encodeSign1(
  protectedHeader: Uint8Array,
  payload: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  return encode(new Tagged(COSE_SIGN1_TAG, [protectedHeader, new Map(), payload, signature]));
}

export function decodeSign1(bytes: Uint8Array): {
  protectedHeader: Uint8Array;
  payload: Uint8Array;
  signature: Uint8Array;
} {
  const message = decodeStrict(bytes, true);
  if (!(message instanceof Tagged) || message.tag !== COSE_SIGN1_TAG) {
    throw new Error('COSE_Sign1 attendu');
  }
  const parts = message.value;
  if (!Array.isArray(parts) || parts.length !== 4) throw new Error('COSE_Sign1 invalide');
  const [protectedHeader, unprotected, payload, signature] = parts as unknown[];
  // En-tête non protégé : vide, pour qu'aucune donnée non signée ne soit lue
  if (!(unprotected instanceof Map) || unprotected.size !== 0) {
    throw new Error('En-tête non protégé refusé');
  }
  if (
    !(protectedHeader instanceof Uint8Array) ||
    !(payload instanceof Uint8Array) ||
    !(signature instanceof Uint8Array) ||
    signature.length !== 64
  ) {
    throw new Error('COSE_Sign1 invalide');
  }
  return { protectedHeader, payload, signature };
}
