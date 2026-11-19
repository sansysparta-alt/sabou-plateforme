// US-067 : Studio SABOU mobile, en texte.
// Critère 1 : mêmes règles et même API que le Studio web — maladie, plantes ordonnées avec
//             la partie utilisée, cycle, sections, conservation facultative, consentement et
//             visibilité avant soumission ; refus de la base affichés tels quels.
// Critère 2 : « Mes traitements » avec l'état de chacun et, en attente, sa raison (US-046).
// Critère 3 : le praticien voit le motif du dernier renvoi ; les annotations du Comité restent
//             internes (§2.54, décision du maître d'œuvre du 18 novembre 2026).
// Critère 4 : texte seulement (aucune voix, aucun brouillon hors réseau : US-080, US-081).
// Les règles réelles (bornes, droits, verrou après soumission) sont prouvées par
// apps/api/src/treatments/studio.test.ts, sur la même API.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/dossier/session.dart';
import 'package:sabou_mobile/studio/studio_api.dart';
import 'package:sabou_mobile/studio/studio_pages.dart';
import 'package:sabou_mobile/ui/theme.dart';

import '../dossier/fakes.dart';

Map<String, Object?> completeFields({String title = 'Tisane du soir'}) => {
  'maladie': 'MAL-0001',
  'titreFr': title,
  'titreEn': '',
  'cycleDureeJours': 7,
  'cyclePrisesParJour': 2,
  'cyclePauseJours': null,
  'plantes': [
    {'plante': 'PLA-0001', 'partie': 'feuilles'},
  ],
  'sections': [
    for (final type in [
      'preparation',
      'consommation',
      'cycle',
      'effets_indesirables',
    ])
      {'type': type, 'texteFr': 'Texte $type', 'texteEn': ''},
  ],
  'contreIndications': <String>[],
  'consentement': true,
  'visibilite': 'publique',
};

void main() {
  late FakeServer server;
  late int signedOut;

  setUp(() {
    server = FakeServer();
    signedOut = 0;
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
            onSignedOut: () => signedOut++,
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

  Future<void> enter(WidgetTester tester, String key, String text) async {
    final finder = find.byKey(Key('studio-$key'));
    await tester.ensureVisible(finder);
    await tester.enterText(finder, text);
    await tester.pump();
  }

  Future<void> choose(WidgetTester tester, String key, String label) async {
    final finder = find.byKey(Key('studio-$key'));
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
    await tester.tap(find.text(label).last);
    await tester.pumpAndSettle();
  }

  Future<void> check(WidgetTester tester, String key) async {
    final finder = find.byKey(Key('studio-$key'));
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  // Dernière requête d'écriture reçue par l'API (POST ou PUT sur un traitement)
  Map<String, Object?> lastWrite() {
    final request = server.requests.lastWhere(
      (r) =>
          (r.method == 'POST' || r.method == 'PUT') &&
          r.url.path.contains('/traitements') &&
          !r.url.path.endsWith('/soumission'),
    );
    return jsonDecode(request.body) as Map<String, Object?>;
  }

  String? errorUnder(WidgetTester tester, String key) => tester
      .widget<TextField>(find.byKey(Key('studio-$key')))
      .decoration
      ?.errorText;

  group('Critère 1 : mêmes règles et même API que le Studio web', () {
    testWidgets(
      'crée, complète et soumet un traitement ; plantes ordonnées avec leur partie',
      (tester) async {
        await pumpStudio(tester);
        await tapText(tester, 'Nouveau traitement');
        expect(find.text('Nouveau traitement'), findsOneWidget);

        await choose(tester, 'maladie', 'Paludisme');
        await enter(tester, 'titreFr', '  Tisane du soir ');
        await choose(tester, 'plante-0', 'Neem (Azadirachta indica)');
        await enter(tester, 'partie-0', 'écorce');
        await tapText(tester, 'Ajouter une plante');
        await choose(tester, 'plante-1', 'Kinkéliba (Combretum micranthum)');
        await enter(tester, 'partie-1', 'feuilles');
        // Le Kinkéliba passe en premier : l'ordre de la préparation est celui de l'écran
        await tester.ensureVisible(find.text('Monter').at(1));
        await tester.tap(find.text('Monter').at(1));
        await tester.pumpAndSettle();
        await enter(tester, 'cycleDureeJours', '7');
        await enter(tester, 'cyclePrisesParJour', '2');
        for (final s in [
          'preparation',
          'consommation',
          'cycle',
          'effets_indesirables',
        ]) {
          await enter(tester, 'section-$s', 'Texte $s');
        }
        await check(tester, 'ci-grossesse');

        // Brouillon d'abord : enregistré sans consentement
        await tapText(tester, 'Enregistrer le brouillon');
        expect(find.text('Brouillon REC-1000 enregistré.'), findsOneWidget);
        final draft = lastWrite();
        expect(draft['titreFr'], 'Tisane du soir');
        expect(draft['plantes'], [
          {'plante': 'PLA-0001', 'partie': 'feuilles'},
          {'plante': 'PLA-0002', 'partie': 'écorce'},
        ]);
        expect(draft['cycleDureeJours'], 7);
        expect(draft['cyclePrisesParJour'], 2);
        expect(draft['cyclePauseJours'], isNull);
        expect(draft['contreIndications'], ['grossesse']);
        // Conservation facultative : non rédigée, non envoyée
        expect((draft['sections']! as List).map((s) => (s as Map)['type']), [
          'preparation',
          'consommation',
          'cycle',
          'effets_indesirables',
        ]);
        expect(draft['consentement'], isFalse);
        expect(draft['visibilite'], isNull);
        expect(
          find.textContaining(
            'Avant de soumettre : votre consentement et le niveau de visibilité.',
          ),
          findsOneWidget,
        );

        await check(tester, 'consentement');
        await check(tester, 'visibilite-restreinte');
        await tapText(tester, 'Soumettre pour certification');

        // Modification : la date lue est renvoyée (contrôle des modifications concurrentes)
        final put = server.requests.lastWhere((r) => r.method == 'PUT');
        expect(
          (jsonDecode(put.body) as Map)['vueLe'],
          startsWith('2026-11-18T10:00:00.'),
        );
        expect(lastWrite()['fields'], containsPair('visibilite', 'restreinte'));
        expect(
          server.requests.last.url.path,
          '/api/praticien/traitements/REC-1000/soumission',
        );
        expect(find.text('Traitement REC-1000 soumis.'), findsOneWidget);
        expect(
          find.textContaining(
            'Il est joint à votre dossier de certification DS-2001',
          ),
          findsOneWidget,
        );
        // Soumis : plus de formulaire
        expect(find.text('Enregistrer le brouillon'), findsNothing);
        expect(
          find.textContaining('Déconseillé : Femmes enceintes.'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'maladie et titre manquants : erreurs sous les champs, rien n’est envoyé',
      (tester) async {
        await pumpStudio(tester);
        await tapText(tester, 'Nouveau traitement');
        await tapText(tester, 'Enregistrer le brouillon');
        expect(errorUnder(tester, 'titreFr'), 'Donnez un titre au traitement.');
        expect(find.text('Choisissez la maladie soignée.'), findsOneWidget);
        expect(server.requests.where((r) => r.method == 'POST'), isEmpty);

        // Une saisie efface l'erreur du champ corrigé
        await enter(tester, 'titreFr', 'Tisane');
        expect(errorUnder(tester, 'titreFr'), isNull);
      },
    );

    testWidgets('consentement sans visibilité : erreur sous le choix', (
      tester,
    ) async {
      await pumpStudio(tester);
      await tapText(tester, 'Nouveau traitement');
      await choose(tester, 'maladie', 'Paludisme');
      await enter(tester, 'titreFr', 'Tisane');
      await check(tester, 'consentement');
      await tapText(tester, 'Enregistrer le brouillon');
      expect(find.byKey(const Key('studio-visibilite-erreur')), findsOneWidget);
      expect(server.requests.where((r) => r.method == 'POST'), isEmpty);
    });

    testWidgets(
      'soumission d’un traitement incomplet : ce qui manque est dit, rien n’est soumis',
      (tester) async {
        final code = server.seedTreatment({
          ...completeFields(),
          'sections': <Object>[],
        });
        await pumpStudio(tester);
        await tapText(tester, 'Tisane du soir');
        await tapText(tester, 'Soumettre pour certification');
        expect(
          find.text(
            'Avant de soumettre, complétez : les 4 sections obligatoires.',
          ),
          findsOneWidget,
        );
        expect(
          server.requests.any((r) => r.url.path.endsWith('/soumission')),
          isFalse,
        );
        expect(server.treatments[code]!['statut'], 'brouillon');
      },
    );

    testWidgets('refus de la base affiché tel quel (modifié entre-temps)', (
      tester,
    ) async {
      server.seedTreatment(completeFields());
      await pumpStudio(tester);
      await tapText(tester, 'Tisane du soir');
      server.nextStudioRefusal = (
        409,
        {
          'error': 'stale',
          'message': 'Ce traitement a été modifié entre-temps. Rechargez-le avant de l’enregistrer.',
        },
      );
      await tapText(tester, 'Enregistrer le brouillon');
      expect(
        find.text(
          'Ce traitement a été modifié entre-temps. Rechargez-le avant de l’enregistrer.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('plante en revue au Comité : signalée sous le choix', (
      tester,
    ) async {
      await pumpStudio(tester);
      await tapText(tester, 'Nouveau traitement');
      await choose(
        tester,
        'plante-0',
        'Quinquéliba rouge (Combretum glutinosum)',
      );
      expect(find.textContaining('En revue par le Comité'), findsOneWidget);
    });

    testWidgets('sans réseau : la saisie reste et l’écran le dit', (
      tester,
    ) async {
      await pumpStudio(tester);
      await tapText(tester, 'Nouveau traitement');
      await choose(tester, 'maladie', 'Paludisme');
      await enter(tester, 'titreFr', 'Tisane');
      server.offline = true;
      await tapText(tester, 'Enregistrer le brouillon');
      expect(
        find.text(
          'La demande n’a pas abouti. Vérifiez le réseau, puis réessayez.',
        ),
        findsOneWidget,
      );
      expect(find.text('Tisane'), findsOneWidget);
    });

    testWidgets('session expirée : retour à la connexion', (tester) async {
      await pumpStudio(tester);
      await tapText(tester, 'Nouveau traitement');
      await choose(tester, 'maladie', 'Paludisme');
      await enter(tester, 'titreFr', 'Tisane');
      server.validAccess.clear();
      server.keycloakRejectsRefresh = true;
      await tapText(tester, 'Enregistrer le brouillon');
      expect(signedOut, 1);
      // L'écran d'édition est fermé : la connexion ne reste pas cachée dessous
      expect(find.byType(TreatmentEditorPage), findsNothing);
    });
  });

  group('Critère 2 : « Mes traitements », état et raison d’attente', () {
    testWidgets('liste vide : invitation à créer le premier', (tester) async {
      await pumpStudio(tester);
      expect(
        find.textContaining('Aucun traitement pour le moment'),
        findsOneWidget,
      );
    });

    testWidgets('chaque traitement avec son état ; en attente, sa raison', (
      tester,
    ) async {
      server.seedTreatment(completeFields(title: 'Brouillon A'));
      server.seedTreatment(
        completeFields(title: 'Tisane B'),
        statut: 'expertisee',
        attente: 'quota',
      );
      server.seedTreatment(
        completeFields(title: 'Décoction C'),
        statut: 'certifiee',
      );
      await pumpStudio(tester);
      expect(find.text('Brouillon A'), findsOneWidget);
      expect(find.text('Brouillon'), findsOneWidget);
      expect(
        find.text('Expertisé, en attente de certification'),
        findsOneWidget,
      );
      expect(
        find.textContaining('limitée à 3 traitements certifiés'),
        findsOneWidget,
      );
      expect(find.text('Certifié'), findsOneWidget);
    });

    testWidgets('traitement soumis : lecture seule, aucune modification', (
      tester,
    ) async {
      server.seedTreatment(completeFields(), statut: 'transmise');
      await pumpStudio(tester);
      await tapText(tester, 'Tisane du soir');
      expect(find.text('Transmis au Comité scientifique'), findsWidgets);
      expect(find.text('Enregistrer le brouillon'), findsNothing);
      expect(find.text('1. Kinkéliba — feuilles'), findsOneWidget);
      // Retour à la liste : relue
      final lists = server.requests
          .where((r) => r.url.path == '/api/praticien/traitements')
          .length;
      await tester.tap(find.byTooltip('Retour'));
      await tester.pumpAndSettle();
      expect(
        server.requests
            .where((r) => r.url.path == '/api/praticien/traitements')
            .length,
        lists + 1,
      );
    });
  });

  group('Critère 3 : motif du dernier renvoi', () {
    testWidgets('brouillon renvoyé pour correction : le motif est en tête', (
      tester,
    ) async {
      server.seedTreatment(
        completeFields(),
        motif: 'Précisez la dose pour un adulte.',
      );
      await pumpStudio(tester);
      await tapText(tester, 'Tisane du soir');
      expect(
        find.text('Renvoyé pour correction : Précisez la dose pour un adulte.'),
        findsOneWidget,
      );
      // Les annotations du Comité ne sont jamais demandées (internes, §2.54)
      expect(
        server.requests.any((r) => r.url.path.contains('annotations')),
        isFalse,
      );
    });
  });

  group('Critère 4 et accessibilité (WCAG 2.2 AA)', () {
    testWidgets('texte seulement : aucun enregistrement de voix', (
      tester,
    ) async {
      await pumpStudio(tester);
      await tapText(tester, 'Nouveau traitement');
      expect(find.byIcon(Icons.mic), findsNothing);
      expect(find.textContaining('Enregistrer la voix'), findsNothing);
    });

    testWidgets('liste et formulaire : cibles, libellés et contraste', (
      tester,
    ) async {
      server.seedTreatment(completeFields());
      await pumpStudio(tester);
      Future<void> guidelines() async {
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      }

      final handle = tester.ensureSemantics();
      await guidelines();
      await tapText(tester, 'Tisane du soir');
      await guidelines();
      handle.dispose();
    });
  });
}
