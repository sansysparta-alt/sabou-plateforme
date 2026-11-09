// Profils et rubriques de l'application mobile (US-018). L'application est réservée à deux
// profils (CdC §1.3, §8) : le praticien et l'agent préfectoral de terrain. Le citoyen passe
// par le site public. Une rubrique = une entrée dans le registre (app.dart) : la navigation
// s'adapte d'elle-même au profil et au nombre de rubriques.
import 'package:flutter/widgets.dart';

/// Profil de l'utilisateur de l'application.
enum SabouProfile { practitioner, fieldAgent }

/// Rôle Keycloak du praticien (domaine public `sabou-public`).
const practitionerRole = 'praticien';

/// Rôle Keycloak de l'agent préfectoral (domaine interne `sabou`). Sa connexion dans
/// l'application arrive avec sa première rubrique (US-082, décision du maître d'œuvre du
/// 9 novembre 2026).
const fieldAgentRole = 'admin_prefectoral';

/// Profil déduit des rôles du compte, ou null si le compte n'a pas accès à l'application
/// (citoyen).
SabouProfile? profileFromRoles(Set<String> roles) {
  if (roles.contains(practitionerRole)) return SabouProfile.practitioner;
  if (roles.contains(fieldAgentRole)) return SabouProfile.fieldAgent;
  return null;
}

/// Ce que la coquille fournit à une rubrique.
class RubricContext {
  const RubricContext({required this.onSignedOut});

  /// À appeler quand l'API répond que la session n'est plus valable : retour à la
  /// connexion.
  final VoidCallback onSignedOut;
}

/// Une rubrique de l'application : un onglet de la barre du bas.
class Rubric {
  const Rubric({
    required this.id,
    required this.label,
    required this.icon,
    required this.selectedIcon,
    required this.profiles,
    required this.builder,
  });

  /// Identifiant stable (clé des tests et de l'état gardé).
  final String id;

  /// Libellé de l'onglet et titre de la barre du haut.
  final String label;
  final IconData icon;
  final IconData selectedIcon;

  /// Profils qui voient la rubrique.
  final Set<SabouProfile> profiles;

  /// Contenu de la rubrique, construit à sa première ouverture seulement.
  final Widget Function(BuildContext context, RubricContext rubric) builder;
}

/// Rubriques d'un profil, dans l'ordre du registre.
List<Rubric> rubricsFor(SabouProfile profile, List<Rubric> all) =>
    all.where((r) => r.profiles.contains(profile)).toList(growable: false);
