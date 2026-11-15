import type {
  ApprovalItem,
  ApprovalResult,
  CertificationFunnel,
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
import { QUEUES, queuePagePath } from './queues';

// Appels du workflow de certification (US-042 à US-044). La zone ne figure dans aucun appel : l'API
// la lit en base pour le compte connecté.

export const listFieldVerification = (page: number, size: number) =>
  call<ZonePage<FieldVerificationItem>>(queuePagePath(QUEUES.fieldVerification, page, size));

export const listConsolidation = (page: number, size: number) =>
  call<ZonePage<ConsolidationItem>>(queuePagePath(QUEUES.consolidation, page, size));

export const listExpertise = (page: number, size: number) =>
  call<ZonePage<ExpertiseItem>>(queuePagePath(QUEUES.expertise, page, size));

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
export const listApproval = (page: number, size: number) =>
  call<ZonePage<ApprovalItem>>(queuePagePath(QUEUES.approval, page, size));

export const approveDossier = (code: string) =>
  call<ApprovalResult>(`/api/dossiers/${encodeURIComponent(code)}/approbation`, {});

export const fetchCertificate = (numero: string) =>
  call<CertificateView>(`/api/certificats/${encodeURIComponent(numero)}`);

// Entonnoir des 6 étapes et dossiers bloqués (US-048)
export const fetchFunnel = () => call<CertificationFunnel>('/api/entonnoir');

// Rejet définitif d'un praticien par la DG (US-047)
export const searchPractitioners = (q: string) =>
  call<RejectionCandidate[]>(`/api/praticiens/recherche?q=${encodeURIComponent(q)}`);

export const rejectPractitioner = (code: string, rejection: Rejection) =>
  call<RejectionResult>(`/api/praticiens/${encodeURIComponent(code)}/rejet-definitif`, rejection);
