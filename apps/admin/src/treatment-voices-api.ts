import type {
  TreatmentSectionType,
  TreatmentVoices,
  TreatmentVoiceTarget,
  VoiceCoverage,
  VoicePublication,
} from '@sabou/types';
import { call } from './accounts-api';

// Voix des sections des traitements (US-075, puis US-072 à US-074)
const BASE = '/api/voix-des-traitements';
const sectionPath = (code: string, type: TreatmentSectionType) =>
  `${BASE}/${encodeURIComponent(code)}/${type}`;
const voicePath = (code: string, type: TreatmentSectionType, langue: string) =>
  `${sectionPath(code, type)}/${encodeURIComponent(langue)}`;

// Couverture vocale et publication groupée de la DG (US-074)
export const fetchVoiceCoverage = () => call<VoiceCoverage>(`${BASE}/couverture`);
export const publishVoices = (langue: string | null) =>
  call<VoicePublication>(`${BASE}/publication`, { langue });
export const listTreatmentVoiceTargets = () => call<TreatmentVoiceTarget[]>(BASE);
export const fetchTreatmentVoices = (code: string) =>
  call<TreatmentVoices>(`${BASE}/${encodeURIComponent(code)}`);
export const reviseTreatmentSection = (
  code: string,
  type: TreatmentSectionType,
  texteFr: string,
  texteEn: string | null,
) => call<TreatmentVoices>(sectionPath(code, type), { texteFr, texteEn }, 'PATCH');
export const recordTreatmentVoice = (
  code: string,
  type: TreatmentSectionType,
  langue: string,
  depot: number,
) => call<TreatmentVoices>(voicePath(code, type, langue), { depot });
export const moveTreatmentVoice = (
  code: string,
  type: TreatmentSectionType,
  langue: string,
  vers: 'traduit' | 'valide' | 'brouillon' | 'controle' | 'controle_refuse',
  motif: string | null = null,
) => call<TreatmentVoices>(`${voicePath(code, type, langue)}/statut`, { vers, motif });

// Adresse de l'écoute, servie par l'API après contrôle de la session
export const treatmentVoiceAudioUrl = (
  code: string,
  type: TreatmentSectionType,
  langue: string,
  fallback = false,
) => `${voicePath(code, type, langue)}/audio${fallback ? '?format=aac' : ''}`;

// US-081 : écoute du nom d'une plante dit par le praticien (préfectoral, Comité)
export const treatmentPlantVoiceAudioUrl = (code: string, plante: string, fallback = false) =>
  `${BASE}/${encodeURIComponent(code)}/plante/${encodeURIComponent(plante)}/audio${
    fallback ? '?format=aac' : ''
  }`;
