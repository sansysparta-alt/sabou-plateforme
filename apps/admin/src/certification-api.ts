import type {
  ConsolidationItem,
  DossierDecision,
  DossierDecisionResult,
  FieldVerificationItem,
  ZonePage,
} from '@sabou/types';
import { call } from './accounts-api';

// Appels du workflow de certification (US-042, US-043). La zone ne figure dans aucun appel : l'API
// la lit en base pour le compte connecté.

export const listFieldVerification = (after?: string) =>
  call<ZonePage<FieldVerificationItem>>(
    `/api/dossiers/verification-terrain${after ? `?apres=${encodeURIComponent(after)}` : ''}`,
  );

export const listConsolidation = (after?: string) =>
  call<ZonePage<ConsolidationItem>>(
    `/api/dossiers/consolidation${after ? `?apres=${encodeURIComponent(after)}` : ''}`,
  );

export const decideDossier = (code: string, decision: DossierDecision) =>
  call<DossierDecisionResult>(`/api/dossiers/${encodeURIComponent(code)}/decision`, decision);
