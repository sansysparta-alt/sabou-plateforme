import type {
  FieldDossier,
  FieldDossierCreateInput,
  FieldDossierDesignations,
  FieldDossierReferentials,
  PractitionerPieceType,
  SubmissionReceipt,
} from '@sabou/types';
import { call } from './accounts-api';

// Dossier terrain de l'admin préfectoral (US-040c). La préfecture ne figure dans aucun appel :
// l'API la lit en base pour le compte connecté.
const BASE = '/api/dossiers-terrain';
const dossierPath = (code: string) => `${BASE}/${encodeURIComponent(code)}`;

export const fetchFieldReferentials = () => call<FieldDossierReferentials>(`${BASE}/referentiels`);
export const listFieldDossiers = () => call<FieldDossier[]>(BASE);
export const openFieldDossier = (input: FieldDossierCreateInput) =>
  call<{ code: string }>(BASE, input);
export const addFieldPiece = (code: string, type: PractitionerPieceType, file: File) =>
  call<{ id: number }>(`${dossierPath(code)}/pieces/${type}`, file);
export const removeFieldPiece = (code: string, id: number) =>
  call<void>(`${dossierPath(code)}/pieces/${id}`, undefined, 'DELETE');
export const submitFieldDossier = (code: string) =>
  call<SubmissionReceipt>(`${dossierPath(code)}/soumission`, {});

// US-040d : agent de vérification désigné par l'admin régional
export const listDesignations = () => call<FieldDossierDesignations>(`${BASE}/designations`);
export const designateVerifier = (code: string, agentId: number) =>
  call<void>(`${dossierPath(code)}/verificateur`, { agentId });
