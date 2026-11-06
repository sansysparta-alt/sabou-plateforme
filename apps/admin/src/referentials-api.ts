import type {
  CreateLanguage,
  CreateSpecialty,
  CreateTerritory,
  Referentials,
  TerritoryLevel,
  UpdateLanguage,
  UpdateSpecialty,
} from '@sabou/types';
import { call } from './accounts-api';

// Appels des référentiels (lot C : US-020, US-021)
const BASE = '/api/referentiels';

export const fetchReferentials = () => call<Referentials>(BASE);
export const createLanguage = (input: CreateLanguage) => call<void>(`${BASE}/langues`, input);
export const updateLanguage = (code: string, input: UpdateLanguage) =>
  call<void>(`${BASE}/langues/${encodeURIComponent(code)}`, input, 'PATCH');
export const createTerritory = (level: TerritoryLevel, input: CreateTerritory) =>
  call<void>(`${BASE}/${level}`, input);
export const renameTerritory = (level: TerritoryLevel, id: number, name: string) =>
  call<void>(`${BASE}/${level}/${id}`, { name }, 'PATCH');
export const createSpecialty = (input: CreateSpecialty) => call<void>(`${BASE}/specialites`, input);
export const updateSpecialty = (id: number, input: UpdateSpecialty) =>
  call<void>(`${BASE}/specialites/${id}`, input, 'PATCH');
