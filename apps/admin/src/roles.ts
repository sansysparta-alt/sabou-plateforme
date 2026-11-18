import type { BadgeTone } from '@sabou/ui';
import type { AccountRole, AccountStatus } from '@sabou/types';

// Libellés définis ici plutôt qu'importés de @sabou/types : l'application n'en importe que
// des types, pour ne pas embarquer zod dans le paquet téléchargé (réseau 3G)
export const ROLE_LABELS: Record<AccountRole, string> = {
  dg: 'Direction Générale',
  regional: 'Administrateur régional',
  prefectoral: 'Administrateur préfectoral',
  scientifique: 'Comité scientifique',
};

export const ROLES = Object.keys(ROLE_LABELS) as AccountRole[];
// Rôles proposés à l'invitation : un seul compte DG (US-024), jamais invité
export const INVITABLE_ROLES = ROLES.filter((role) => role !== 'dg');

export const STATUS_LABELS: Record<AccountStatus, string> = {
  invite: 'Invitation en attente',
  actif: 'Actif',
  suspendu: 'Suspendu',
};

// Couleur de la pastille d'état ; le libellé dit toujours l'état (la couleur seule ne suffit pas)
export const BADGE_TONES: Record<AccountStatus, BadgeTone> = {
  invite: 'warning',
  actif: 'success',
  suspendu: 'error',
};
