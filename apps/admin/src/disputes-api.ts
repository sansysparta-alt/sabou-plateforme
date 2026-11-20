import type {
  DisputeDecisionInput,
  DisputeDetail,
  DisputeOpinionInput,
  DisputeSummary,
  ZonePage,
} from '@sabou/types';
import { call } from './accounts-api';
import { QUEUES, queuePagePath } from './queues';

// Litiges et recours (US-101) : file de la zone, instruction (échanges, pièces), avis du
// régional sur un recours, décision motivée. Qui peut quoi : la base le vérifie.

const disputePath = (code: string) => `/api/litiges/${encodeURIComponent(code)}`;

export const listDisputes = (page: number, size: number, q?: string) =>
  call<ZonePage<DisputeSummary>>(queuePagePath(QUEUES.disputes, page, size, q));

export const fetchDispute = (code: string) => call<DisputeDetail>(disputePath(code));

export const sendDisputeMessage = (code: string, contenu: string) =>
  call<void>(`${disputePath(code)}/messages`, { contenu });

export const addDisputePiece = (code: string, file: File) =>
  call<{ id: number }>(`${disputePath(code)}/pieces`, file);

export const disputePieceUrl = (code: string, id: number) => `${disputePath(code)}/pieces/${id}`;

export const giveDisputeOpinion = (code: string, input: DisputeOpinionInput) =>
  call<void>(`${disputePath(code)}/avis`, input);

export const decideDispute = (code: string, input: DisputeDecisionInput) =>
  call<{ certificat: string | null }>(`${disputePath(code)}/decision`, input);
