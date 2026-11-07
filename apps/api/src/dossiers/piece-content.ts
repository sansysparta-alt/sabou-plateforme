import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { PIECE_MAX_BYTES, type PieceMimeType } from '@sabou/types';

// Contenu d'une pièce déposée par le praticien (US-040a). Le format est reconnu aux premiers
// octets du fichier : ni son nom ni l'en-tête Content-Type ne sont crus (ASVS V12.1).

export class PieceTooLargeError extends Error {
  constructor() {
    super(`Pièce de plus de ${PIECE_MAX_BYTES / 1024 / 1024} Mo`);
  }
}

// Lit le corps de la requête. Au-delà de la limite, la suite est lue et jetée, jamais gardée
// en mémoire, puis l'envoi est refusé : le client reçoit le refus (413) au lieu d'une
// connexion coupée. Un envoi annoncé bien plus gros est refusé sans être lu.
export async function readLimited(
  stream: Readable & { headers?: Record<string, string | string[] | undefined> },
  limit = PIECE_MAX_BYTES,
): Promise<Buffer> {
  const announced = Number(stream.headers?.['content-length'] ?? 0);
  if (announced > 2 * limit) throw new PieceTooLargeError();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > 2 * limit) {
      stream.destroy();
      throw new PieceTooLargeError();
    }
    if (size <= limit) chunks.push(buffer);
  }
  if (size > limit) throw new PieceTooLargeError();
  return Buffer.concat(chunks, size);
}

const SIGNATURES: { mime: PieceMimeType; bytes: number[]; extension: string }[] = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff], extension: 'jpg' },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], extension: 'png' },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], extension: 'pdf' }, // %PDF-
];

export interface PieceContent {
  mime: PieceMimeType;
  extension: string;
  sha256: string;
  size: number;
}

// null : format refusé (ou fichier vide)
export function inspectPiece(body: Buffer): PieceContent | null {
  const match = SIGNATURES.find(({ bytes }) => bytes.every((byte, index) => body[index] === byte));
  if (!match || body.length === 0) return null;
  return {
    mime: match.mime,
    extension: match.extension,
    sha256: createHash('sha256').update(body).digest('hex'),
    size: body.length,
  };
}
