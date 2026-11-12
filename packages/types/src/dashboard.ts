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
  praticiens: number;
  // Dossiers en cours qui ont quitté le brouillon (étape 2 ou plus)
  dossiersSoumis: number;
  // Comptes d'administration actifs de la zone
  comptes: number;
  // Valeurs du référentiel des spécialités (paramétrées par la DG)
  specialites: number;
  activite: DashboardEvent[];
  // DG seule (null pour les autres profils) : nombre total d'échecs et les plus récents
  smsNonRemis: { total: number; derniers: SmsFailure[] } | null;
}
