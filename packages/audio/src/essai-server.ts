// Banc d'essai de US-005, pour l'essai sur téléphone seulement (jamais en recette ni en
// production) : reçoit une voix enregistrée par l'application, la traite deux fois (RNNoise
// à mi-force, retenu, et à pleine force, pour comparer à l'écoute) et sert les deux versions.
// En production, ce rôle revient à l'API (tâche pg-boss, stockage SeaweedFS).
// Les enregistrements restent dans un dossier temporaire, effacé à l'arrêt : jamais dans le dépôt.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { join } from 'node:path';
import { decodeToMono } from './ffmpeg.ts';
import { DEFAULT_STRENGTH, processVoice } from './process.ts';
import { sendAudio } from './serve-file.ts';

/** 90 s en AAC à 48 kbit/s pèsent 540 Ko : 3 Mo laissent une large marge, sans plus. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

/** Formats produits par l'application : Opus en Ogg (Android 10 et plus), AAC en MP4 (8 et 9). */
const EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
};

export const VERSIONS = [
  { name: 'mi-force', strength: DEFAULT_STRENGTH },
  { name: 'pleine-force', strength: 1 },
] as const;

export interface EssaiResult {
  id: string;
  receivedBytes: number;
  receivedSeconds: number;
  versions: { name: string; url: string; bytes: number }[];
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error('trop gros'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

export function startEssaiServer(port: number, workDir: string): Promise<Server> {
  mkdirSync(workDir, { recursive: true });
  const server = createServer(async (request, response) => {
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'POST' && url.pathname === '/voix') {
        const type = (request.headers['content-type'] ?? '').split(';')[0].trim();
        const extension = EXTENSIONS[type];
        if (!extension) return json(415, { erreur: 'Format audio non accepté' });
        let body: Buffer;
        try {
          body = await readBody(request);
        } catch {
          return json(413, { erreur: 'Fichier trop gros' });
        }
        const id = randomUUID();
        const dir = join(workDir, id);
        mkdirSync(dir);
        const input = join(dir, `recu.${extension}`);
        writeFileSync(input, body);
        const started = Date.now();
        const versions = VERSIONS.map(({ name, strength }) => {
          const output = join(dir, `${name}.webm`);
          processVoice(input, output, { strength });
          return { name, url: `/voix/${id}/${name}.webm`, bytes: statSync(output).size };
        });
        const result: EssaiResult = {
          id,
          receivedBytes: body.length,
          receivedSeconds: Math.round((decodeToMono(input, 8000).length / 8000) * 10) / 10,
          versions,
        };
        console.log(
          `Voix reçue : ${result.receivedBytes} octets, ${result.receivedSeconds} s → ` +
            versions.map((v) => `${v.name} ${v.bytes} octets`).join(', ') +
            ` (traitement ${Date.now() - started} ms)`,
        );
        return json(201, result);
      }
      const match = /^\/voix\/([0-9a-f-]{36})\/(mi-force|pleine-force)\.webm$/.exec(url.pathname);
      if (request.method === 'GET' && match) {
        let file: Buffer;
        try {
          file = readFileSync(join(workDir, match[1], `${match[2]}.webm`));
        } catch {
          return json(404, { erreur: 'Voix inconnue' });
        }
        return sendAudio(request, response, file, 'audio/webm');
      }
      return json(404, { erreur: 'Introuvable' });
    } catch (error) {
      console.error(error);
      return json(500, { erreur: 'Traitement impossible' });
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/** Efface les voix reçues (dossier temporaire du banc d'essai). */
export function clearEssai(workDir: string): void {
  rmSync(workDir, { recursive: true, force: true });
}
