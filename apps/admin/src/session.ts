import type { SessionUser } from '@sabou/types';

// Session portée par un cookie HttpOnly posé par l'API (US-010) : l'application ne voit
// jamais de jeton. /auth est servi par la même origine (proxy en développement).

export type { SessionUser };

// La session est préchargée par index.html dès la lecture de la page, en même temps que le
// code de l'application (US-017). Pour que le navigateur reprenne ce préchargement, la requête
// doit être identique : mode « cors » avec identifiants (« include », même origine ici).
export async function fetchSession(): Promise<SessionUser | null> {
  const response = await fetch('/auth/session', { credentials: 'include' });
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

// Gestion des comptes réservée à la Direction Générale (UC-65), vérifiée aussi par l'API
export function isDirector(user: SessionUser): boolean {
  return user.roles.includes('dg');
}

// Vérification terrain (étape 2) réservée à l'admin préfectoral (R-CER-02) ; la base contrôle
// aussi qu'il est responsable de l'étape et de la préfecture du dossier
export function isPrefectoral(user: SessionUser): boolean {
  return user.roles.includes('admin_prefectoral');
}

// Consolidation (étape 3) réservée à l'admin régional (R-CER-02, décision du maître d'œuvre du
// 12 novembre 2026 : ni la DG ni un autre profil) ; la base contrôle aussi la région du dossier
export function isRegional(user: SessionUser): boolean {
  return user.roles.includes('admin_regional');
}

// Expertise (étape 4) réservée au Comité scientifique (R-CER-01) ; la base le contrôle aussi
export function isCommittee(user: SessionUser): boolean {
  return user.roles.includes('comite');
}

// L'application de gestion sert les 4 profils d'administration et les praticiens
export function hasManagementAccess(user: SessionUser): boolean {
  return user.administrator || user.roles.includes('praticien');
}

export const LOGIN_ERRORS: Record<string, string> = {
  connexion: 'La connexion n’a pas abouti. Veuillez réessayer.',
  annulee: 'La connexion a été annulée.',
  // Juste après l'activation, le code est demandé aussitôt (§2.28) : ce refus est un vrai échec
  'double-facteur':
    'Les administrateurs se connectent avec le code de leur application d’authentification. Reconnectez-vous et saisissez le code affiché.',
};
