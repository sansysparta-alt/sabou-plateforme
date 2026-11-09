// US-018, critères 2, 3 et 6 : navigation selon le profil. Registre simulé de trois
// rubriques, pour prouver que la structure accueille les prochaines (Studio en S7,
// numérisation et agenda en S8) sans changer la coquille.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/shell/app_shell.dart';
import 'package:sabou_mobile/shell/rubric.dart';
import 'package:sabou_mobile/ui/theme.dart';

void main() {
  late Map<String, int> builds;
  late int signOuts;
  late int signedOut;

  setUp(() {
    builds = {};
    signOuts = 0;
    signedOut = 0;
  });

  Rubric rubric(String id, String label, Set<SabouProfile> profiles) => Rubric(
    id: id,
    label: label,
    icon: Icons.circle_outlined,
    selectedIcon: Icons.circle,
    profiles: profiles,
    builder: (context, rubric) {
      builds.update(id, (n) => n + 1, ifAbsent: () => 1);
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            key: ValueKey('champ-$id'),
            decoration: InputDecoration(labelText: 'Champ $label'),
          ),
          TextButton(
            onPressed: rubric.onSignedOut,
            child: Text('Session expirée $label'),
          ),
        ],
      );
    },
  );

  final registry = [
    rubric('dossier', 'Mon dossier', {SabouProfile.practitioner}),
    rubric('studio', 'Studio', {SabouProfile.practitioner}),
    rubric('numerisation', 'Numérisation', {SabouProfile.fieldAgent}),
    rubric('agenda', 'Agenda', {SabouProfile.fieldAgent}),
    rubric('aide', 'Aide', {
      SabouProfile.practitioner,
      SabouProfile.fieldAgent,
    }),
  ];

  Future<void> pumpShell(WidgetTester tester, List<Rubric> rubrics) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: sabouTheme(),
        home: AppShell(
          rubrics: rubrics,
          onSignOut: () async => signOuts++,
          onSignedOut: () => signedOut++,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('Critère 2 : rubriques selon le profil', () {
    test('le profil vient des rôles du compte ; le citoyen n’a pas accès', () {
      expect(profileFromRoles({'praticien'}), SabouProfile.practitioner);
      expect(profileFromRoles({'admin_prefectoral'}), SabouProfile.fieldAgent);
      expect(profileFromRoles({'citoyen'}), isNull);
      expect(profileFromRoles({}), isNull);
    });

    test(
      'chaque profil ne reçoit que ses rubriques, dans l’ordre du registre',
      () {
        expect(
          rubricsFor(SabouProfile.practitioner, registry).map((r) => r.id),
          ['dossier', 'studio', 'aide'],
        );
        expect(rubricsFor(SabouProfile.fieldAgent, registry).map((r) => r.id), [
          'numerisation',
          'agenda',
          'aide',
        ]);
      },
    );

    testWidgets('agent : ses onglets, aucun de ceux du praticien', (
      tester,
    ) async {
      await pumpShell(tester, rubricsFor(SabouProfile.fieldAgent, registry));
      final bar = find.byType(NavigationBar);
      expect(
        find.descendant(of: bar, matching: find.text('Numérisation')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: bar, matching: find.text('Agenda')),
        findsOneWidget,
      );
      expect(find.text('Mon dossier'), findsNothing);
      expect(find.text('Studio'), findsNothing);
    });

    testWidgets(
      'profil sans rubrique ouverte : écran d’attente, déconnexion possible',
      (tester) async {
        await pumpShell(tester, const []);
        expect(find.text('Vos rubriques arrivent bientôt'), findsOneWidget);
        expect(find.byType(NavigationBar), findsNothing);
        await tester.tap(find.text('Se déconnecter'));
        await tester.pumpAndSettle();
        expect(signOuts, 1);
      },
    );
  });

  group('Critère 3 : une rubrique de plus = une entrée dans le registre', () {
    testWidgets(
      'une seule rubrique : pas de barre du bas, titre de la rubrique',
      (tester) async {
        await pumpShell(tester, registry.take(1).toList());
        expect(find.byType(NavigationBar), findsNothing);
        expect(
          find.descendant(
            of: find.byType(AppBar),
            matching: find.text('Mon dossier'),
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'dès deux rubriques : barre du bas ; changer d’onglet garde la saisie',
      (tester) async {
        await pumpShell(
          tester,
          rubricsFor(SabouProfile.practitioner, registry),
        );
        expect(find.byType(NavigationBar), findsOneWidget);
        expect(find.byType(NavigationDestination), findsNWidgets(3));
        // Seule la rubrique affichée est construite (pas de requête inutile en 3G)
        expect(builds.keys, ['dossier']);

        await tester.enterText(
          find.byKey(const ValueKey('champ-dossier')),
          'Labé',
        );
        await tester.tap(find.byKey(const ValueKey('onglet-studio')));
        await tester.pumpAndSettle();
        expect(
          find.descendant(
            of: find.byType(AppBar),
            matching: find.text('Studio'),
          ),
          findsOneWidget,
        );
        expect(builds.keys, containsAll(['dossier', 'studio']));

        await tester.tap(find.byKey(const ValueKey('onglet-dossier')));
        await tester.pumpAndSettle();
        // Rubrique gardée, pas recréée : la saisie est toujours là
        expect(find.text('Labé'), findsOneWidget);
      },
    );

    testWidgets('retour Android : d’abord vers la première rubrique', (
      tester,
    ) async {
      await pumpShell(tester, rubricsFor(SabouProfile.practitioner, registry));
      await tester.tap(find.byKey(const ValueKey('onglet-aide')));
      await tester.pumpAndSettle();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: find.byType(AppBar),
          matching: find.text('Mon dossier'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('une rubrique signale une session expirée à la coquille', (
      tester,
    ) async {
      await pumpShell(tester, registry.take(1).toList());
      await tester.tap(find.text('Session expirée Mon dossier'));
      expect(signedOut, 1);
    });
  });

  group('Critère 6 : accessibilité (WCAG 2.2 AA)', () {
    testWidgets('barre du haut et barre du bas', (tester) async {
      final handle = tester.ensureSemantics();
      await pumpShell(tester, rubricsFor(SabouProfile.practitioner, registry));
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  });
}
