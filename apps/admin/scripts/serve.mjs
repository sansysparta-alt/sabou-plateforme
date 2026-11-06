// Serveur de l'application compilée pour les tests (US-010), au plus près du serveur frontal
// de production : fichiers compressés (Brotli ou gzip), cache long des fichiers versionnés,
// en-têtes de sécurité, et /auth relayé vers l'API sous la même origine.
//   node scripts/serve.mjs        (dist/ doit exister : pnpm build)
import { createServer, request } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const port = Number(process.env.ADMIN_PORT ?? 5173);
const apiPort = Number(process.env.API_PORT ?? 4000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

const HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

// Fichiers lus et compressés une fois au démarrage
const files = new Map();
function load(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      load(path);
      continue;
    }
    const body = readFileSync(path);
    files.set(`/${relative(dist, path).replaceAll('\\', '/')}`, {
      type: TYPES[extname(path)] ?? 'application/octet-stream',
      raw: body,
      br: brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
      gzip: gzipSync(body, { level: 9 }),
    });
  }
}
load(dist);

function proxy(req, res) {
  // Premier mandataire : l'IP du client (journal d'audit, US-030) est celle de la connexion,
  // jamais un en-tête X-Forwarded-For ou Forwarded envoyé par le client lui-même
  const headers = { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress ?? '' };
  delete headers.forwarded;
  const upstream = request(
    { host: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    res.writeHead(502).end();
  });
  req.pipe(upstream);
}

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path === '/auth' || path.startsWith('/auth/')) return proxy(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
  // Application à page unique : toute adresse inconnue reçoit index.html
  const file = files.get(path) ?? files.get('/index.html');
  const accept = String(req.headers['accept-encoding'] ?? '');
  const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : undefined;
  res.writeHead(200, {
    ...HEADERS,
    'content-type': file.type,
    // Fichiers versionnés par leur empreinte : cache d'un an ; index.html toujours revalidé
    'cache-control': path.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    vary: 'accept-encoding',
    ...(encoding ? { 'content-encoding': encoding } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : encoding ? file[encoding] : file.raw);
}).listen(port, '127.0.0.1', () => {
  console.log(`Application de gestion servie sur http://localhost:${port}`);
});
