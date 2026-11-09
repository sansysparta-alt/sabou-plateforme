// US-018, critères 1 et 6 : composants communs, annoncés correctement aux lecteurs d'écran
// et lisibles (contraste WCAG 2.2 AA) avec le thème de la charte.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/ui/theme.dart';
import 'package:sabou_mobile/ui/widgets.dart';

Widget screen(Widget child) => MaterialApp(
  theme: sabouTheme(),
  home: Scaffold(body: child),
);

void main() {
  testWidgets(
    'message d’état : annoncé dès qu’il paraît, lisible dans chaque état',
    (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(
        screen(
          ListView(
            children: [
              for (final kind in StatusKind.values)
                StatusMessage('Message ${kind.name}', kind: kind),
            ],
          ),
        ),
      );
      for (final kind in StatusKind.values) {
        expect(
          tester.getSemantics(find.text('Message ${kind.name}')),
          isSemantics(label: 'Message ${kind.name}'),
        );
      }
      final live = find.byWidgetPredicate(
        (w) => w is Semantics && (w.properties.liveRegion ?? false),
      );
      expect(live, findsNWidgets(StatusKind.values.length));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    },
  );

  testWidgets('titre de section et écran vide : signalés comme titres', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(
      screen(
        Column(
          children: [
            const SectionTitle('Ma fiche'),
            Expanded(
              child: EmptyState(
                icon: Icons.info_outline,
                title: 'Rien à montrer',
                message: 'Explication.',
                actions: [
                  FilledButton(onPressed: () {}, child: const Text('Agir')),
                ],
              ),
            ),
          ],
        ),
      ),
    );
    expect(
      tester.getSemantics(find.text('Ma fiche')),
      isSemantics(label: 'Ma fiche', isHeader: true),
    );
    expect(
      tester.getSemantics(find.text('Rien à montrer')),
      isSemantics(label: 'Rien à montrer', isHeader: true),
    );
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));
    handle.dispose();
  });

  testWidgets('chargement : libellé lu par les lecteurs d’écran', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(screen(const LoadingView(label: 'Chargement')));
    expect(find.bySemanticsLabel('Chargement'), findsOneWidget);
    handle.dispose();
  });
}
