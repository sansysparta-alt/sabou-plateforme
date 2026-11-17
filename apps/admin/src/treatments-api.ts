import type {
  DecidableStatus,
  TreatmentDecisionResult,
  TreatmentQueueItem,
  ZonePage,
} from '@sabou/types';
import { call } from './accounts-api';
import { QUEUES, queuePagePath } from './queues';

// Circuit d'un traitement (US-061). La zone et le rôle ne figurent dans aucun appel : l'API les
// lit en base pour le compte connecté.

export const listTreatments = (page: number, size: number, q?: string) =>
  call<ZonePage<TreatmentQueueItem>>(queuePagePath(QUEUES.treatments, page, size, q));

// « avance » : étape suivante ; « renvoi » : étape précédente, avec motif
export const decideTreatment = (
  code: string,
  statut: DecidableStatus,
  decision: 'avance' | 'renvoi',
  motif?: string,
) =>
  call<TreatmentDecisionResult>(`/api/traitements/${encodeURIComponent(code)}/decision`, {
    statut,
    decision,
    ...(motif !== undefined ? { motif } : {}),
  });
