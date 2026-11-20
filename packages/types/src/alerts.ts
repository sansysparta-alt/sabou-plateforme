import { z } from 'zod';

// Alertes territoriales (US-102, UC-44, R-MOD-04 ; 05 §2.89). Qui voit, déclare, accuse
// réception, relance ou clôt : la base le contrôle (fonctions alerte_*), jamais le client.

export const ALERT_TEXT_MAX_LENGTH = 1000;
export type AlertType = 'hausse_pathologie' | 'desert_therapeutique' | 'dossier_bloque';
export type AlertStatus = 'nouvelle' | 'accusee' | 'relancee' | 'close';

export const alertIdSchema = z.coerce.number().int().positive();

// Hausse de pathologie : préfecture (la sienne pour le préfectoral) et maladie
export const alertDeclareSchema = z
  .object({
    prefectureId: z.number().int().positive('Choisissez la préfecture.'),
    maladie: z.string().regex(/^MA-\d{3,6}$/, 'Choisissez la maladie.'),
    description: z
      .string()
      .trim()
      .min(1, 'Décrivez la hausse constatée.')
      .max(ALERT_TEXT_MAX_LENGTH, `${ALERT_TEXT_MAX_LENGTH} caractères au plus.`),
  })
  .strict();
export type AlertDeclareInput = z.infer<typeof alertDeclareSchema>;

export const alertCloseSchema = z
  .object({
    motif: z
      .string()
      .trim()
      .min(1, 'Indiquez le motif de la clôture.')
      .max(ALERT_TEXT_MAX_LENGTH, `${ALERT_TEXT_MAX_LENGTH} caractères au plus.`),
  })
  .strict();

export interface TerritorialAlert {
  id: number;
  type: AlertType;
  statut: AlertStatus;
  region: string;
  prefecture: string | null;
  maladie: string | null;
  // Dossier bloqué : son code
  dossier: string | null;
  description: string;
  // ISO 8601, UTC
  creeLe: string;
  accuseeLe: string | null;
  relances: number;
  relanceeLe: string | null;
}

// Listes du formulaire de déclaration : préfectures de la zone, maladies du référentiel
export interface AlertReferentials {
  prefectures: { id: number; nom: string }[];
  maladies: { code: string; nomFr: string }[];
}
