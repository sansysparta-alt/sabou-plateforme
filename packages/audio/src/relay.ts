// Relais TCP qui impose un réseau 3G lent entre un client et un serveur (US-005).
// Profil par défaut (bloquant dans le pipeline, décision du maître d'œuvre) :
// 400 kbit/s en réception et en envoi, 400 ms d'aller-retour.
// L'établissement de la connexion est compté : avant la première requête, le relais retient
// les données du client pendant 2 allers-retours (poignée de main TCP puis TLS 1.3), comme
// sur une vraie connexion HTTPS. C'est pourquoi on n'utilise pas le bridage de Chromium.
//
// Lancement à la main : node infra/local/relay-3g.ts (voir ce fichier).
import { createServer, connect, type Server, type Socket } from 'node:net';

export interface NetworkProfile {
  downKbps: number;
  upKbps: number;
  rttMs: number;
  /** Allers-retours avant la première requête : 1 (TCP) + 1 (TLS 1.3) */
  handshakeRtts: number;
}

export const PROFILE_3G: NetworkProfile = {
  downKbps: 400,
  upKbps: 400,
  rttMs: 400,
  handshakeRtts: 2,
};

// Paquets de la taille d'une trame Ethernet : le débit est lissé comme sur un vrai lien
const PACKET_BYTES = 1460;

/**
 * Une direction du lien : chaque paquet part après le délai de propagation (demi
 * aller-retour) et après le précédent, au débit du lien.
 */
class Link {
  private nextFreeAt = 0;
  private readonly kbps: number;
  private readonly oneWayMs: number;
  private readonly destination: Socket;
  bytesDelivered = 0;

  constructor(kbps: number, oneWayMs: number, destination: Socket) {
    this.kbps = kbps;
    this.oneWayMs = oneWayMs;
    this.destination = destination;
  }

  send(chunk: Buffer, notBefore: number): void {
    for (let offset = 0; offset < chunk.length; offset += PACKET_BYTES) {
      const packet = chunk.subarray(offset, offset + PACKET_BYTES);
      const transmitMs = (packet.length * 8) / this.kbps;
      const start = Math.max(Date.now(), notBefore, this.nextFreeAt);
      this.nextFreeAt = start + transmitMs;
      const deliverAt = this.nextFreeAt + this.oneWayMs;
      setTimeout(() => {
        if (this.destination.destroyed) return;
        this.destination.write(packet);
        this.bytesDelivered += packet.length;
      }, deliverAt - Date.now());
    }
  }

  /** Fin de flux transmise après le dernier paquet */
  end(): void {
    const at = Math.max(Date.now(), this.nextFreeAt) + this.oneWayMs;
    setTimeout(() => this.destination.end(), at - Date.now());
  }
}

export interface Relay {
  server: Server;
  port: number;
  /** Octets remis au client depuis le démarrage (toutes connexions) */
  bytesToClients(): number;
  close(): Promise<void>;
}

export function startRelay(
  listenPort: number,
  targetHost: string,
  targetPort: number,
  profile: NetworkProfile = PROFILE_3G,
): Promise<Relay> {
  const links: Link[] = [];
  const server = createServer((client) => {
    const acceptedAt = Date.now();
    const upstream = connect(targetPort, targetHost);
    const up = new Link(profile.upKbps, profile.rttMs / 2, upstream);
    const down = new Link(profile.downKbps, profile.rttMs / 2, client);
    links.push(down);
    const handshakeDone = acceptedAt + profile.handshakeRtts * profile.rttMs;
    // Sans encodage défini, les sockets livrent des Buffer
    client.on('data', (chunk: Buffer) => up.send(chunk, handshakeDone));
    upstream.on('data', (chunk: Buffer) => down.send(chunk, 0));
    client.on('end', () => up.end());
    upstream.on('end', () => down.end());
    const destroyBoth = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', destroyBoth);
    upstream.on('error', destroyBoth);
    client.on('close', () => upstream.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : listenPort,
        bytesToClients: () => links.reduce((sum, link) => sum + link.bytesDelivered, 0),
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.unref();
          }),
      });
    });
  });
}
