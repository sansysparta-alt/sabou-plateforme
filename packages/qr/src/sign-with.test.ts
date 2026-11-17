// US-045 : signature confiée au coffre (signCertificateQrWith). Le coffre est simulé par une
// fonction qui détient une clé éphémère ; le QR produit doit être vert pour le vérificateur
// du site, exactement comme un QR signé avec la clé en mémoire.
import { sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { certificateDigest, type CertificateData } from './format.js';
import { generateTestSigningKey, keyIdFor, signCertificateQrWith } from './sign.js';
import { toHex, verifyCertificateQr } from './verify.js';

const CERTIFICATE: CertificateData = {
  number: 'SAB-2026-PR1041-K7Q',
  practitioner: 'Sékou Kourouma',
  issuedOn: '2026-11-13',
  expiresOn: '2027-11-12',
  authority: 'Direction générale SABOU',
};
const key = generateTestSigningKey();
const vault = async (input: Uint8Array) => new Uint8Array(sign(null, input, key.privateKey));

describe('Signature par le coffre', () => {
  it('QR vert, empreinte SHA3-256 et signature de 64 octets rendues à part', async () => {
    const signed = await signCertificateQrWith(CERTIFICATE, key.kid, vault);
    const verdict = verifyCertificateQr(signed.qr, [key.publicJwk], new Date('2027-01-01'));
    expect(verdict).toMatchObject({ color: 'vert', certificate: CERTIFICATE });
    expect(signed.digest).toBe(toHex(certificateDigest(CERTIFICATE)));
    expect(Buffer.from(signed.signature, 'base64')).toHaveLength(64);
  });

  it('signature d’une autre longueur (réponse du coffre altérée) : refusée', async () => {
    await expect(
      signCertificateQrWith(CERTIFICATE, key.kid, async () => new Uint8Array(63)),
    ).rejects.toThrow(/64 octets/);
  });

  it('identifiant de clé : « dg- » et 8 caractères, stable, distinct pour une autre clé', () => {
    const raw = Buffer.from(key.publicJwk.x, 'base64url');
    const other = Buffer.from(generateTestSigningKey().publicJwk.x, 'base64url');
    expect(keyIdFor(raw)).toMatch(/^dg-[0-9a-f]{8}$/);
    expect(keyIdFor(raw)).toBe(keyIdFor(Uint8Array.from(raw)));
    expect(keyIdFor(other)).not.toBe(keyIdFor(raw));
    expect(() => keyIdFor(new Uint8Array(31))).toThrow();
  });
});
