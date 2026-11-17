// US-040b : écrans du praticien dans l'application complète (US-018), avec le vrai client de l'API et la vraie session, devant un
// serveur simulé (fakes.dart). Critères 1 (connexion), 2 (photo compressée avant l'envoi) et
// 3 (pièces manquantes affichées, accusé de réception), accessibilité des écrans.
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/app.dart';
import 'package:sabou_mobile/dossier/dossier_api.dart';
import 'package:sabou_mobile/dossier/photo.dart';
import 'package:sabou_mobile/dossier/session.dart';
import 'package:sabou_mobile/shell/gate.dart';
import 'package:sabou_mobile/ui/theme.dart';

import '../signup/fake_signup_server.dart';
import 'fakes.dart';

class FakePicker implements PhotoPicker {
  final picked = <PhotoOrigin>[];
  Uint8List? next = Uint8List.fromList(List.filled(3 * 1024 * 1024, 1));

  @override
  Future<Uint8List?> pick(PhotoOrigin origin) async {
    picked.add(origin);
    return next;
  }
}

void main() {
  late FakeServer server;
  late MemorySecretStore store;
  late FakeLauncher launcher;
  late FakePicker picker;
  late List<Uri> opened;
  late List<int> preparedSizes;

  setUp(() {
    server = FakeServer();
    store = MemorySecretStore();
    launcher = FakeLauncher();
    picker = FakePicker();
    opened = [];
    preparedSizes = [];
  });

  // Préparation simulée : la vraie compression est prouvée par photo_test.dart. Ici : la
  // photo envoyée est bien celle qui sort de la préparation, jamais l'originale.
  Future<Uint8List> prepare(Uint8List original) async {
    preparedSizes.add(original.length);
    return Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
  }

  // Application complète (US-018) : porte d'entrée, coquille et rubrique « Mon dossier »
  Widget app({Future<Uint8List> Function(Uint8List)? prepareWith}) {
    final session = PractitionerSession(
      store: store,
      launcher: launcher,
      client: server.client,
      issuer: issuer,
    );
    return MaterialApp(
      theme: sabouTheme(),
      home: SabouGate(
        session: session,
        rubrics: appRubrics(
          dossierApi: DossierApi(
            baseUrl: Uri.parse('http://api.test'),
            session: session,
            client: server.client,
          ),
          picker: picker,
          prepare: prepareWith ?? prepare,
        ),
        openUrl: (url) async => opened.add(url),
        signupApi: FakeSignupServer().api(),
        siteUrl: Uri.parse('http://site.test'),
      ),
    );
  }

  Future<void> pumpHome(WidgetTester tester) async {
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();
  }

  Future<void> tapText(WidgetTester tester, String text) async {
    final finder = find.text(text);
    await tester.ensureVisible(finder.first);
    await tester.tap(finder.first);
    await tester.pumpAndSettle();
  }

  Future<void> choose(WidgetTester tester, String field, String value) async {
    await tester.ensureVisible(find.text(field));
    await tester.tap(find.text(field));
    await tester.pumpAndSettle();
    await tester.tap(find.text(value).last);
    await tester.pumpAndSettle();
  }

  Future<void> fillProfile(WidgetTester tester) async {
    await choose(tester, 'Spécialité', 'Herboristerie');
    await choose(tester, 'Préfecture', 'Labé');
    await choose(tester, 'Langue principale', 'Pular');
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Années d’expérience'),
      '12',
    );
    await tapText(tester, 'Enregistrer la fiche');
  }

  group('Critère 1 : connexion', () {
    testWidgets(
      '« Se connecter » ouvre la page de Keycloak puis affiche le dossier',
      (tester) async {
        await pumpHome(tester);
        expect(find.text('Se connecter'), findsOneWidget);
        await tapText(tester, 'Se connecter');
        expect(launcher.calls, 1);
        expect(find.text('Ma fiche'), findsOneWidget);
        // Le dossier est lu avec le jeton de l'application
        expect(
          server.requests
              .where((r) => r.url.path == '/api/praticien/dossier')
              .single
              .headers['authorization'],
          'Bearer ${fakeAccess('acces-1')}',
        );
      },
    );

    testWidgets(
      '« Créer un compte » ouvre l’inscription dans l’application (US-066)',
      (tester) async {
        await pumpHome(tester);
        await tapText(tester, 'Créer un compte praticien');
        expect(find.text('Étape 1 sur 3'), findsOneWidget);
        expect(opened, isEmpty);
      },
    );

    testWidgets(
      'session gardée sur le téléphone : le dossier s’ouvre sans reconnexion',
      (tester) async {
        store.values['sabou.praticien.refresh_token'] = 'rafraichissement-1';
        await pumpHome(tester);
        expect(find.text('Ma fiche'), findsOneWidget);
        expect(launcher.calls, 0);
      },
    );

    testWidgets('session expirée : retour à l’écran de connexion', (
      tester,
    ) async {
      store.values['sabou.praticien.refresh_token'] = 'rafraichissement-1';
      server.keycloakRejectsRefresh = true;
      await pumpHome(tester);
      expect(find.text('Se connecter'), findsOneWidget);
    });

    testWidgets(
      '« Se déconnecter » révoque la session et revient à la connexion',
      (tester) async {
        await pumpHome(tester);
        await tapText(tester, 'Se connecter');
        await tapText(tester, 'Se déconnecter');
        expect(find.text('Se connecter'), findsOneWidget);
        expect(server.requests.last.url.path, endsWith('/revoke'));
        expect(store.values['sabou.praticien.refresh_token'], '');
      },
    );
  });

  testWidgets(
    'US-018 : « Se déconnecter » pendant le chargement du dossier, sans erreur',
    (tester) async {
      await pumpHome(tester);
      server.delay = const Duration(seconds: 2);
      await tester.tap(find.text('Se connecter'));
      await tester.pump();
      await tester.pump();
      expect(find.bySemanticsLabel('Chargement du dossier'), findsOneWidget);
      await tester.tap(find.text('Se déconnecter'));
      // La coquille disparaît avant que l'API réponde
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Se connecter'), findsOneWidget);
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(find.text('Se connecter'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  group('Critères 2 et 3 : photo, pièces manquantes, accusé de réception', () {
    testWidgets('dossier rempli et soumis depuis l’application', (
      tester,
    ) async {
      await pumpHome(tester);
      await tapText(tester, 'Se connecter');

      // Fiche
      await fillProfile(tester);
      expect(find.text('Fiche enregistrée.'), findsOneWidget);
      expect(server.profile, {
        'specialiteId': 1,
        'prefectureId': 4,
        'sousPrefectureId': null,
        'languePrincipale': 'pul',
        'anneesExperience': 12,
      });

      // Pièces obligatoires rappelées avant tout dépôt, sans ton d'erreur
      expect(
        find.text('Pièces à déposer : pièce d’identité, photo du praticien.'),
        findsOneWidget,
      );

      // Critère 2 : photo prise, préparée (compressée) puis envoyée en JPEG
      await tapText(tester, 'Prendre une photo');
      expect(picker.picked, [PhotoOrigin.camera]);
      expect(preparedSizes, [3 * 1024 * 1024]);
      final upload = server.requests.lastWhere((r) => r.method == 'POST');
      expect(upload.url.path, '/api/praticien/dossier/pieces/identite');
      expect(upload.headers['content-type'], 'image/jpeg');
      expect(upload.bodyBytes, [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
      expect(find.text('Pièce d’identité ajoutée.'), findsOneWidget);
      expect(
        find.text('Pièces à déposer : photo du praticien.'),
        findsOneWidget,
      );

      // Critère 3 : soumission refusée, pièces manquantes affichées (message de l'API)
      await tapText(tester, 'Soumettre mon dossier');
      expect(
        find.text('Pièces obligatoires manquantes : photo du praticien.'),
        findsWidgets,
      );
      expect(server.submitted, isFalse);

      // Photo du praticien depuis la galerie, puis soumission : accusé de réception
      await tester.ensureVisible(find.text('Choisir dans la galerie').at(1));
      await tester.tap(find.text('Choisir dans la galerie').at(1));
      await tester.pumpAndSettle();
      expect(server.uploads.keys, ['identite', 'photo']);
      await tapText(tester, 'Soumettre mon dossier');
      expect(server.submitted, isTrue);
      expect(
        find.textContaining('Dossier DS-2001 bien reçu le 08/11/2026'),
        findsOneWidget,
      );
      expect(
        find.textContaining('Un SMS de confirmation vous est envoyé.'),
        findsOneWidget,
      );
      // Dossier en examen : plus aucune modification proposée
      expect(find.text('Soumettre mon dossier'), findsNothing);
      expect(find.text('Prendre une photo'), findsNothing);
    });

    testWidgets(
      'une pièce déposée peut être retirée tant que le dossier est à l’étape 1',
      (tester) async {
        await pumpHome(tester);
        await tapText(tester, 'Se connecter');
        await fillProfile(tester);
        await tapText(tester, 'Prendre une photo');
        expect(server.pieces, hasLength(1));
        await tapText(tester, 'Retirer');
        expect(server.pieces, isEmpty);
        expect(find.text('Pièce d’identité retirée.'), findsOneWidget);
      },
    );

    testWidgets(
      'photo trop lourde ou illisible : message clair, rien n’est envoyé',
      (tester) async {
        await pumpHome(tester);
        await tapText(tester, 'Se connecter');
        await fillProfile(tester);
        await tester.pumpWidget(
          app(
            prepareWith: (_) async => throw const PhotoException(
              'Cette image n’a pas pu être lue. Prenez une autre photo.',
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tapText(tester, 'Prendre une photo');
        expect(
          find.text('Cette image n’a pas pu être lue. Prenez une autre photo.'),
          findsOneWidget,
        );
        expect(server.uploads, isEmpty);
      },
    );

    testWidgets('fiche incomplète : erreurs affichées, rien n’est envoyé', (
      tester,
    ) async {
      await pumpHome(tester);
      await tapText(tester, 'Se connecter');
      await tapText(tester, 'Enregistrer la fiche');
      // Un message court sous chaque champ, qui dit quoi choisir
      expect(find.text('Choisissez la spécialité.'), findsOneWidget);
      expect(find.text('Choisissez la préfecture.'), findsOneWidget);
      expect(find.text('Choisissez la langue principale.'), findsOneWidget);
      expect(find.text('Saisissez un nombre de 0 à 80.'), findsOneWidget);
      expect(server.requests.where((r) => r.method == 'PUT'), isEmpty);
    });
  });

  group('Accessibilité (WCAG 2.2 AA)', () {
    Future<void> checkGuidelines(WidgetTester tester) async {
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
    }

    testWidgets('écran de connexion', (tester) async {
      final handle = tester.ensureSemantics();
      await pumpHome(tester);
      await checkGuidelines(tester);
      handle.dispose();
    });

    testWidgets('écran du dossier, avec message d’erreur', (tester) async {
      final handle = tester.ensureSemantics();
      await pumpHome(tester);
      await tapText(tester, 'Se connecter');
      await fillProfile(tester);
      await tapText(tester, 'Soumettre mon dossier');
      // Écran assez haut pour toute la page : une cible coupée par le bord du défilement
      // fausserait la mesure ; chaque élément est ainsi contrôlé entier
      tester.view.physicalSize = const Size(800, 4000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpAndSettle();
      await checkGuidelines(tester);
      handle.dispose();
    });
  });
}
