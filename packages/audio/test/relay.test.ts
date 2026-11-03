// Le relais 3G applique bien le profil : établissement de connexion compté, débit et latence.
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROFILE_3G, startRelay, type Relay } from '../src/relay.ts';

const BODY_BYTES = 100_000;
let origin: Server;
let relay: Relay;

beforeAll(async () => {
  const body = Buffer.alloc(BODY_BYTES, 7);
  origin = createServer((_, response) => {
    response.writeHead(200, { 'Content-Length': BODY_BYTES, Connection: 'close' });
    response.end(body);
  });
  await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
  relay = await startRelay(0, '127.0.0.1', originPort());
});

afterAll(async () => {
  await relay.close();
  origin.close();
});

describe('Relais 3G (400 kbit/s, 400 ms d’aller-retour)', () => {
  it('premier octet après 3 allers-retours (TCP, TLS, requête), téléchargement au débit du lien', async () => {
    const started = performance.now();
    const response = await fetch(`http://127.0.0.1:${relay.port}/`);
    const firstByteMs = performance.now() - started;
    const body = new Uint8Array(await response.arrayBuffer());
    const totalMs = performance.now() - started;

    expect(body.length).toBe(BODY_BYTES);
    const rtt = PROFILE_3G.rttMs;
    // 2 allers-retours d'établissement + 1 pour la requête et la réponse
    expect(firstByteMs).toBeGreaterThanOrEqual(3 * rtt - 20);
    expect(firstByteMs).toBeLessThan(3 * rtt + 400);
    // 100 Ko à 400 kbit/s : 2 s de transfert au moins, en plus de l'établissement
    const transferMs = (BODY_BYTES * 8) / PROFILE_3G.downKbps;
    expect(totalMs).toBeGreaterThanOrEqual(3 * rtt + transferMs - 50);
    expect(totalMs).toBeLessThan(3 * rtt + transferMs + 800);
  });
});

describe('Relais : fin de flux', () => {
  // La fin de flux partait parfois avant les derniers paquets : corps tronqué, test instable
  it('remet le corps entier avant de fermer, transfert après transfert', async () => {
    const fast = await startRelay(0, '127.0.0.1', originPort(), {
      downKbps: 100_000,
      upKbps: 100_000,
      rttMs: 2,
      handshakeRtts: 0,
    });
    try {
      for (let i = 0; i < 200; i++) {
        const response = await fetch(`http://127.0.0.1:${fast.port}/`);
        expect((await response.arrayBuffer()).byteLength).toBe(BODY_BYTES);
      }
    } finally {
      await fast.close();
    }
  });
});

function originPort(): number {
  const address = origin.address();
  if (typeof address !== 'object' || !address) throw new Error('Serveur sans port');
  return address.port;
}
