import { createHash, sign } from 'node:crypto';
import { encode, Tagged } from 'cborg';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { decodeBase45, encodeBase45 } from './base45.js';
import {
  certificateDigest,
  decodeSign1,
  decodeStrict,
  encodeProtectedHeader,
  encodeSign1,
  QR_PREFIX,
  signatureInput,
  type CertificateData,
} from './format.js';
import { generateTestSigningKey, signCertificateQr, type SigningKey } from './sign.js';
import { parsePublicKeys, verifyCertificateQr } from './verify.js';

const CERTIFICATE: CertificateData = {
  number: 'GN-CERT-2026-000123',
  practitioner: 'Mamadou Exemple',
  issuedOn: '2026-11-02',
  expiresOn: '2027-11-01',
  authority: 'Direction générale SABOU',
};
const DURING_VALIDITY = new Date('2027-03-15T12:00:00Z');

const dgKey = generateTestSigningKey();
const keyring = [dgKey.publicJwk];

/** Reconstruit un QR en changeant la charge utile, sans toucher à la signature. */
function tamperPayload(qr: string, change: (claims: Map<number, unknown>) => void): string {
  const message = decodeSign1(decodeBase45(qr.slice(QR_PREFIX.length)));
  const claims = decodeStrict(message.payload) as Map<number, unknown>;
  change(claims);
  return (
    QR_PREFIX +
    encodeBase45(encodeSign1(message.protectedHeader, encode(claims), message.signature))
  );
}

/** Signe une charge utile arbitraire avec une vraie clé, comme le ferait un émetteur fautif. */
function signRawPayload(payload: Uint8Array, key: SigningKey, kid = key.kid): string {
  const protectedHeader = encodeProtectedHeader(kid);
  const signature = sign(null, signatureInput(protectedHeader, payload), key.privateKey);
  return QR_PREFIX + encodeBase45(encodeSign1(protectedHeader, payload, signature));
}

describe('QR signé : verdicts (R-QR-05)', () => {
  it('vert « authentique » pour un QR signé par la DG, sans réseau ni horloge serveur', () => {
    const verdict = verifyCertificateQr(
      signCertificateQr(CERTIFICATE, dgKey),
      keyring,
      DURING_VALIDITY,
    );
    expect(verdict).toEqual({
      color: 'vert',
      status: 'authentique',
      certificate: CERTIFICATE,
      digest: Buffer.from(certificateDigest(CERTIFICATE)).toString('hex'),
      kid: dgKey.kid,
      revocationChecked: false,
    });
  });

  it('vert le jour même de l’expiration, ambre « expiré » le lendemain', () => {
    const qr = signCertificateQr(CERTIFICATE, dgKey);
    expect(verifyCertificateQr(qr, keyring, new Date('2027-11-01T23:59:59Z')).color).toBe('vert');
    const verdict = verifyCertificateQr(qr, keyring, new Date('2027-11-02T00:00:00Z'));
    expect(verdict).toMatchObject({ color: 'ambre', status: 'expire', certificate: CERTIFICATE });
  });

  it.each<[string, (claims: Map<number, unknown>) => void]>([
    ['le nom du praticien', (c) => c.set(3, 'Autre Personne')],
    ['la date d’expiration', (c) => c.set(5, '2030-11-01')],
    ['le numéro', (c) => c.set(2, 'GN-CERT-2026-000124')],
    ['l’autorité', (c) => c.set(6, 'Autorité inventée')],
  ])('rouge « falsifié » si %s est modifié', (_, change) => {
    const forged = tamperPayload(signCertificateQr(CERTIFICATE, dgKey), change);
    expect(verifyCertificateQr(forged, keyring, DURING_VALIDITY)).toEqual({
      color: 'rouge',
      status: 'falsifie',
    });
  });

  it('rouge « falsifié » si un seul caractère du QR est changé', () => {
    const qr = signCertificateQr(CERTIFICATE, dgKey);
    // Chaque position du texte Base45, avec un caractère voisin de l'alphabet
    for (let i = QR_PREFIX.length; i < qr.length; i++) {
      const char = qr[i] === '0' ? '1' : '0';
      const forged = qr.slice(0, i) + char + qr.slice(i + 1);
      expect(verifyCertificateQr(forged, keyring, DURING_VALIDITY).color, `position ${i}`).toBe(
        'rouge',
      );
    }
  });

  it('rouge « clé inconnue » pour un QR signé par une autre clé', () => {
    const otherKey = generateTestSigningKey();
    const verdict = verifyCertificateQr(
      signCertificateQr(CERTIFICATE, otherKey),
      keyring,
      DURING_VALIDITY,
    );
    expect(verdict).toEqual({ color: 'rouge', status: 'cle_inconnue' });
  });

  it('rouge « falsifié » pour un QR signé par une autre clé qui usurpe l’identifiant de la DG', () => {
    const otherKey = generateTestSigningKey();
    const forged = signCertificateQr(CERTIFICATE, { ...otherKey, kid: dgKey.kid });
    expect(verifyCertificateQr(forged, keyring, DURING_VALIDITY)).toEqual({
      color: 'rouge',
      status: 'falsifie',
    });
  });

  it('rouge « clé révoquée » si la clé de la DG a été révoquée (R-QR-04)', () => {
    const revoked = [{ ...dgKey.publicJwk, revoked: true }];
    const verdict = verifyCertificateQr(
      signCertificateQr(CERTIFICATE, dgKey),
      revoked,
      DURING_VALIDITY,
    );
    expect(verdict).toEqual({ color: 'rouge', status: 'cle_revoquee' });
  });

  it('rouge « falsifié » si l’empreinte signée ne correspond pas aux données (R-QR-02)', () => {
    const payload = encode(
      new Map<number, unknown>([
        [1, 1],
        [2, CERTIFICATE.number],
        [3, CERTIFICATE.practitioner],
        [4, CERTIFICATE.issuedOn],
        [5, CERTIFICATE.expiresOn],
        [6, CERTIFICATE.authority],
        [7, new Uint8Array(32)],
      ]),
    );
    expect(
      verifyCertificateQr(signRawPayload(payload, dgKey), keyring, DURING_VALIDITY).color,
    ).toBe('rouge');
  });

  it.each([
    ['un texte sans préfixe SABOU', 'HC1:6BFOXN*TS0BI$ZD'],
    ['un lien web', 'https://exemple.org/certificat'],
    ['un texte vide', ''],
    ['un texte trop long', QR_PREFIX + '0'.repeat(2000)],
    ['du Base45 invalide', QR_PREFIX + 'abc'],
    ['du CBOR tronqué', signCertificateQr(CERTIFICATE, dgKey).slice(0, -6)],
  ])('rouge « falsifié » pour %s', (_, text) => {
    expect(verifyCertificateQr(text, keyring, DURING_VALIDITY)).toEqual({
      color: 'rouge',
      status: 'falsifie',
    });
  });

  it('rouge « falsifié » si l’en-tête non protégé porte une donnée (non signée)', () => {
    const message = decodeSign1(decodeBase45(signCertificateQr(CERTIFICATE, dgKey).slice(4)));
    const bytes = encode(
      new Tagged(18, [
        message.protectedHeader,
        new Map([[4, new TextEncoder().encode('autre')]]),
        message.payload,
        message.signature,
      ]),
    );
    expect(
      verifyCertificateQr(QR_PREFIX + encodeBase45(bytes), keyring, DURING_VALIDITY).color,
    ).toBe('rouge');
  });

  it('rouge « falsifié » si l’algorithme annoncé n’est pas EdDSA', () => {
    const qr = signCertificateQr(CERTIFICATE, dgKey);
    const message = decodeSign1(decodeBase45(qr.slice(4)));
    const header = encode(
      new Map<number, unknown>([
        [1, -7],
        [4, new TextEncoder().encode(dgKey.kid)],
      ]),
    );
    const forged =
      QR_PREFIX + encodeBase45(encodeSign1(header, message.payload, message.signature));
    expect(verifyCertificateQr(forged, keyring, DURING_VALIDITY).color).toBe('rouge');
  });
});

describe('Clés publiées', () => {
  it('garde les clés bien formées et écarte les autres', () => {
    const valid = dgKey.publicJwk;
    expect(
      parsePublicKeys([
        valid,
        { ...valid, kid: 'revoquee', revoked: true },
        { ...valid, crv: 'P-256' },
        { ...valid, x: 'trop-court' },
        { ...valid, kid: '<script>' },
        null,
        'texte',
      ]),
    ).toEqual([valid, { ...valid, kid: 'revoquee', revoked: true }]);
    expect(parsePublicKeys({ keys: [valid] })).toEqual([]);
  });
});

describe('QR signé : format', () => {
  it('l’empreinte est le SHA3-256 standard (même résultat que node:crypto)', () => {
    const claims = new Map<number, unknown>([
      [1, 1],
      [2, CERTIFICATE.number],
      [3, CERTIFICATE.practitioner],
      [4, CERTIFICATE.issuedOn],
      [5, CERTIFICATE.expiresOn],
      [6, CERTIFICATE.authority],
    ]);
    const expected = createHash('sha3-256').update(encode(claims)).digest();
    expect(Buffer.from(certificateDigest(CERTIFICATE))).toEqual(expected);
  });

  it('l’identifiant d’une clé de test commence par « test- »', () => {
    expect(dgKey.kid).toMatch(/^test-[0-9a-f]{8}$/);
  });

  it('refuse de signer des données incomplètes ou incohérentes', () => {
    expect(() => signCertificateQr({ ...CERTIFICATE, practitioner: ' ' }, dgKey)).toThrow();
    expect(() => signCertificateQr({ ...CERTIFICATE, expiresOn: '2026-11-01' }, dgKey)).toThrow();
    expect(() => signCertificateQr({ ...CERTIFICATE, issuedOn: '02/11/2026' }, dgKey)).toThrow();
  });

  it('tient dans un QR lisible par un téléphone d’entrée de gamme (mode alphanumérique, version ≤ 13)', () => {
    // Noms et autorité longs : le cas le plus lourd attendu
    const qr = signCertificateQr(
      {
        ...CERTIFICATE,
        practitioner: 'Elhadj Mamadou Saliou Diallo-Bangoura',
        authority: 'Direction nationale de la médecine traditionnelle',
      },
      dgKey,
    );
    expect(qr).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
    const symbol = QRCode.create(qr, { errorCorrectionLevel: 'M' });
    expect(symbol.version).toBeLessThanOrEqual(13);
  });
});
