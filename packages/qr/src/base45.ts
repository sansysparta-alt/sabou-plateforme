// Encodage Base45 (RFC 9285) : son alphabet est exactement celui du mode
// alphanumérique des QR, ce qui donne le QR le plus compact pour des octets.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const VALUES = new Map([...ALPHABET].map((char, index) => [char, index]));

export function encodeBase45(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const n = bytes[i] * 256 + bytes[i + 1];
    out += ALPHABET[n % 45] + ALPHABET[Math.floor(n / 45) % 45] + ALPHABET[Math.floor(n / 2025)];
  }
  if (bytes.length % 2 === 1) {
    const n = bytes[bytes.length - 1];
    out += ALPHABET[n % 45] + ALPHABET[Math.floor(n / 45)];
  }
  return out;
}

/** Lève une erreur sur tout caractère hors alphabet ou toute valeur hors bornes. */
export function decodeBase45(text: string): Uint8Array {
  if (text.length % 3 === 1) throw new Error('Base45 : longueur invalide');
  const digits = [...text].map((char) => {
    const value = VALUES.get(char);
    if (value === undefined) throw new Error('Base45 : caractère invalide');
    return value;
  });
  const out: number[] = [];
  for (let i = 0; i < digits.length; i += 3) {
    if (i + 2 < digits.length) {
      const n = digits[i] + digits[i + 1] * 45 + digits[i + 2] * 2025;
      if (n > 0xffff) throw new Error('Base45 : valeur hors bornes');
      out.push(n >> 8, n & 0xff);
    } else {
      const n = digits[i] + digits[i + 1] * 45;
      if (n > 0xff) throw new Error('Base45 : valeur hors bornes');
      out.push(n);
    }
  }
  return Uint8Array.from(out);
}
