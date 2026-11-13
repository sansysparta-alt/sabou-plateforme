import { z } from 'zod';

// Approbation par la DG et certificat signé (US-045, UC-60, R-QR-01 à R-QR-04).

// Numéro d'un certificat : SAB-2026-PR1042-KX7
export const certificateNumberSchema = z
  .string()
  .regex(/^SAB-\d{4}-PR\d{1,10}-[A-Z2-9]{3}$/, 'Numéro de certificat invalide.');

// Dossier en attente d'approbation par la DG (étape 5) ; la DG est nationale
export interface ApprovalItem {
  code: string;
  praticien: string;
  praticienNom: string;
  specialite: string;
  prefecture: string;
  region: string;
  type: 'initial' | 'renouvellement';
  // Arrivée à l'étape 5 (date de l'avis du Comité scientifique)
  expertiseLe: string;
  // Une visite réalisée, avec son compte rendu signé, est enregistrée (R-CER-06)
  visiteRealisee: boolean;
  // Renouvellement : numéro du certificat actif, qui passera « expiré » (R-QR-07)
  certificatActuel: string | null;
}

export interface ApprovalResult {
  code: string;
  // Le dossier attend désormais la publication (étape 6, US-046)
  etape: number;
  certificat: string;
}

// Certificat tel qu'imprimé (page de l'application de gestion, décision du 12 novembre 2026)
export interface CertificateView {
  numero: string;
  statut: 'actif' | 'expire' | 'revoque';
  titulaire: string;
  praticien: string;
  specialite: string;
  prefecture: string;
  autorite: string;
  emisLe: string;
  expireLe: string;
  dossier: string;
  // Empreinte SHA3-256 (64 caractères hexadécimaux) et identifiant de la clé de signature
  empreinte: string;
  cle: string;
  // QR en SVG, prêt à afficher ; null pour un certificat fictif du jeu d'exemple
  qrSvg: string | null;
}
