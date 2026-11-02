// Service worker de la page « Vérifier un certificat » (prototype US-006), limité à
// /verifier : il garde la page, son code et les clés publiques pour vérifier hors ligne.
// Le service worker du site entier viendra avec les récits hors ligne du site public.
const CACHE = 'sabou-verifier-v1';
const PAGE = '/verifier';
const KEYS = '/cles-certificats.json';
// Au-delà, on sert la copie gardée : sur un réseau très faible, attendre ne sert à rien
const NETWORK_TIMEOUT_MS = 3000;

// Fichiers statiques de Next.js cités par la page (noms à empreinte, donc immuables)
function staticAssets(html) {
  const urls = html.match(/\/_next\/static\/[^"'\s\\)]+/g) ?? [];
  return [...new Set(urls)];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const page = await fetch(PAGE, { cache: 'no-cache' });
      if (!page.ok) throw new Error(`Page ${PAGE} : ${page.status}`);
      const html = await page.clone().text();
      await cache.put(PAGE, page);
      await cache.addAll([KEYS, ...staticAssets(html)]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('sabou-verifier-') && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

// Réseau d'abord (page à jour, révocations de clés), copie gardée si le réseau manque
async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('délai dépassé')), NETWORK_TIMEOUT_MS),
      ),
    ]);
    if (response.ok) await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === PAGE && event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, PAGE));
  } else if (url.pathname === KEYS) {
    event.respondWith(networkFirst(event.request, KEYS));
  } else if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(event.request));
  }
});
