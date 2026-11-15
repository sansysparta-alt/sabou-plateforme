import type {
  LocalNameCreate,
  LocalNamesPlant,
  LocalNamesPlantSummary,
  RecordingLanguage,
} from '@sabou/types';
import { ApiError, call } from './accounts-api';

// Noms locaux des plantes (US-053) : tout administrateur lit, le référent de la langue écrit
const BASE = '/api/noms-locaux';

export const listRecordingLanguages = () => call<RecordingLanguage[]>(`${BASE}/langues`);
export const searchLocalNamesPlants = (q = '') =>
  call<LocalNamesPlantSummary[]>(
    q ? `${BASE}/plantes?q=${encodeURIComponent(q)}` : `${BASE}/plantes`,
  );
export const fetchLocalNames = (code: string) =>
  call<LocalNamesPlant>(`${BASE}/plantes/${encodeURIComponent(code)}`);
export const addLocalName = (input: LocalNameCreate) => call<LocalNamesPlant>(BASE, input);
export const makeLocalNamePrincipal = (id: number) =>
  call<LocalNamesPlant>(`${BASE}/${id}/principal`, {});
export const removeLocalName = (id: number) =>
  call<LocalNamesPlant>(`${BASE}/${id}`, undefined, 'DELETE');

// Voix du nom (US-070) : déposée telle quelle, puis traitée en tâche de fond par l'API
interface VoiceDeposit {
  depot: number;
  statut: 'en_attente' | 'en_cours' | 'traitee' | 'echec';
  erreur: string | null;
}

export const VOICE_POLL_MS = 2000;
// Traitement d'une voix de quelques secondes : bien moins d'une minute sur le serveur
export const VOICE_WAIT_MS = 90_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Dépose la voix et attend son traitement ; renvoie le numéro du dépôt traité
export async function depositVoice(file: File, consent: boolean): Promise<number> {
  let state = await call<VoiceDeposit>(`/api/voix?consentement=${consent}`, file);
  const deadline = Date.now() + VOICE_WAIT_MS;
  while (state.statut === 'en_attente' || state.statut === 'en_cours') {
    if (Date.now() > deadline) {
      throw new ApiError(0, 'Le traitement de la voix prend du temps. Réessayez dans un moment.');
    }
    await wait(VOICE_POLL_MS);
    state = await call<VoiceDeposit>(`/api/voix/depots/${state.depot}`);
  }
  if (state.statut === 'echec') {
    throw new ApiError(0, state.erreur ?? 'La voix n’a pas pu être traitée.');
  }
  return state.depot;
}
