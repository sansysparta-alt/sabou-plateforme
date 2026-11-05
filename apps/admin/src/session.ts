import type { SessionUser } from '@sabou/types';

// Session portée par un cookie HttpOnly posé par l'API (US-010) : l'application ne voit
// jamais de jeton. /auth est servi par la même origine (proxy en développement).

export type { SessionUser };

export async function fetchSession(): Promise<SessionUser | null> {
  const response = await fetch('/auth/session', { credentials: 'same-origin' });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Session : statut ${response.status}`);
  return (await response.json()) as SessionUser;
}

export async function logout(): Promise<void> {
  const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Déconnexion : statut ${response.status}`);
}

// Profils du CdC §3, du plus large au plus restreint
const PROFILES: [role: string, label: string][] = [
  ['dg', 'Direction Générale'],
  ['admin_regional', 'Administrateur régional'],
  ['admin_prefectoral', 'Administrateur préfectoral'],
  ['comite', 'Comité scientifique'],
  ['praticien', 'Tradipraticien'],
  ['citoyen', 'Citoyen'],
];

export function profileLabel(user: SessionUser): string {
  return PROFILES.find(([role]) => user.roles.includes(role))?.[1] ?? 'Aucun profil';
}

// L'application de gestion sert les 4 profils d'administration et les praticiens
export function hasManagementAccess(user: SessionUser): boolean {
  return user.administrator || user.roles.includes('praticien');
}

export const LOGIN_ERRORS: Record<string, string> = {
  connexion: 'La connexion n’a pas abouti. Veuillez réessayer.',
  annulee: 'La connexion a été annulée.',
  // Aussi affiché juste après l'activation : la première connexion vérifie le nouveau code
  'double-facteur':
    'Les administrateurs se connectent avec le code de leur application d’authentification. Si vous venez de l’activer, reconnectez-vous et saisissez le code affiché.',
};
