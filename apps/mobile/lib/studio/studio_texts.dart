// Libellés du Studio mobile (US-067), repris du Studio web (apps/site/app/studio/studio-api.ts)
// pour que le praticien lise les mêmes mots partout. Textes en français, comme le reste de
// l'application (05 §2.62) ; les langues nationales sont en voix seulement.

const statusLabels = <String, String>{
  'brouillon': 'Brouillon',
  'soumise': 'Soumis à l’administration régionale',
  'transmise': 'Transmis au Comité scientifique',
  'expertisee': 'Expertisé, en attente de certification',
  'certifiee': 'Certifié',
  'suspendue': 'Suspendu',
  'retiree': 'Retiré',
};

/// Raison d'un traitement resté « expertisé » (US-046).
const waitingLabels = <String, String>{
  'quota': 'La formule gratuite est limitée à 3 traitements certifiés : celui-ci sera certifié au passage à la formule GOLD.',
  'contenu': 'Une plante n’est pas encore validée par le Comité scientifique, ou une section est à compléter.',
};

const gapLabels = <String, String>{
  'consentement': 'votre consentement et le niveau de visibilité',
  'plante': 'au moins une plante',
  'cycle': 'la durée du cycle et le nombre de prises par jour',
  'sections': 'les 4 sections obligatoires',
};

const visibilityLabels = <String, ({String label, String help})>{
  'publique': (
    label: 'Publique',
    help: 'Visible de tous sur le site, une fois certifié.',
  ),
  'restreinte': (
    label: 'Restreinte',
    help: 'Visible des seules personnes connectées.',
  ),
  'privee': (
    label: 'Privée',
    help: 'Visible de vous et des administrateurs seulement.',
  ),
};

String statusLabel(String status) => statusLabels[status] ?? status;

String gapsSentence(List<String> gaps) =>
    'Avant de soumettre, complétez : ${gaps.map((g) => gapLabels[g] ?? g).join(' ; ')}.';

const networkError =
    'La demande n’a pas abouti. Vérifiez le réseau, puis réessayez.';
