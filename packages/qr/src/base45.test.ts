import { describe, expect, it } from 'vitest';
import { decodeBase45, encodeBase45 } from './base45.js';

const text = (value: string) => new TextEncoder().encode(value);

// Exemples de la RFC 9285, §4.3 et §4.4
const RFC_VECTORS: [string, string][] = [
  ['AB', 'BB8'],
  ['Hello!!', '%69 VD92EX0'],
  ['base-45', 'UJCLQE7W581'],
  ['ietf!', 'QED8WEX0'],
];

describe('Base45 (RFC 9285)', () => {
  it.each(RFC_VECTORS)('encode « %s » en « %s »', (input, expected) => {
    expect(encodeBase45(text(input))).toBe(expected);
  });

  it.each(RFC_VECTORS)('décode « %s » depuis « %s »', (expected, input) => {
    expect(decodeBase45(input)).toEqual(text(expected));
  });

  it('retrouve des octets quelconques', () => {
    const bytes = Uint8Array.from({ length: 257 }, (_, i) => (i * 37) % 256);
    expect(decodeBase45(encodeBase45(bytes))).toEqual(bytes);
  });

  it.each([
    ['GGW', 'valeur hors bornes (65536)'],
    ['ZZ', 'valeur hors bornes sur deux caractères'],
    ['A', 'longueur invalide'],
    ['bb8', 'minuscules hors alphabet'],
  ])('refuse « %s » (%s)', (input) => {
    expect(() => decodeBase45(input)).toThrow();
  });
});
