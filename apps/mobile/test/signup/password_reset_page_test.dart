// US-069 : mot de passe oublié du praticien dans l'application mobile.
// Critère 1 : numéro, code reçu par SMS, nouveau mot de passe (règles de US-014), même API
//             que le site ; l'écran ne dit pas si le numéro a un compte.
// Critère 2 : code limité (essais restants, demande expirée) ; journal : test de l'API.
// Critère 3 : connexion suivante par Keycloak (double facteur conservé : test de l'API).
// Accès depuis l'écran de connexion : gate_test.dart.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/signup/password_reset_page.dart';
import 'package:sabou_mobile/ui/theme.dart';

import 'fake_signup_server.dart';

void main() {
  late FakeSignupServer server;
  late List<String> signInHints;

  setUp(() {
    server = FakeSignupServer();
    signInHints = [];
  });

  Future<void> pumpPage(WidgetTester tester, {Locale? locale}) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: sabouTheme(),
        locale: locale ?? const Locale('fr'),
        supportedLocales: const [Locale('fr'), Locale('en')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: PasswordResetPage(
          api: server.api(),
          signIn: (phone) async {
            signInHints.add(phone);
            return true;
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> enter(WidgetTester tester, String id, String text) =>
      tester.enterText(find.byKey(Key('reset-$id')), text);

  Future<void> tap(WidgetTester tester, String text) async {
    await tester.ensureVisible(find.text(text));
    await tester.tap(find.text(text));
    await tester.pumpAndSettle();
  }

  String? errorUnder(WidgetTester tester, String id) => tester
      .widget<TextField>(find.byKey(Key('reset-$id')))
      .decoration
      ?.errorText;

  Future<void> reachPassword(WidgetTester tester) async {
    await enter(tester, 'phone', '+224 621 23 45 67');
    await tap(tester, 'Recevoir le code');
    await enter(tester, 'code', FakeSignupServer.code);
    await tap(tester, 'Vérifier le code');
  }

  group('Critère 1 : numéro, code, nouveau mot de passe', () {
    testWidgets(
      'change le mot de passe puis ouvre la connexion avec le numéro',
      (tester) async {
        await pumpPage(tester);
        await reachPassword(tester);
        expect(find.text('Étape 3 sur 3'), findsOneWidget);
        await enter(tester, 'password', '40718293');
        await tap(tester, 'Changer le mot de passe');
        expect(
          find.textContaining('déconnecté de tous vos appareils'),
          findsOneWidget,
        );

        expect(server.requests.map((r) => r.path), [
          'reset/code',
          'reset/verification',
          'reset/nouveau',
        ]);
        expect(server.requests[0].body, {'phone': '621234567'});
        expect(server.requests[2].body, {
          'ticket': FakeSignupServer.ticket,
          'password': '40718293',
        });
        expect(server.requests.every((r) => r.origin == null), isTrue);

        await tap(tester, 'Se connecter');
        expect(signInHints, ['621234567']);
      },
    );

    testWidgets('ne dit pas si le numéro a un compte', (tester) async {
      await pumpPage(tester);
      await enter(tester, 'phone', '621234567');
      await tap(tester, 'Recevoir le code');
      expect(
        find.text(
          'Si le 621 23 45 67 a un compte SABOU, un code vient de lui être envoyé par SMS.',
        ),
        findsOneWidget,
      );
    });

    testWidgets(
      'numéro invalide et mot de passe trop facile : erreur sous le champ',
      (tester) async {
        await pumpPage(tester);
        await enter(tester, 'phone', '721234567');
        await tap(tester, 'Recevoir le code');
        expect(
          errorUnder(tester, 'phone'),
          'Saisissez un numéro de mobile guinéen : 9 chiffres commençant par 6.',
        );
        expect(server.requests, isEmpty);

        await reachPassword(tester);
        await enter(tester, 'password', '12345678');
        await tap(tester, 'Changer le mot de passe');
        expect(
          errorUnder(tester, 'password'),
          'Ce mot de passe est trop facile à deviner.',
        );
        expect(
          server.requests.where((r) => r.path == 'reset/nouveau'),
          isEmpty,
        );
      },
    );
  });

  group('Critère 2 : code limité', () {
    testWidgets('mauvais code : essais restants sous le champ', (tester) async {
      await pumpPage(tester);
      await enter(tester, 'phone', '621234567');
      await tap(tester, 'Recevoir le code');
      await enter(tester, 'code', '654321');
      await tap(tester, 'Vérifier le code');
      expect(
        errorUnder(tester, 'code'),
        'Code incorrect. Essais restants : 3.',
      );
    });

    testWidgets('demande expirée : retour au numéro, le numéro reste', (
      tester,
    ) async {
      server.expireNextTicket = true;
      await pumpPage(tester);
      await reachPassword(tester);
      await enter(tester, 'password', '40718293');
      await tap(tester, 'Changer le mot de passe');
      expect(
        find.text('Cette demande a expiré. Recommencez avec votre numéro.'),
        findsOneWidget,
      );
      expect(find.text('Étape 1 sur 3'), findsOneWidget);
      expect(find.text('+224 621 23 45 67'), findsOneWidget);
    });
  });

  group('Sans réseau, langues, accessibilité', () {
    testWidgets('sans réseau : l’écran le dit, la saisie reste', (
      tester,
    ) async {
      await pumpPage(tester);
      await reachPassword(tester);
      await enter(tester, 'password', '40718293');
      server.offline = true;
      await tap(tester, 'Changer le mot de passe');
      expect(find.textContaining('Pas de réseau'), findsOneWidget);
      expect(find.text('Étape 3 sur 3'), findsOneWidget);
      server.offline = false;
      await tap(tester, 'Changer le mot de passe');
      expect(
        find.textContaining('déconnecté de tous vos appareils'),
        findsOneWidget,
      );
    });

    testWidgets('en anglais si le téléphone est en anglais', (tester) async {
      await pumpPage(tester, locale: const Locale('en'));
      expect(find.text('Forgot password'), findsOneWidget);
      expect(find.text('Get the code'), findsOneWidget);
    });

    testWidgets('chaque étape respecte les règles d’accessibilité', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      await pumpPage(tester);
      Future<void> check() async {
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      }

      await check();
      await reachPassword(tester);
      await check();
      handle.dispose();
    });
  });
}
