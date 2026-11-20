import type { AlertStatus, AlertType } from './alerts.js';

// Tableau de bord d'accueil de l'application de gestion (US-016). Tous les chiffres sont ceux
// de la zone du compte connecté : l'API les lit dans le contexte de zone (US-011).

export type DashboardDecision = 'soumis' | 'valide' | 'rejete' | 'rejet_definitif' | 'publie';

// Une transition récente d'un dossier de la zone
export interface DashboardEvent {
  dossier: string;
  praticienNom: string;
  decision: DashboardDecision;
  etape: number;
  // Horodatage ISO 8601 en UTC
  le: string;
}

// SMS non remis au praticien après tous les essais (US-031) : affiché à la DG seule
export interface SmsFailure {
  // Code du dossier concerné (DS-…)
  objet: string;
  destinataire: string;
  // Raison donnée par le fournisseur ou par l'API (ex. « Aucun numéro de téléphone »)
  raison: string;
  // Horodatage ISO 8601 en UTC
  le: string;
}

export interface DashboardSummary {
  // Zone en clair : préfecture, région ou « National »
  zone: string;
  // Praticiens visibles dans la zone (tous statuts)
  praticiens: number;
  // Indicateurs du profil (US-090, CdC §6.2 à §6.5)
  indicateurs: AdminIndicators;
  activite: DashboardEvent[];
  // DG seule (null pour les autres profils) : nombre total d'échecs et les plus récents
  smsNonRemis: { total: number; derniers: SmsFailure[] } | null;
}

// ---------------------------------------------------------------------------------------------
// Indicateurs par profil (US-090). Calculés par la fonction SQL tableau_de_bord(), sous les
// règles RLS de la zone du compte. Les indicateurs dont la donnée n'existe pas encore (revenus,
// vues, écoutes, réputation) n'y figurent pas : le récit qui crée la donnée les ajoute.
// ---------------------------------------------------------------------------------------------

// Direction Générale (§6.2)
export interface DirectorIndicators {
  profil: 'dg';
  certifies: number;
  // Traitements certifiés
  traitements: number;
  // Plantes validées par le Comité
  plantes: number;
  // Certificats actifs et non expirés
  certificats: number;
  // Praticiens certifiés par région active, par ordre alphabétique
  parRegion: { region: string; certifies: number }[];
  // Statut du registre des praticiens
  registre: { enAttente: number; certifies: number; suspendus: number; rejetes: number };
}

// Alerte territoriale ouverte (US-102)
export interface DashboardAlert {
  id: number;
  type: AlertType;
  statut: Exclude<AlertStatus, 'close'>;
  prefecture: string | null;
  description: string;
  // Horodatage ISO 8601 en UTC
  le: string;
}

// Admin régional (§6.3)
export interface RegionalIndicators {
  profil: 'regional';
  praticiens: number;
  // Dossiers consolidés (étape 3 franchie) sur 12 mois glissants
  consolides: number;
  // Litiges non résolus
  litiges: number;
  // Préfectures actives de la région, dont celles qui ont au moins un praticien certifié
  couverture: { prefectures: number; couvertes: number };
  // Dossiers en cours à l'étape 3
  aConsolider: number;
  parPrefecture: {
    prefecture: string;
    aValider: number;
    aConsolider: number;
    consolides: number;
  }[];
  // Alertes ouvertes : total et les plus récentes
  alertes: { total: number; dernieres: DashboardAlert[] };
}

// Admin préfectoral (§6.4)
export interface PrefectoralIndicators {
  profil: 'prefectoral';
  enregistres: number;
  certifies: number;
  // Praticiens en attente de certification
  enAttente: number;
  // Recettes saisies par un agent de terrain (US-082)
  recettesNumerisees: number;
  parSpecialite: { specialite: string; praticiens: number }[];
  // Dossiers à l'étape 2 : total et les plus anciens
  aValider: { total: number; dossiers: { dossier: string; praticien: string; depuis: string }[] };
}

// Comité scientifique (§6.5)
export interface ScientificIndicators {
  profil: 'scientifique';
  // Traitements expertisés sur 12 mois glissants
  expertises: number;
  // Traitements transmis au Comité
  enAttente: number;
  plantes: number;
  plantesEnRevue: number;
  // Signalements sanitaires ouverts (US-100), dont graves
  alertes: number;
  alertesGraves: number;
  // Maladies qui ont le plus de traitements certifiés (5 au plus)
  topPathologies: { maladie: string; traitements: number }[];
  // File d'expertise : total et les plus anciens (date de transmission inconnue en tête)
  file: {
    total: number;
    traitements: { code: string; titre: string; maladie: string; depuis: string | null }[];
  };
}

export type AdminIndicators =
  DirectorIndicators | RegionalIndicators | PrefectoralIndicators | ScientificIndicators;

// Praticien (§6.6), lu par l'application mobile
export type CertificationStepState = 'franchie' | 'en_cours' | 'arretee' | 'a_venir';

export interface PractitionerDashboard {
  profil: 'praticien';
  traitements: { certifies: number; enExamen: number; brouillons: number; suspendus: number };
  // Dernier dossier de certification (null s'il n'en a aucun)
  dossier: {
    code: string;
    statut: 'en_cours' | 'approuve' | 'rejete_definitif' | 'abandonne';
    etape: number;
    // Les 6 étapes dans l'ordre ; date de la dernière arrivée dans l'étape (ISO 8601, UTC)
    etapes: { etape: number; etat: CertificationStepState; le: string | null }[];
  } | null;
  // Certificat actif (dates AAAA-MM-JJ), null sinon
  certificat: { numero: string; emisLe: string; expireLe: string } | null;
}

// Entonnoir des 6 étapes (US-048, R-CER-07) : écran de la DG
export interface FunnelStep {
  etape: number;
  // Dossiers en cours à cette étape
  enCours: number;
  // Dont sans décision depuis plus de 15 jours (étapes 2 à 5)
  bloques: number;
  // Passages terminés sur 12 mois glissants, et leur délai moyen en jours (null sans passage)
  passages: number;
  delaiMoyenJours: number | null;
}

// Dossier sans décision depuis plus de 15 jours
export interface BlockedDossier {
  dossier: string;
  praticien: string;
  nom: string;
  etape: number;
  prefecture: string;
  region: string;
  // Entrée dans l'étape, horodatage ISO 8601 en UTC, et nombre de jours écoulés
  depuis: string;
  jours: number;
}

export interface CertificationFunnel {
  // Délai cible par étape (R-CER-07) et seuil du blocage, en jours
  delaiCibleJours: number;
  seuilBlocageJours: number;
  etapes: FunnelStep[];
  // Les plus anciens d'abord ; au plus BLOCKED_LIMIT, le total est toujours donné
  bloques: { total: number; dossiers: BlockedDossier[] };
}
