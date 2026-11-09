// Coquille de l'application (US-018) : barre du haut (titre de la rubrique, déconnexion),
// rubriques du profil et, dès deux rubriques, barre de navigation en bas.
// Chaque rubrique est construite à sa première ouverture (pas de requête inutile en 3G),
// puis gardée : revenir sur un onglet retrouve la saisie et le défilement laissés.
import 'package:flutter/material.dart';

import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'rubric.dart';

class AppShell extends StatefulWidget {
  const AppShell({
    super.key,
    required this.rubrics,
    required this.onSignOut,
    required this.onSignedOut,
    this.devTools,
  });

  /// Rubriques du profil connecté (déjà filtrées, voir [rubricsFor]).
  final List<Rubric> rubrics;

  /// « Se déconnecter ».
  final Future<void> Function() onSignOut;

  /// La session n'est plus valable (signalé par une rubrique).
  final VoidCallback onSignedOut;

  /// Accès aux prototypes, en version de développement seulement.
  final Widget? devTools;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _index = 0;
  final _opened = <int>{0};
  bool _signingOut = false;

  void _select(int index) => setState(() {
    _index = index;
    _opened.add(index);
  });

  Future<void> _signOut() async {
    setState(() => _signingOut = true);
    try {
      await widget.onSignOut();
    } finally {
      if (mounted) setState(() => _signingOut = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rubrics = widget.rubrics;
    final rubricContext = RubricContext(onSignedOut: widget.onSignedOut);
    final hasRubrics = rubrics.isNotEmpty;
    final index = hasRubrics ? _index.clamp(0, rubrics.length - 1) : 0;

    final body = hasRubrics
        ? IndexedStack(
            index: index,
            children: [
              for (var i = 0; i < rubrics.length; i++)
                _opened.contains(i)
                    ? KeyedSubtree(
                        key: ValueKey(rubrics[i].id),
                        child: Builder(
                          builder: (c) => rubrics[i].builder(c, rubricContext),
                        ),
                      )
                    : const SizedBox.shrink(),
            ],
          )
        : const EmptyState(
            icon: Icons.construction_outlined,
            title: 'Vos rubriques arrivent bientôt',
            message:
                'Aucune rubrique n’est encore ouverte pour votre profil. Elles '
                'arriveront avec les prochaines versions de l’application.',
          );

    return PopScope(
      // Retour Android : d'abord vers la première rubrique, puis sortie de l'application
      canPop: index == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _select(0);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(hasRubrics ? rubrics[index].label : 'SABOU'),
          actions: [
            ?widget.devTools,
            TextButton(
              style: TextButton.styleFrom(foregroundColor: SabouColors.onDark),
              onPressed: _signingOut ? null : _signOut,
              child: const Text('Se déconnecter'),
            ),
          ],
        ),
        body: SafeArea(child: body),
        bottomNavigationBar: rubrics.length >= 2
            ? NavigationBar(
                selectedIndex: index,
                onDestinationSelected: _select,
                destinations: [
                  for (final rubric in rubrics)
                    NavigationDestination(
                      key: ValueKey('onglet-${rubric.id}'),
                      icon: Icon(rubric.icon),
                      selectedIcon: Icon(rubric.selectedIcon),
                      label: rubric.label,
                    ),
                ],
              )
            : null,
      ),
    );
  }
}
