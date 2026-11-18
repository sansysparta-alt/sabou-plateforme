// Rôles et droits (US-012b). Sans dépendance à l'exécution : l'application de gestion importe
// ce module seul (« @sabou/types/permissions ») pour ne pas embarquer zod dans le paquet
// téléchargé.
//
// Source : la matrice des permissions du cahier des charges (§3.2), reprise ligne à ligne et
// colonne à colonne, puis les précisions apportées par les règles métier (04_Regles_Metier.md)
// pour des droits que le §3.2 ne cite pas. Les rôles et leurs droits sont fixes : la DG les
// consulte, elle ne les modifie pas (R-ACC-04, moindre privilège).
//
// Chaque droit déjà développé (available) est prouvé conforme au serveur par un test qui essaie
// l'action avec chaque profil : packages/db/test/matrice-droits.test.ts pour les droits appliqués
// par la base, les tests de l'API pour la gestion des comptes et les fiches plantes.
import type { AccountRole, WorkLanguage } from './accounts.js';

// Profils du §3.2, dans l'ordre de ses colonnes
export type MatrixRole = 'praticien' | AccountRole | 'citoyen';
export const MATRIX_ROLES: readonly MatrixRole[] = [
  'praticien',
  'prefectoral',
  'regional',
  'scientifique',
  'dg',
  'citoyen',
];

export const MATRIX_ROLE_LABELS: Record<MatrixRole, string> = {
  praticien: 'Tradipraticien',
  prefectoral: 'Administrateur préfectoral',
  regional: 'Administrateur régional',
  scientifique: 'Comité scientifique',
  dg: 'Direction Générale',
  citoyen: 'Citoyen',
};

// Périmètre et mission de chaque profil, repris de la maquette de l'application de gestion
// (diapositive 2 « Profils et droits »)
export const ROLE_PROFILES: Record<MatrixRole, { scope: string; mission: string }> = {
  dg: {
    scope: 'National',
    mission: 'Approuve les certifications, pilote le site, gère utilisateurs et partenaires.',
  },
  regional: {
    scope: 'Région',
    mission: 'Consolide les dossiers, arbitre les litiges, valide les voix de sa langue.',
  },
  prefectoral: {
    scope: 'Préfecture',
    mission:
      'Vérifie sur le terrain, numérise les recettes, résume en français et enregistre la voix locale.',
  },
  scientifique: {
    scope: 'National',
    mission:
      'Expertise la non-toxicité, contrôle les effets indésirables par langue, traite les signalements.',
  },
  praticien: {
    scope: 'Individuel',
    mission:
      'Enregistre ses recettes vocales, gère profil, boutique, formation, demandes de plantes.',
  },
  citoyen: {
    scope: 'Compte gratuit',
    mission: 'Recherche une maladie, écoute les traitements et dépose ses témoignages.',
  },
};

// Une cellule : droit accordé (true) ou accordé sur un périmètre écrit dans la matrice
// (« Local », « Région »…) ; un profil absent n'a pas le droit
export type Grant = true | string;

export interface Permission {
  id: string;
  label: string;
  grants: Partial<Record<MatrixRole, Grant>>;
  // Déjà développé, donc prouvé conforme au serveur ; sinon « À venir »
  available: boolean;
  // Origine d'une précision hors du §3.2
  source?: string;
}

export interface PermissionGroup {
  title: string;
  permissions: readonly Permission[];
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    title: 'Matrice du cahier des charges (§3.2)',
    permissions: [
      {
        id: 'recipe.voice.record',
        label: 'Enregistrer la voix d’une recette',
        grants: { praticien: true, prefectoral: true },
        available: false,
      },
      {
        id: 'recipe.summarize',
        label: 'Résumer en français et enregistrer la voix en langue locale',
        grants: { prefectoral: true },
        available: false,
      },
      {
        id: 'voices.validate',
        label: 'Valider les voix d’une langue',
        grants: { regional: true },
        available: false,
      },
      {
        id: 'language-resources.publish',
        label: 'Publier les ressources linguistiques',
        grants: { dg: true },
        available: false,
      },
      {
        id: 'dossier.submit',
        label: 'Soumettre un dossier et publier une recette',
        grants: { praticien: true },
        available: true,
      },
      {
        id: 'practitioner.field-check',
        label: 'Valider un praticien (terrain)',
        grants: { prefectoral: true },
        available: true,
      },
      {
        id: 'dossiers.consolidate',
        label: 'Consolider les dossiers préfectoraux',
        grants: { regional: true },
        available: true,
      },
      {
        id: 'recipe.review',
        label: 'Expertiser une recette',
        grants: { scientifique: true },
        available: true,
      },
      {
        id: 'side-effects.check',
        label: 'Contrôler les effets indésirables dans chaque langue',
        grants: { scientifique: true },
        available: false,
      },
      {
        id: 'health-report.handle',
        label: 'Traiter un signalement sanitaire (danger, effet indésirable)',
        grants: { scientifique: true },
        available: false,
      },
      {
        id: 'certification.approve',
        label: 'Approuver une certification',
        grants: { dg: true },
        available: true,
      },
      {
        id: 'practitioner.reject',
        label: 'Prononcer le rejet définitif d’un praticien',
        grants: { dg: true },
        available: true,
      },
      {
        id: 'site-menus.manage',
        label: 'Gérer les menus du site',
        grants: { dg: true },
        available: false,
      },
      {
        id: 'users.manage',
        label: 'Gérer utilisateurs, rôles, partenaires et API',
        grants: { dg: true },
        available: true,
      },
      {
        id: 'forum.moderate',
        label: 'Modérer le forum et les témoignages',
        grants: {
          prefectoral: 'Local',
          regional: 'Région',
          scientifique: 'Scientifique',
          dg: 'National',
        },
        available: false,
      },
      {
        id: 'plant-request.answer',
        label: 'Répondre à une demande de plante',
        grants: { praticien: true },
        available: false,
      },
      {
        id: 'testimony.answer',
        label: 'Répondre à un témoignage',
        grants: { praticien: true },
        available: false,
      },
      {
        id: 'testimony.submit',
        label: 'Déposer un témoignage sur un traitement',
        grants: { citoyen: true },
        available: false,
      },
      {
        id: 'plant-request.submit',
        label: 'Déposer une demande de plante',
        grants: { citoyen: true },
        available: false,
      },
      {
        id: 'testimonies.moderate',
        label: 'Modérer les témoignages',
        grants: { prefectoral: true, dg: true },
        available: false,
      },
    ],
  },
  {
    title: 'Précisions des règles métier',
    permissions: [
      {
        id: 'dossier.review',
        label: 'Expertiser un dossier de praticien (étape 4)',
        grants: { scientifique: true },
        available: true,
        source: 'CdC §4, étape 4',
      },
      {
        id: 'treatment.forward',
        label: 'Transmettre un traitement au Comité',
        grants: { regional: true },
        available: true,
        source: 'US-061',
      },
      {
        id: 'treatment.certify',
        label: 'Certifier un traitement',
        grants: { dg: true },
        available: true,
        source: 'US-061',
      },
      {
        id: 'treatment.suspend',
        label: 'Suspendre un traitement certifié',
        grants: { scientifique: true, dg: true },
        available: true,
        source: 'R-REC-07',
      },
      {
        id: 'plants.edit',
        label: 'Créer et modifier les fiches plantes',
        grants: { scientifique: true, dg: true },
        available: true,
        source: 'US-050',
      },
      {
        // Annotation botanique de l'étape 4 ; la DG lit les annotations sans en écrire
        id: 'content.annotate',
        label: 'Annoter un traitement ou une plante',
        grants: { scientifique: true },
        available: true,
        source: 'CdC §4, US-064',
      },
    ],
  },
];

export const PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap(
  (group) => group.permissions,
);

export function permission(id: string): Permission {
  const found = PERMISSIONS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Droit inconnu : ${id}`);
  return found;
}

// Profils qui ont le droit, quel que soit leur périmètre
export function grantedRoles(id: string): MatrixRole[] {
  return MATRIX_ROLES.filter((role) => permission(id).grants[role] !== undefined);
}

// Droits sur les voix : en plus du rôle, ils suivent les langues de travail du compte (R-GOV-06),
// attribuées à l'invitation ; personne ne valide sa propre voix
export const VOICE_RIGHTS_NOTE =
  'Les droits sur les voix suivent aussi les langues de travail de chaque compte (enregistrer, traduire, valider), attribuées à l’invitation. Personne ne valide sa propre voix.';

// Droits de langue préremplis à l'invitation, selon le rôle (US-012c, CdC §2.8, §3.2) : le
// préfectoral enregistre et traduit, le régional valide, dans la langue de sa région ; la DG
// publie par son rôle (pas de case par langue) ; le Comité n'a pas de droit de langue. Le
// réglage langue par langue reste possible ensuite. « Résumer » viendra avec US-072 (S6).
export function defaultWorkLanguages(
  role: AccountRole | '',
  regionLanguage: string | null,
): WorkLanguage[] {
  if (!regionLanguage) return [];
  if (role === 'prefectoral') {
    return [{ code: regionLanguage, record: true, translate: true, validate: false }];
  }
  if (role === 'regional') {
    return [{ code: regionLanguage, record: false, translate: false, validate: true }];
  }
  return [];
}
