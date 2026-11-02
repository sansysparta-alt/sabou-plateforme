// Point d'entrée commun au navigateur et au serveur : vérification seulement.
// La signature (node:crypto) est dans « @sabou/qr/sign ».
export { decodeBase45, encodeBase45 } from './base45.js';
export { QR_MAX_LENGTH, QR_PREFIX, certificateDigest, type CertificateData } from './format.js';
export {
  parsePublicKeys,
  toHex,
  verifyCertificateQr,
  type PublicKeyJwk,
  type Verdict,
} from './verify.js';
