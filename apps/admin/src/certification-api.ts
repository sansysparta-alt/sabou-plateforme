import type {
  ApprovalItem,
  ApprovalResult,
  CertificateView,
  ConsolidationItem,
  DossierDecision,
  DossierDecisionResult,
  ExpertiseItem,
  FieldVerificationItem,
  FieldVisit,
  FieldVisitPlan,
  FieldVisitReport,
  Rejection,
  RejectionCandidate,
  RejectionResult,
  ZonePage,
} from '@sabou/types';
import { call } from './accounts-api';

// Appels du workflow de certification (US-042 à US-044). La zone ne figure dans aucun appel : l'API
// la lit en base pour le compte connecté.

export const listFieldVerification = (after?: string) =>
  call<ZonePage<FieldVerificationItem>>(
    `/api/dossiers/verification-terrain${after ? `?apres=${encodeURIComponent(after)}` : ''}`,
  );

export const listConsolidation = (after?: string) =>
  call<ZonePage<ConsolidationItem>>(
    `/api/dossiers/consolidation${after ? `?apres=${encodeURIComponent(after)}` : ''}`,
  );

export const listExpertise = (after?: string) =>
  call<ZonePage<ExpertiseItem>>(
    `/api/dossiers/expertise${after ? `?apres=${encodeURIComponent(after)}` : ''}`,
  );

export const decideDossier = (code: string, decision: DossierDecision) =>
  call<DossierDecisionResult>(`/api/dossiers/${encodeURIComponent(code)}/decision`, decision);

// Visites terrain (US-041)
const visitPath = (code: string) => `/api/dossiers/${encodeURIComponent(code)}/visite`;

export const planVisit = (code: string, plan: FieldVisitPlan) =>
  call<FieldVisit>(visitPath(code), plan);

export const reportVisit = (code: string, report: FieldVisitReport) =>
  call<FieldVisit>(`${visitPath(code)}/compte-rendu`, report);

export const attachVisitPhoto = (code: string, visit: number, file: File) =>
  call<FieldVisit>(`${visitPath(code)}/${visit}/photo`, file);

// Approbation par la DG et certificat signé (US-045)
export const listApproval = (after?: string) =>
  call<ZonePage<ApprovalItem>>(
    `/api/dossiers/approbation${after ? `?apres=${encodeURIComponent(after)}` : ''}`,
  );

export const approveDossier = (code: string) =>
  call<ApprovalResult>(`/api/dossiers/${encodeURIComponent(code)}/approbation`, {});

export const fetchCertificate = (numero: string) =>
  call<CertificateView>(`/api/certificats/${encodeURIComponent(numero)}`);

// Rejet définitif d'un praticien par la DG (US-047)
export const searchPractitioners = (q: string) =>
  call<RejectionCandidate[]>(`/api/praticiens/recherche?q=${encodeURIComponent(q)}`);

export const rejectPractitioner = (code: string, rejection: Rejection) =>
  call<RejectionResult>(`/api/praticiens/${encodeURIComponent(code)}/rejet-definitif`, rejection);
