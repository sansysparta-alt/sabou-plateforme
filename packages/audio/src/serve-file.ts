import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Envoie un fichier audio comme le stockage objet : demandes partielles (Range) acceptées,
 * pour que le lecteur commence à jouer avant la fin du téléchargement.
 */
export function sendAudio(
  request: IncomingMessage,
  response: ServerResponse,
  file: Buffer,
  contentType: string,
): void {
  const headers = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
  if (!range) {
    response.writeHead(200, { ...headers, 'Content-Length': file.length });
    response.end(file);
    return;
  }
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), file.length - 1) : file.length - 1;
  if (start > end) {
    response.writeHead(416, { 'Content-Range': `bytes */${file.length}` });
    response.end();
    return;
  }
  response.writeHead(206, {
    ...headers,
    'Content-Range': `bytes ${start}-${end}/${file.length}`,
    'Content-Length': end - start + 1,
  });
  response.end(file.subarray(start, end + 1));
}
