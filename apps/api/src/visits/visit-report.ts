import { createHash } from 'node:crypto';
import type { VisitOpinion } from '@sabou/types';

// Empreinte du compte rendu de visite signé (US-041, décision du 12 novembre 2026). SHA3-256,
// comme celle des certificats (R-QR-02), calculée sur un texte canonique : version du
// format, dossier, visite, date, avis, auteur, puis les constats tels qu'enregistrés. Chacune
// de ces données est gardée en base : l'empreinte se recalcule pour prouver que le texte
// n'a pas changé depuis la signature.

export const REPORT_FORMAT = 'SABOU compte rendu de visite v1';

export interface VisitReportContent {
  dossier: string;
  visite: number;
  // Date de la visite, heure de Conakry : 2026-11-13
  realiseeLe: string;
  avis: VisitOpinion;
  // Identifiant du signataire en base
  auteur: number;
  constats: string;
}

// Texte enregistré : forme Unicode composée (NFC) et fins de ligne Unix, pour qu'un même
// texte saisi sur deux appareils donne la même empreinte
export const normalizeNotes = (text: string): string =>
  text.normalize('NFC').replace(/\r\n?/g, '\n').trim();

export function canonicalReport(content: VisitReportContent): string {
  return [
    REPORT_FORMAT,
    `dossier=${content.dossier}`,
    `visite=${content.visite}`,
    `date=${content.realiseeLe}`,
    `avis=${content.avis}`,
    `auteur=${content.auteur}`,
    'constats=',
    content.constats,
  ].join('\n');
}

export const reportFingerprint = (content: VisitReportContent): string =>
  createHash('sha3-256').update(canonicalReport(content), 'utf8').digest('hex');
