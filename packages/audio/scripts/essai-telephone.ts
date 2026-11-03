// Essai de US-005 sur téléphone : banc d'essai (port 3400) et relais 3G devant lui (port 3300).
// L'application Flutter parle au relais : envoi et écoute se font en 3G simulée.
// Usage (Docker démarré, téléphone branché) :
//   pnpm --filter @sabou/audio essai
//   adb reverse tcp:3300 tcp:3300
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearEssai, startEssaiServer } from '../src/essai-server.ts';
import { PROFILE_3G, startRelay } from '../src/relay.ts';

const SERVER_PORT = 3400;
const RELAY_PORT = 3300;

const workDir = mkdtempSync(join(tmpdir(), 'sabou-essai-'));
await startEssaiServer(SERVER_PORT, workDir);
await startRelay(RELAY_PORT, '127.0.0.1', SERVER_PORT);
const p = PROFILE_3G;
console.log(
  `Banc d'essai prêt. Téléphone → relais 3G 127.0.0.1:${RELAY_PORT} (${p.downKbps}/${p.upKbps} kbit/s, ` +
    `${p.rttMs} ms) → banc 127.0.0.1:${SERVER_PORT}.\n` +
    `Commande à lancer : adb reverse tcp:${RELAY_PORT} tcp:${RELAY_PORT}\n` +
    'Ctrl+C pour arrêter : les voix reçues sont effacées.',
);
const stop = () => {
  clearEssai(workDir);
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
