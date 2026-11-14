// Données demandées en avance (US-017). En 3G, chaque aller-retour coûte 300 ms : au lieu
// d'attendre que le morceau de la page soit téléchargé pour demander ses données, l'application
// les demande dès que la session est connue, en même temps que le morceau. La page les reçoit
// ensuite par call(), sans rien changer à son code.
//
// Seules des lectures sont demandées en avance (GET, ou la consultation d'une invitation, sans
// effet). Une réponse n'est servie qu'une fois, et seulement dans les secondes qui suivent :
// tout appel ultérieur (rechargement après une décision…) repart vers l'API.

const MAX_AGE_MS = 10_000;

interface Pending {
  response: Promise<Response>;
  at: number;
}

const pending = new Map<string, Pending>();

export function requestKey(method: string, path: string, body?: string): string {
  return body === undefined ? `${method} ${path}` : `${method} ${path} ${body}`;
}

// Lance la requête ; une erreur réseau sera rendue à la page qui la reprend
export function prefetch(path: string, init?: { method: 'POST'; body: unknown }): void {
  const body = init ? JSON.stringify(init.body) : undefined;
  const key = requestKey(init?.method ?? 'GET', path, body);
  if (pending.has(key)) return;
  const response = fetch(path, {
    method: init?.method ?? 'GET',
    credentials: 'same-origin',
    headers: init ? { 'content-type': 'application/json' } : {},
    body,
  });
  // Rejet observé ici aussi : une requête jamais reprise ne lève pas d'erreur non traitée
  response.catch(() => undefined);
  pending.set(key, { response, at: Date.now() });
}

// Reprend une requête lancée en avance, une seule fois et tant qu'elle est récente
export function takePrefetched(key: string): Promise<Response> | undefined {
  const entry = pending.get(key);
  if (!entry) return undefined;
  pending.delete(key);
  return Date.now() - entry.at <= MAX_AGE_MS ? entry.response : undefined;
}

// Pour les tests : oublie toute requête en attente
export function clearPrefetched(): void {
  pending.clear();
}
