import type {
  AccountReferences,
  AccountSummary,
  InvitationLink,
  InvitationPreview,
  InviteRequest,
} from '@sabou/types';

// Appels de la gestion des comptes (lot A). Même origine que l'application : le cookie de
// session suit, et l'en-tête Origin posé par le navigateur protège les décisions.

// Erreur à montrer telle quelle : message rédigé par l'API pour l'utilisateur
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const GENERIC = 'Le service est momentanément indisponible. Veuillez réessayer.';

async function call<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Connexion impossible. Vérifiez votre réseau et réessayez.');
  }
  if (response.ok) {
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
  // Messages des erreurs 4xx rédigés par l'API ; rien n'est montré d'une erreur 5xx
  let message = GENERIC;
  if (response.status < 500) {
    const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
    const text = Array.isArray(payload?.message) ? payload.message.join(' ') : payload?.message;
    if (typeof text === 'string' && text) message = text;
  }
  throw new ApiError(response.status, message);
}

export const listAccounts = () => call<AccountSummary[]>('/api/comptes');
export const fetchReferences = () => call<AccountReferences>('/api/comptes/referentiels');
export const inviteAccount = (request: InviteRequest) =>
  call<InvitationLink>('/api/comptes', request);
export const renewInvitation = (id: number) =>
  call<InvitationLink>(`/api/comptes/${id}/invitation`, {});
export const suspendAccount = (id: number) => call<void>(`/api/comptes/${id}/suspension`, {});
export const reactivateAccount = (id: number) => call<void>(`/api/comptes/${id}/reactivation`, {});
export const previewInvitation = (token: string) =>
  call<InvitationPreview>('/api/invitation/consultation', { token });
export const acceptInvitation = (token: string, password: string) =>
  call<void>('/api/invitation/acceptation', { token, password });
