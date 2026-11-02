// Relais 3G en ligne de commande (US-005) : essai manuel sur téléphone, au travers de
// adb reverse. Le relais lui-même est dans packages/audio/src/relay.ts (testé par le pipeline).
//
// Usage : node infra/local/relay-3g.ts <port d'écoute> <hôte:port cible>
//   ex. : node infra/local/relay-3g.ts 3300 127.0.0.1:3000   (puis adb reverse tcp:3300 tcp:3300)
import { PROFILE_3G, startRelay } from '../../packages/audio/src/relay.ts';

const [listen, target] = process.argv.slice(2);
const [host, port] = (target ?? '').split(':');
if (!listen || !host || !port) {
  console.error('Usage : node infra/local/relay-3g.ts <port d’écoute> <hôte:port cible>');
  process.exit(1);
}
const relay = await startRelay(Number(listen), host, Number(port));
const p = PROFILE_3G;
console.log(
  `Relais 3G sur 127.0.0.1:${relay.port} → ${target} : ${p.downKbps}/${p.upKbps} kbit/s, ` +
    `${p.rttMs} ms d’aller-retour, ${p.handshakeRtts} allers-retours d’établissement (Ctrl+C pour arrêter).`,
);
