import type { NameVoiceObject, NameVoices, NameVoiceStatus, NameVoiceTarget } from '@sabou/types';
import { call } from './accounts-api';

// Voix du nom des plantes et des maladies (US-071)
const BASE = '/api/voix-des-noms';
const voicePath = (objet: NameVoiceObject, code: string, langue: string) =>
  `${BASE}/${objet}/${encodeURIComponent(code)}/${encodeURIComponent(langue)}`;

export const listNameVoiceTargets = () => call<NameVoiceTarget[]>(BASE);
export const fetchNameVoices = (objet: NameVoiceObject, code: string) =>
  call<NameVoices>(`${BASE}/${objet}/${encodeURIComponent(code)}`);
export const recordNameVoice = (
  objet: NameVoiceObject,
  code: string,
  langue: string,
  depot: number,
) => call<NameVoices>(voicePath(objet, code, langue), { depot });
export const moveNameVoice = (
  objet: NameVoiceObject,
  code: string,
  langue: string,
  vers: NameVoiceStatus,
  motif: string | null = null,
) => call<NameVoices>(`${voicePath(objet, code, langue)}/statut`, { vers, motif });

// Adresse de l'écoute, servie par l'API après contrôle de la session
export const nameVoiceAudioUrl = (
  objet: NameVoiceObject,
  code: string,
  langue: string,
  fallback = false,
) => `${voicePath(objet, code, langue)}/audio${fallback ? '?format=aac' : ''}`;
