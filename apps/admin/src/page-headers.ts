// En-têtes des pages dont le titre et l'introduction ne dépendent pas de la personne (US-017b).
// Source unique : chaque page les affiche, et l'ossature pré-générée à la compilation
// (scripts/prerender.mjs) les met dans le HTML de son adresse, pour qu'ils s'affichent dès
// l'arrivée du HTML en 3G, avant le code de l'application et la session.
// Le tableau de bord (« Bonjour, … ») dépend de la personne : il n'y figure pas.

export interface PageHeading {
  title: string;
  lead: string;
}

export const PAGE_HEADERS = {
  '/comptes': {
    title: 'Comptes',
    lead: 'Comptes d’administration : rôle, zone et langues de travail. Une suspension coupe l’accès immédiatement.',
  },
  '/referentiels': {
    title: 'Référentiels',
    lead: 'Langues, territoires et spécialités de la plateforme. Chaque modification est journalisée.',
  },
  '/dossiers-terrain': {
    title: 'Dossiers terrain',
    lead: 'Dossiers de praticiens sans smartphone, créés sur le terrain dans votre préfecture : pièces déposées par vous, puis soumission à la vérification.',
  },
  '/verification-terrain': {
    title: 'Vérification terrain',
    lead: 'Dossiers soumis dans votre préfecture, en attente de votre décision. Délai cible : 3 jours par dossier.',
  },
  '/agents-verification': {
    title: 'Agents de vérification',
    lead: 'Dossiers terrain de votre région : l’auteur d’un dossier ne le vérifie pas lui-même. Si la préfecture n’a qu’un agent, désignez un autre agent préfectoral de la région.',
  },
  '/consolidation': {
    title: 'Consolidation régionale',
    lead: 'Dossiers de votre région vérifiés sur le terrain, en attente de votre décision. Délai cible : 3 jours par dossier.',
  },
  '/approbation': {
    title: 'Approbation des dossiers',
    lead: 'Dossiers expertisés par le Comité scientifique. L’approbation émet le certificat signé, valable 12 mois.',
  },
  '/expertise': {
    title: 'Expertise des dossiers',
    lead: 'Dossiers consolidés par les régions, en attente de l’avis du Comité scientifique. Délai cible : 3 jours par dossier.',
  },
  '/signalements': {
    title: 'Signalements',
    lead: 'Dangers et effets indésirables signalés par le public sur un traitement ou une plante. Les signalements graves sont en tête : délai cible de 24 heures. Chaque décision est motivée.',
  },
  '/traitements-suspendus': {
    title: 'Traitements suspendus',
    lead: 'Traitements retirés du site par une suspension du Comité. Levez la suspension, avec un motif, quand le danger est écarté.',
  },
  '/traitements': {
    title: 'Traitements à décider',
    lead: 'Traitements qui attendent votre décision : transmission au Comité par la région, expertise par le Comité scientifique, certification par la Direction Générale. Un renvoi exige un motif.',
  },
  '/entonnoir': {
    title: 'Entonnoir de certification',
    lead: 'Dossiers en cours à chaque étape, délais et dossiers bloqués, au niveau national. Le délai moyen d’une étape porte sur les dossiers qui en sont sortis au cours des 12 derniers mois.',
  },
  '/rejet-definitif': {
    title: 'Rejet définitif',
    lead: 'Réservé à la Direction Générale, pour fraude documentaire, usurpation d’identité ou pratique dangereuse avérée après avis du Comité scientifique. Le praticien dispose de 30 jours pour contester la décision.',
  },
  '/plantes': {
    title: 'Fiches plantes',
    lead: 'Une fiche par plante, commune à toutes les langues. Une fiche nouvelle ou modifiée reste « en revue » jusqu’à la validation du Comité scientifique.',
  },
  '/maladies': {
    title: 'Fiches maladies',
    lead: 'Une fiche par maladie : nom français, nom anglais, dénominations et symptômes. La recherche trouve aussi les dénominations, avec ou sans accents.',
  },
  '/noms-locaux': {
    title: 'Noms locaux des plantes',
    lead: 'Le référent d’une langue saisit les noms d’une plante dans cette langue : la voix du nom, et une transcription en alphabet latin qui sert seulement à la recherche.',
  },
  '/voix-des-noms': {
    title: 'Voix des noms',
    lead: 'La voix du nom de chaque plante et de chaque maladie, langue par langue : enregistrée par le référent, validée par un autre membre de l’atelier linguistique, publiée par la Direction Générale.',
  },
} as const satisfies Record<string, PageHeading>;

export type HeadedPath = keyof typeof PAGE_HEADERS;

export const headingOf = (path: string): PageHeading | undefined =>
  (PAGE_HEADERS as Record<string, PageHeading>)[path];
