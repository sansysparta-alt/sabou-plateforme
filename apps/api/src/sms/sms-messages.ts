// Textes des SMS envoyés au praticien à chaque étape de son dossier (US-031, R-CER-05).
// En français seulement (langues nationales en voix). Chaque texte tient dans un seul SMS :
// 160 caractères de l'alphabet GSM 7 bits. Un seul caractère hors de cet alphabet (ç, ê,
// ô, î, apostrophe typographique…) fait passer le message en UCS-2, limité à 70 caractères :
// il serait alors facturé 2 ou 3 fois. Le motif d'un rejet n'est pas envoyé (décision du
// maître d'œuvre du 12 novembre 2026) : il se lit dans l'espace du praticien.

export const SMS_MAX_LENGTH = 160;

// Alphabet GSM 03.38 de base (sans la table d'extension, dont chaque caractère compte double)
const GSM7 = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);

export function isSingleGsm7Sms(text: string): boolean {
  return text.length <= SMS_MAX_LENGTH && [...text].every((c) => GSM7.has(c));
}

// Ce qui se passe à l'étape où le dossier arrive
const STEP: Record<number, string> = {
  2: 'la vérification sur le terrain',
  3: 'la consolidation régionale',
  4: "l'expertise du Comité scientifique",
  5: "l'approbation de la Direction Générale",
  6: 'la publication de votre certification',
};

export interface QueuedMessage {
  modele: string;
  // Code du dossier (DS-…), du praticien pour un rejet définitif sans dossier en cours, ou
  // numéro du certificat (SAB-…) pour l'invitation à renouveler
  objet: string;
  // Données figées à la mise en file : étape d'arrivée d'une décision, date et heure d'une
  // visite (heure de Conakry, 2026-11-20T09:30)
  parametres: {
    etape?: number;
    prevueLe?: string;
    quota?: number;
    contenu?: number;
    // Traitement (US-061) : statut d'arrivée, utile pour un renvoi
    statut?: string;
    // Statut de départ (US-100) : une levée de suspension n'est pas une première certification
    de?: string;
    // Rejet définitif (US-047) : dossier clos, s'il y en avait un en cours, et dernier jour
    // du recours (2026-12-14)
    dossier?: string;
    recoursJusquau?: string;
    // Échéance du certificat (US-049), 2027-01-14
    expireLe?: string;
  };
}

// « 2026-11-20T09:30 » → « 20/11/2026 à 09h30 » ; null si la donnée est mal formée
function visitDate(value: string | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]} à ${match[4]}h${match[5]}` : null;
}

// « 2026-12-14 » → « 14/12/2026 » ; null si la donnée est mal formée
function calendarDate(value: string | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

// Rejet définitif (US-047) : texte validé par le maître d'œuvre le 14 novembre 2026. Jusqu'aux
// litiges (US-101), le recours passe par l'administration de la préfecture.
function finalRejectionText(dossier: string | undefined, recoursJusquau: string | undefined) {
  const date = calendarDate(recoursJusquau);
  if (!date || (dossier !== undefined && !/^DS-\d{1,10}$/.test(dossier))) return null;
  const subject = dossier ? `votre dossier ${dossier}` : 'votre certification';
  return `SABOU : rejet définitif de ${subject}. Vous pouvez contester cette décision jusqu'au ${date} auprès de l'administration de votre préfecture.`;
}

// « 2 traitements du dossier … sont en attente : formule gratuite… » ; null
// si les nombres sont mal formés (erreur définitive)
function pendingTreatmentsText(objet: string, quota: number, contenu: number): string | null {
  const valid = (n: number) => Number.isInteger(n) && n >= 0 && n < 1000;
  if (!valid(quota) || !valid(contenu) || quota + contenu === 0) return null;
  const total = quota + contenu;
  // Quota : la promesse « certifié au passage à GOLD » est tenue par US-141 (critère du 13/11)
  const reasons = [
    quota > 0
      ? `formule gratuite limitée à 3, ${quota === 1 ? 'certifié' : 'certifiés'} au passage à GOLD`
      : null,
    contenu > 0 ? 'plante ou section à compléter' : null,
  ].filter(Boolean);
  const subject =
    total === 1
      ? `1 traitement du dossier ${objet} est en attente`
      : `${total} traitements du dossier ${objet} sont en attente`;
  return `SABOU : ${subject} : ${reasons.join(' ; ')}.`;
}

// Renvoi d'un traitement à l'étape précédente (US-061), selon le statut d'arrivée
const TREATMENT_RETURN: Record<string, string> = {
  brouillon: 'vous est renvoyé pour correction.',
  soumise: "est renvoyé à l'administration de votre région.",
  transmise: 'est renvoyé au Comité scientifique.',
};

// Texte d'un message de la file, ou null si le modèle est inconnu (erreur définitive)
export function notificationText({ modele, objet, parametres }: QueuedMessage): string | null {
  const etape = parametres.etape;
  switch (modele) {
    // Récupération du compte DG par l'exploitation (US-024) : alerte, même si la DG l'a demandée
    case 'compte.dg_reinitialise':
      return "SABOU : l'accès de votre compte DG a été réinitialisé. Suivez le lien envoyé par e-mail. Si vous n'avez rien demandé, alertez l'administration.";
    // Dossier terrain (US-040c) : compte créé sans mot de passe, défini par « mot de passe
    // oublié » (US-069)
    case 'dossier.terrain_cree':
      return `SABOU : votre préfecture a créé votre dossier ${objet}. Créez votre mot de passe dans l'appli SABOU : Mot de passe oublié.`;
    case 'dossier.soumis':
      return `SABOU : votre dossier ${objet} est bien enregistré. Il passe à la vérification sur le terrain ; l'administration de votre préfecture vous contactera.`;
    case 'dossier.valide':
      return etape !== undefined && STEP[etape]
        ? `SABOU : votre dossier ${objet} est validé. Il passe à ${STEP[etape]}.`
        : null;
    case 'dossier.rejete':
      if (etape === 1) {
        return `SABOU : votre dossier ${objet} vous est renvoyé pour correction. Le motif est dans votre espace SABOU ; corrigez-le puis soumettez-le de nouveau.`;
      }
      return etape !== undefined && STEP[etape]
        ? `SABOU : votre dossier ${objet} est renvoyé à ${STEP[etape]}. Le motif est dans votre espace SABOU.`
        : null;
    case 'dossier.rejet_definitif':
      return `SABOU : votre dossier ${objet} est définitivement rejeté. Le motif et les voies de recours sont dans votre espace SABOU.`;
    case 'visite.rappel': {
      // Rappel la veille de la visite terrain (US-041)
      const date = visitDate(parametres.prevueLe);
      return date
        ? `SABOU : rappel, l'administration de votre préfecture vous rend visite le ${date} pour votre dossier ${objet}. Merci de vous rendre disponible.`
        : null;
    }
    case 'dossier.traitements_en_attente':
      // US-046 : traitements restés « expertisés » à la publication (nombre et raison)
      return pendingTreatmentsText(objet, parametres.quota ?? 0, parametres.contenu ?? 0);
    case 'praticien.rejet_definitif':
      return finalRejectionText(parametres.dossier, parametres.recoursJusquau);
    // Circuit d'un traitement (US-061, R-REC-07) ; le motif d'un renvoi est dans le Studio
    case 'recette.soumise':
      return `SABOU : votre traitement ${objet} est bien soumis. Il passe à l'examen de l'administration de votre région.`;
    case 'recette.transmise':
      return `SABOU : votre traitement ${objet} est transmis au Comité scientifique pour expertise.`;
    case 'recette.expertisee':
      return `SABOU : votre traitement ${objet} est expertisé par le Comité scientifique. Il attend la certification de la Direction Générale.`;
    case 'recette.certifiee':
      // US-100 : levée d'une suspension par le Comité, distincte d'une première certification
      return parametres.de === 'suspendue'
        ? `SABOU : la suspension de votre traitement ${objet} est levée. Il est de nouveau visible sur SABOU.`
        : `SABOU : félicitations, votre traitement ${objet} est certifié.`;
    // US-100 : suspension (après un signalement) et retrait ; le motif est dans le Studio
    case 'recette.suspendue':
      return `SABOU : votre traitement ${objet} est suspendu et retiré du site. Le motif est dans votre Studio SABOU.`;
    case 'recette.retiree':
      return `SABOU : votre traitement ${objet} est retiré du site. Le motif est dans votre Studio SABOU.`;
    case 'recette.renvoyee': {
      const to = TREATMENT_RETURN[parametres.statut ?? ''];
      return to
        ? `SABOU : votre traitement ${objet} ${to} Le motif est dans votre Studio SABOU.`
        : null;
    }
    case 'certificat.renouvellement': {
      // US-049 : invitation à renouveler, 60 jours avant l'échéance
      const date = calendarDate(parametres.expireLe);
      return date && /^SAB-\d{4}-PR\d{1,10}-[A-Z2-9]{3}$/.test(objet)
        ? `SABOU : votre certificat ${objet} expire le ${date}. Renouvelez-le dans votre espace SABOU pour rester dans l'annuaire.`
        : null;
    }
    case 'dossier.publie':
      return `SABOU : félicitations, votre certification est publiée (dossier ${objet}). Votre fiche de praticien certifié est visible sur SABOU.`;
    default:
      return null;
  }
}
