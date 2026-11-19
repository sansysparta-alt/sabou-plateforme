import { storedPageSize } from '@sabou/ui';

// Files de dossiers à décider (étapes 2 à 5), paginées par l'API (US-019b) : adresse de chaque
// file et adresse d'une page. Module sans dépendance lourde : l'application le charge dès le
// démarrage pour demander la première page en avance (US-017), exactement comme l'écran la
// demandera ensuite (même taille de page, mémorisée par file).

export const QUEUES = {
  fieldVerification: '/api/dossiers/verification-terrain',
  consolidation: '/api/dossiers/consolidation',
  expertise: '/api/dossiers/expertise',
  approval: '/api/dossiers/approbation',
  // US-061 : traitements qui attendent la décision du compte connecté
  treatments: '/api/traitements/a-decider',
  // US-100 : signalements ouverts, graves en tête (Comité scientifique)
  healthReports: '/api/signalements/a-traiter',
} as const;
export type QueuePath = (typeof QUEUES)[keyof typeof QUEUES];

// Nom de la liste pour la taille de page mémorisée : « file-consolidation »…
export const queueKey = (path: QueuePath) => `file-${path.slice(path.lastIndexOf('/') + 1)}`;

// Page `page` (à partir de 0) de `size` dossiers, parmi ceux que trouve la recherche `q`
// (code du dossier ou nom du praticien)
export function queuePagePath(path: QueuePath, page: number, size: number, q = ''): string {
  const query = new URLSearchParams({ limite: String(size) });
  if (page > 0) query.set('decalage', String(page * size));
  if (q) query.set('q', q);
  return `${path}?${query}`;
}

// Première page, à la taille mémorisée : ce que l'écran demande à son ouverture
export const firstQueuePagePath = (path: QueuePath) =>
  queuePagePath(path, 0, storedPageSize(queueKey(path)));
