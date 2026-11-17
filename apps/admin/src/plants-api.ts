import type {
  PlantDetail,
  PlantFields,
  PlantImageFields,
  PlantSummary,
  PlantUpdate,
} from '@sabou/types';
import { call } from './accounts-api';

// Fiches plantes du Dictionnaire (US-050) : DG et Comité scientifique
const BASE = '/api/plantes';
const plantPath = (code: string) => `${BASE}/${encodeURIComponent(code)}`;

export const listPlants = (q = '') =>
  call<PlantSummary[]>(q ? `${BASE}?q=${encodeURIComponent(q)}` : BASE);
export const fetchPlant = (code: string) => call<PlantDetail>(plantPath(code));
export const createPlant = (fields: PlantFields) => call<PlantDetail>(BASE, fields);
export const updatePlant = (code: string, update: PlantUpdate) =>
  call<PlantDetail>(plantPath(code), update, 'PATCH');

// Validation par le Comité scientifique (US-051)
export const validatePlant = (code: string, vueLe: string) =>
  call<PlantDetail>(`${plantPath(code)}/validation`, { vueLe });

// Adresse de la photo, servie par l'API après contrôle des droits
export const plantImageUrl = (code: string, image: number) => `${plantPath(code)}/images/${image}`;

// Le fichier part tel quel ; sa description dans l'adresse
export function addPlantImage(code: string, file: File, fields: PlantImageFields) {
  const query = new URLSearchParams({
    alt: fields.alt,
    type: fields.type,
    principale: String(fields.principale),
    ...(fields.altEn ? { altEn: fields.altEn } : {}),
  });
  return call<PlantDetail>(`${plantPath(code)}/images?${query}`, file);
}

export const updatePlantImage = (code: string, image: number, fields: PlantImageFields) =>
  call<PlantDetail>(`${plantPath(code)}/images/${image}`, fields, 'PATCH');

export const removePlantImage = (code: string, image: number) =>
  call<PlantDetail>(`${plantPath(code)}/images/${image}`, undefined, 'DELETE');
