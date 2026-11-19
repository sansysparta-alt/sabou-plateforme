import type {
  HealthReportDecision,
  HealthReportItem,
  SuspendedTreatment,
  ZonePage,
} from '@sabou/types';
import { call } from './accounts-api';
import { QUEUES, queuePagePath } from './queues';

// Signalements de danger et d'effets indésirables (US-100) : file et décisions du Comité,
// traitements suspendus. Le rôle est vérifié par la base.

export const listHealthReports = (page: number, size: number, q?: string) =>
  call<ZonePage<HealthReportItem>>(queuePagePath(QUEUES.healthReports, page, size, q));

export const decideHealthReport = (
  reference: string,
  decision: HealthReportDecision,
  motif: string,
) => call<void>(`/api/signalements/${encodeURIComponent(reference)}/decision`, { decision, motif });

export const SUSPENDED_PATH = '/api/signalements/suspendus';
export const listSuspendedTreatments = () => call<SuspendedTreatment[]>(SUSPENDED_PATH);

export const liftSuspension = (code: string, motif: string) =>
  call<void>(`${SUSPENDED_PATH}/${encodeURIComponent(code)}/levee`, { motif });
