// US-018, critères 2, 4 et 5 : porte d'entrée de l'application. Profil lu dans le jeton et
// gardé sur le téléphone ; citoyen renvoyé vers le site public ; ouverture sans réseau ;
// prototypes absents de la version publiée.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/dev/prototypes.dart';
import 'package:sabou_mobile/dossier/session.dart';
import 'package:sabou_mobile/shell/gate.dart';
import 'package:sabou_mobile/shell/rubric.dart';
import 'package:sabou_mobile/ui/theme.dart';

import '../dossier/fakes.dart';
import '../signup/fake_signup_server.dart';

void main() {
  late FakeServer server;
  late MemorySecretStore store;
  late FakeLauncher launcher;
  late List<Uri> opened;
  late FakeSignupServer signupServer;

  setUp(() {
    server = FakeServer();
    store = MemorySecretStore();
    launcher = FakeLauncher();
    opened = [];
    signupServer = FakeSignupServer();
  });

  Rubric rubric(String id, String label, SabouProfile profile) => Rubric(
    id: id,
    label: label,
    icon: Icons.circle_outlined,
    selectedIcon: Icons.circle,
    profiles: {profile},
    builder: (context, rubric) => Center(child: Text('Contenu $label')),
  );

  final registry = [
    rubric('dossier', 'Mon dossier', SabouProfile.practitioner),
    rubric('agenda', 'Agenda', SabouProfile.fieldAgent),
  ];

  Future<void> pumpGate(WidgetTester tester, {Widget? devTools}) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: sabouTheme(),
        home: SabouGate(
          session: PractitionerSession(
            store: store,
            launcher: launcher,
            client: server.client,
            issuer: issuer,
          ),
          rubrics: registry,
          openUrl: (url) async => opened.add(url),
          signupApi: signupServer.api(),
          siteUrl: Uri.parse('http://site.test'),
          devTools: devTools,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tap(WidgetTester tester, String text) async {
    await tester.tap(find.text(text));
    await tester.pumpAndSettle();
  }

  group('Critère 2 : rubriques du profil connecté', () {
    testWidgets('praticien : ses rubriques après la connexion', (tester) async {
      await pumpGate(tester);
      await tap(tester, 'Se connecter');
      expect(find.text('Contenu Mon dossier'), findsOneWidget);
      expect(find.text('Contenu Agenda'), findsNothing);
      expect(store.values['sabou.session.roles'], 'praticien');
    });

    testWidgets('agent préfectoral (rôles gardés) : ses rubriques seulement', (
      tester,
    ) async {
      store.values['sabou.praticien.refresh_token'] = 'rafraichissement-1';
      store.values['sabou.session.roles'] = 'admin_prefectoral';
      await pumpGate(tester);
      expect(find.text('Contenu Agenda'), findsOneWidget);
      expect(find.text('Contenu Mon dossier'), findsNothing);
    });
  });

  group('US-066 : inscription dans l’application', () {
    testWidgets(
      'le compte créé, le praticien est connecté et arrive sur son dossier',
      (tester) async {
        await pumpGate(tester);
        await tap(tester, 'Créer un compte praticien');
        await tester.enterText(
          find.byKey(const Key('signup-phone')),
          '621234567',
        );
        await tap(tester, 'Recevoir le code');
        await tester.enterText(
          find.byKey(const Key('signup-code')),
          FakeSignupServer.code,
        );
        await tap(tester, 'Vérifier le code');
        await tester.enterText(
          find.byKey(const Key('signup-firstName')),
          'Mariama',
        );
        await tester.enterText(
          find.byKey(const Key('signup-lastName')),
          'Soumah',
        );
        await tester.enterText(
          find.byKey(const Key('signup-password')),
          '40718293',
        );
        await tester.ensureVisible(find.text('Créer mon compte'));
        await tap(tester, 'Créer mon compte');
        expect(launcher.lastLoginHint, '621234567');
        expect(find.text('Contenu Mon dossier'), findsOneWidget);
        // Plus aucun renvoi vers l'inscription du site
        expect(opened, isEmpty);
      },
    );
  });

  group('Critère 4 : le citoyen passe par le site public', () {
    testWidgets(
      'compte citoyen : aucune rubrique, session révoquée, lien vers le site',
      (tester) async {
        launcher.next = Tokens(
          accessToken: fakeAccess('acces-1', ['citoyen']),
          refreshToken: 'rafraichissement-1',
          expiresAt: DateTime.now().add(const Duration(minutes: 5)),
        );
        await pumpGate(tester);
        await tap(tester, 'Se connecter');
        expect(
          find.text(
            'Application réservée aux praticiens et aux agents de terrain',
          ),
          findsOneWidget,
        );
        expect(find.textContaining('Contenu'), findsNothing);
        // Rien ne reste sur le téléphone, et Keycloak a révoqué la session
        expect(store.values['sabou.praticien.refresh_token'], '');
        expect(store.values['sabou.session.roles'], '');
        expect(server.requests.last.url.path, endsWith('/revoke'));

        await tap(tester, 'Ouvrir le site SABOU');
        expect(opened, [Uri.parse('http://site.test')]);
        await tap(tester, 'Se connecter avec un autre compte');
        expect(find.text('Se connecter'), findsOneWidget);
      },
    );

    testWidgets('écran du citoyen accessible (WCAG 2.2 AA)', (tester) async {
      final handle = tester.ensureSemantics();
      launcher.next = Tokens(
        accessToken: fakeAccess('acces-1', ['citoyen']),
        refreshToken: 'rafraichissement-1',
        expiresAt: DateTime.now().add(const Duration(minutes: 5)),
      );
      await pumpGate(tester);
      await tap(tester, 'Se connecter');
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  });

  group('Critère 5 : ouverture sans réseau', () {
    testWidgets(
      'session et rôles gardés : rubriques ouvertes sans aucune requête',
      (tester) async {
        store.values['sabou.praticien.refresh_token'] = 'rafraichissement-1';
        store.values['sabou.session.roles'] = 'praticien';
        server.offline = true;
        await pumpGate(tester);
        expect(find.text('Contenu Mon dossier'), findsOneWidget);
        expect(server.requests, isEmpty);
        expect(launcher.calls, 0);
      },
    );

    testWidgets(
      'session d’avant US-018 (rôles inconnus) sans réseau : message et « Réessayer »',
      (tester) async {
        store.values['sabou.praticien.refresh_token'] = 'rafraichissement-1';
        server.offline = true;
        await pumpGate(tester);
        expect(find.textContaining('Vérifiez le réseau'), findsOneWidget);
        server.offline = false;
        await tap(tester, 'Réessayer');
        expect(find.text('Contenu Mon dossier'), findsOneWidget);
        expect(store.values['sabou.session.roles'], 'praticien');
      },
    );
  });

  group('Critère 7 : prototypes hors de la version publiée', () {
    test(
      'le bouton des prototypes n’existe qu’en version de développement',
      () {
        expect(devToolsButton(debug: false), isNull);
        expect(devToolsButton(debug: true), isNotNull);
      },
    );

    testWidgets('version publiée : aucun accès aux prototypes', (tester) async {
      await pumpGate(tester, devTools: devToolsButton(debug: false));
      expect(find.byTooltip('Prototypes (développement)'), findsNothing);
      await tap(tester, 'Se connecter');
      expect(find.byTooltip('Prototypes (développement)'), findsNothing);
    });

    testWidgets('version de développement : prototypes dans la barre du haut', (
      tester,
    ) async {
      await pumpGate(tester, devTools: devToolsButton(debug: true));
      await tester.tap(find.byTooltip('Prototypes (développement)'));
      await tester.pumpAndSettle();
      expect(find.text('Studio (essai)'), findsOneWidget);
      expect(find.text('Dossiers de terrain'), findsOneWidget);
    });
  });
}
