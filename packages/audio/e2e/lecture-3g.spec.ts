// US-005, critère 2 : en 3G simulée (400 kbit/s, 400 ms d'aller-retour), la lecture d'une voix
// traitée de 90 s démarre en moins de 3 s, avant la fin du téléchargement.
// Mesure dans Chromium, du clic à l'événement « playing », sans connexion déjà ouverte avec le
// serveur audio : le son passe par le relais de infra/local, qui compte l'établissement de la
// connexion (TCP puis TLS). La page vient d'un autre serveur, déjà chargée.
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startRelay, type Relay } from '../src/relay.ts';
import { packageDir } from '../src/ffmpeg.ts';
import { processVoice } from '../src/process.ts';
import { sendAudio } from '../src/serve-file.ts';

const MAX_START_MS = 3000;

let work: string;
let audioServer: Server;
let pageServer: Server;
let relay: Relay;
let audioBytes: number;

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    }),
  );
}

/** Fichier audio servi comme par le stockage objet : demandes partielles (Range) acceptées. */
function serveAudio(file: Buffer): Server {
  return createServer((request, response) => sendAudio(request, response, file, 'audio/webm'));
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  work = mkdtempSync(join(tmpdir(), 'sabou-lecture-'));
  const voice = join(work, 'voix.webm');
  processVoice(join(packageDir, 'fixtures', 'voix-bruitee.flac'), voice);
  audioBytes = statSync(voice).size;
  audioServer = serveAudio(readFileSync(voice));
  relay = await startRelay(0, '127.0.0.1', await listen(audioServer));
  pageServer = createServer((_, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html lang="fr"><title>Écoute</title>
      <audio id="voix" preload="none" src="http://127.0.0.1:${relay.port}/voix.webm"></audio>
      <button type="button" id="ecouter">Écouter</button>
      <script>
        const voix = document.getElementById('voix');
        document.getElementById('ecouter').addEventListener('click', () => {
          window.clickedAt = performance.now();
          voix.play();
        });
        voix.addEventListener('playing', () => {
          window.playingAt = performance.now();
          window.onPlaying();
        }, { once: true });
      </script></html>`);
  });
  await listen(pageServer);
});

test.afterAll(async () => {
  await relay?.close();
  audioServer?.close();
  pageServer?.close();
  rmSync(work, { recursive: true, force: true });
});

test('la lecture démarre en moins de 3 s en 3G, avant la fin du téléchargement', async ({
  page,
}) => {
  let bytesWhenPlaying = -1;
  await page.exposeFunction('onPlaying', () => {
    bytesWhenPlaying = relay.bytesToClients();
  });
  const address = pageServer.address();
  const pagePort = typeof address === 'object' && address ? address.port : 0;
  await page.goto(`http://127.0.0.1:${pagePort}/`);
  // Rien n'a encore transité par le relais : la connexion au serveur audio est froide
  expect(relay.bytesToClients()).toBe(0);

  await page.getByRole('button', { name: 'Écouter' }).click();
  await page.waitForFunction(() => 'playingAt' in window, null, { timeout: 15_000 });
  const startMs = await page.evaluate(
    () =>
      (window as unknown as { playingAt: number; clickedAt: number }).playingAt -
      (window as unknown as { clickedAt: number }).clickedAt,
  );
  test.info().annotations.push({
    type: 'Démarrage de la lecture',
    description: `${Math.round(startMs)} ms ; ${bytesWhenPlaying} octets reçus sur ${audioBytes}`,
  });

  expect(startMs).toBeLessThan(MAX_START_MS);
  // La lecture a commencé alors qu'une petite partie du fichier seulement était arrivée
  expect(bytesWhenPlaying).toBeGreaterThan(0);
  expect(bytesWhenPlaying).toBeLessThan(audioBytes / 2);
});
