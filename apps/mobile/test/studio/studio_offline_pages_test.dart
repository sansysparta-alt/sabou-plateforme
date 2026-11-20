// US-080 : écrans du Studio sans réseau (critère 1) et synchronisation au retour du réseau
// (critère 2). La copie chiffrée est remplacée par une copie en mémoire (pas de disque dans
// l'horloge simulée des tests d'écran) ; son chiffrement est prouvé par studio_offline_test.dart.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/dossier/session.dart';
import 'package:sabou_mobile/studio/sealed_files.dart';
import 'package:sabou_mobile/studio/studio_api.dart';
import 'package:sabou_mobile/studio/studio_offline.dart';
import 'package:sabou_mobile/studio/studio_pages.dart';
import 'package:sabou_mobile/ui/theme.dart';

import 'dart:io';

import '../dossier/fakes.dart';
import 'studio_pages_test.dart' show completeFields;

/// Copie en mémoire, mêmes appels que la copie chiffrée.
class MemorySealedFiles extends SealedFiles {
  MemorySealedFiles()
    : super(
        directory: Directory('.'),
        secrets: MemorySecretStore(),
        keyName: 'test',
      );

  final data = <String, List<int>>{};

  @override
  Future<void> write(String name, List<int> clear) async => data[name] = clear;

  @override
  Future<List<int>?> read(String name) async => data[name];

  @override
  Future<void> delete(String name) async => data.remove(name);
}

void main() {
  late FakeServer server;
  late StudioStore store;

  setUp(() {
    server = FakeServer();
    store = StudioStore(MemorySealedFiles());
  });

  Future<void> pumpStudio(WidgetTester tester) async {
    final session = PractitionerSession(
      store: MemorySecretStore(),
      launcher: FakeLauncher(),
      client: server.client,
      issuer: issuer,
    );
    await session.signIn();
    await tester.pumpWidget(
      MaterialApp(
        theme: sabouTheme(),
        locale: const Locale('fr'),
        supportedLocales: const [Locale('fr'), Locale('en')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: Scaffold(
          body: TreatmentsPage(
            api: StudioApi(
              baseUrl: Uri.parse('http://api.test'),
              session: session,
              client: server.client,
            ),
            onSignedOut: () {},
            store: store,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tapText(WidgetTester tester, String text) async {
    final finder = find.text(text);
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  testWidgets(
    'sans réseau : liste de la copie, saisie gardée sur le téléphone, envoyée à la reprise',
    (tester) async {
      final code = server.seedTreatment(
        completeFields(title: 'Tisane du soir'),
      );
      await pumpStudio(tester);
      expect(find.text('Tisane du soir'), findsOneWidget);

      // Le réseau tombe : la liste vient de la copie, l'écran le dit
      server.offline = true;
      await tester.fling(
        find.byType(ListView).first,
        const Offset(0, 400),
        1000,
      );
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Sans réseau : vos traitements tels qu’au'),
        findsOneWidget,
      );

      // Ouvrir et modifier le traitement sans réseau
      await tapText(tester, 'Tisane du soir');
      final title = find.byKey(const Key('studio-titreFr'));
      await tester.ensureVisible(title);
      await tester.enterText(title, 'Tisane du soir, corrigée');
      await tester.pump();
      // « Suivant » garde le brouillon sur le téléphone, et la saisie continue
      await tester.tap(find.byKey(const Key('studio-suivant')));
      await tester.pumpAndSettle();
      expect(find.text('Étape 2 sur 6'), findsOneWidget);
      await tester.tap(find.byTooltip('Retour'));
      await tester.pumpAndSettle();
      expect(
        find.text('Gardé sur le téléphone : envoi au retour du réseau.'),
        findsOneWidget,
      );

      // Le réseau revient, l'application est rouverte : l'envoi part, la marque disparaît
      server.offline = false;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(server.treatments[code]!['titreFr'], 'Tisane du soir, corrigée');
      expect(
        find.text('Gardé sur le téléphone : envoi au retour du réseau.'),
        findsNothing,
      );
    },
  );

  testWidgets('conflit à la synchronisation : l’avis est dit sur la liste', (
    tester,
  ) async {
    final code = server.seedTreatment(completeFields(title: 'Décoction'));
    await pumpStudio(tester);
    server.offline = true;
    await tapText(tester, 'Décoction');
    await tester.tap(find.byKey(const Key('studio-suivant')));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Retour'));
    await tester.pumpAndSettle();
    // Soumis depuis ailleurs pendant ce temps : la version du serveur primera
    server.treatments[code] = {
      ...server.treatments[code]!,
      'statut': 'soumise',
    };
    server.offline = false;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(
      find.textContaining('la version du serveur est gardée'),
      findsOneWidget,
    );
  });
}
