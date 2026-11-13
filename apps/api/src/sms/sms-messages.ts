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
  // Code du dossier (DS-…)
  objet: string;
  // Données figées à la mise en file : étape d'arrivée d'une décision, date et heure d'une
  // visite (heure de Conakry, 2026-11-20T09:30)
  parametres: { etape?: number; prevueLe?: string; quota?: number; contenu?: number };
}

// « 2026-11-20T09:30 » → « 20/11/2026 à 09h30 » ; null si la donnée est mal formée
function visitDate(value: string | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]} à ${match[4]}h${match[5]}` : null;
}

// « 2 traitements de votre dossier … ne sont pas encore certifiés : formule gratuite… » ; null
// si les nombres sont mal formés (erreur définitive)
function pendingTreatmentsText(objet: string, quota: number, contenu: number): string | null {
  const valid = (n: number) => Number.isInteger(n) && n >= 0 && n < 1000;
  if (!valid(quota) || !valid(contenu) || quota + contenu === 0) return null;
  const total = quota + contenu;
  const reasons = [
    quota > 0 ? 'formule gratuite limitée à 3' : null,
    contenu > 0 ? 'plante ou section à compléter' : null,
  ].filter(Boolean);
  const subject =
    total === 1
      ? `1 traitement de votre dossier ${objet} n'est pas encore certifié`
      : `${total} traitements de votre dossier ${objet} ne sont pas encore certifiés`;
  return `SABOU : ${subject} : ${reasons.join(' ; ')}.`;
}

// Texte d'un message de la file, ou null si le modèle est inconnu (erreur définitive)
export function notificationText({ modele, objet, parametres }: QueuedMessage): string | null {
  const etape = parametres.etape;
  switch (modele) {
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
    case 'dossier.publie':
      return `SABOU : félicitations, votre certification est publiée (dossier ${objet}). Votre fiche de praticien certifié est visible sur SABOU.`;
    default:
      return null;
  }
}
