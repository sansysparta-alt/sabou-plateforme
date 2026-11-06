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

export const STATUS_LABELS: Record<AccountStatus, string> = {
  invite: 'Invitation en attente',
  actif: 'Actif',
  suspendu: 'Suspendu',
};
