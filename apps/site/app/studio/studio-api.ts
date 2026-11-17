// Studio web du praticien (US-060) : appels à l'API sous la même origine (cookie de session
// HttpOnly, aucun jeton dans la page). Types seulement depuis @sabou/types : la page ne
// télécharge pas zod (réseau 3G) ; l'API valide tout.
import type {
  SectionType,
  StudioReferentials,
  SubmissionGap,
  TreatmentDetail,
  TreatmentFieldsInput,
  TreatmentStatus,
  TreatmentSummary,
  Visibility,
  WaitingReason,
} from '@sabou/types';

export const STATUS_LABELS: Record<TreatmentStatus, string> = {
  brouillon: 'Brouillon',
  soumise: 'Soumis à l’administration régionale',
  transmise: 'Transmis au Comité scientifique',
  expertisee: 'Expertisé, en attente de certification',
  certifiee: 'Certifié',
  suspendue: 'Suspendu',
  retiree: 'Retiré',
};

// Raison d'un traitement resté « expertisé » (US-046) : lue sur le traitement
export const WAITING_LABELS: Record<WaitingReason, string> = {
  quota:
    'La formule gratuite est limitée à 3 traitements certifiés : celui-ci sera certifié au passage à la formule GOLD.',
  contenu:
    'Une plante n’est pas encore validée par le Comité scientifique, ou une section est à compléter.',
};

export const GAP_LABELS: Record<SubmissionGap, string> = {
  consentement: 'votre consentement et le niveau de visibilité',
  plante: 'au moins une plante',
  cycle: 'la durée du cycle et le nombre de prises par jour',
  sections: 'les 4 sections obligatoires',
};

export const VISIBILITY_LABELS: Record<Visibility, { label: string; help: string }> = {
  publique: { label: 'Publique', help: 'Visible de tous sur le site, une fois certifié.' },
  restreinte: { label: 'Restreinte', help: 'Visible des seules personnes connectées.' },
  privee: { label: 'Privée', help: 'Visible de vous et des administrateurs seulement.' },
};

export type { SectionType };

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error?: string; message?: string; gaps?: SubmissionGap[] };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/praticien/${path}`, {
      cache: 'no-store',
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (response.ok) return { ok: true, data: (await response.json()) as T };
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string | string[];
    gaps?: SubmissionGap[];
  };
  return {
    ok: false,
    status: response.status,
    error: body.error,
    message: Array.isArray(body.message) ? body.message[0] : body.message,
    gaps: body.gaps,
  };
}

export const studioApi = {
  referentials: () => request<StudioReferentials>('studio/referentiels', { cache: 'default' }),
  list: () => request<TreatmentSummary[]>('traitements'),
  detail: (code: string) => request<TreatmentDetail>(`traitements/${encodeURIComponent(code)}`),
  create: (fields: TreatmentFieldsInput) =>
    request<TreatmentDetail>('traitements', { method: 'POST', body: JSON.stringify(fields) }),
  update: (code: string, vueLe: string, fields: TreatmentFieldsInput) =>
    request<TreatmentDetail>(`traitements/${encodeURIComponent(code)}`, {
      method: 'PUT',
      body: JSON.stringify({ vueLe, fields }),
    }),
  submit: (code: string) =>
    request<TreatmentDetail>(`traitements/${encodeURIComponent(code)}/soumission`, {
      method: 'POST',
    }),
};

// Message commun aux erreurs d'accès et de réseau
export function accessMessage(status: number): string | null {
  if (status === 0) return 'Le Studio ne répond pas. Vérifiez votre réseau, puis réessayez.';
  if (status === 403) return 'Le Studio est réservé aux praticiens.';
  return null;
}
