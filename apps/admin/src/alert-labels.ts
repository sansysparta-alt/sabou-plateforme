import type { AlertStatus, AlertType } from '@sabou/types';

// Libellés des alertes territoriales (US-102), partagés par la page des alertes et le tableau
// de bord (US-090) : un petit module à part, pour ne pas charger la page entière avec l'accueil

export const ALERT_TYPE: Record<AlertType, string> = {
  hausse_pathologie: 'Hausse de pathologie',
  desert_therapeutique: 'Désert thérapeutique',
  dossier_bloque: 'Dossier bloqué',
};

export const ALERT_STATUS: Record<
  AlertStatus,
  { label: string; tone: 'warning' | 'error' | 'neutral' }
> = {
  nouvelle: { label: 'Nouvelle', tone: 'warning' },
  relancee: { label: 'Relancée', tone: 'error' },
  accusee: { label: 'Reçue', tone: 'neutral' },
  close: { label: 'Close', tone: 'neutral' },
};
