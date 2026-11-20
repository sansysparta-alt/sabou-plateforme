import type { ExportEntry, ExportRequest, MonthlyReport, MonthlyReportList } from '@sabou/types';
import { call } from './accounts-api';

// Rapports mensuels et exports (US-091) : appels de l'API de gestion

export const REPORTS_PATH = '/api/rapports-mensuels';
export const EXPORTS_PATH = '/api/exports';

export const fetchReports = () => call<MonthlyReportList>(REPORTS_PATH);
export const fetchReport = (id: number) => call<MonthlyReport>(`${REPORTS_PATH}/${id}`);
export const prepareReport = (mois: string) => call<{ id: number }>(REPORTS_PATH, { mois });
export const commentReport = (id: number, commentaire: string) =>
  call<void>(`${REPORTS_PATH}/${id}/commentaire`, { commentaire }, 'PATCH');
export const sendReport = (id: number, calculeLe: string) =>
  call<void>(`${REPORTS_PATH}/${id}/envoi`, { calculeLe });
export const returnReport = (id: number, motif: string) =>
  call<void>(`${REPORTS_PATH}/${id}/renvoi`, { motif });

export const fetchExports = () => call<ExportEntry[]>(EXPORTS_PATH);
export const exportFileUrl = (id: number) => `${EXPORTS_PATH}/${id}/fichier`;

// Crée l'export (photographie gardée en base), puis lance le téléchargement du fichier
export async function downloadExport(
  request: ExportRequest,
  open: (url: string) => void = (url) => window.location.assign(url),
): Promise<void> {
  const { id } = await call<{ id: number }>(EXPORTS_PATH, request);
  open(exportFileUrl(id));
}
