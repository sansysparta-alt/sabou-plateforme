// US-066 : inscription du praticien depuis l'application mobile.
// Critère 1 : numéro, code par SMS, prénom et nom, mot de passe ; même API que le site ;
//             erreurs sous le champ concerné.
// Critère 2 : à la fin, la page de connexion s'ouvre avec le numéro (connexion → dossier :
//             gate_test.dart).
// Critère 3 : sans réseau, l'écran le dit et la saisie reste.
// Critère 4 : textes en français et en anglais ; accessibilité.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/signup/signup_page.dart';
import 'package:sabou_mobile/ui/theme.dart';

import 'fake_signup_server.dart';

void main() {
  late FakeSignupServer server;
  late List<String> signInHints;
  late bool signInResult;

  setUp(() {
    server = FakeSignupServer();
    signInHints = [];
    signInResult = true;
  });

  Future<void> pumpPage(WidgetTester tester, {Locale? locale}) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: sabouTheme(),
        locale: locale,
        supportedLocales: const [Locale('fr'), Locale('en')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: SignupPage(
          api: server.api(),
          signIn: (phone) async {
            signInHints.add(phone);
            return signInResult;
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> enter(WidgetTester tester, String id, String text) async {
    await tester.enterText(find.byKey(Key('signup-$id')), text);
  }

  Future<void> tap(WidgetTester tester, String text) async {
    await tester.ensureVisible(find.text(text));
    await tester.tap(find.text(text));
    await tester.pumpAndSettle();
  }

  // Message d'erreur affiché sous le champ (InputDecoration.errorText)
  String? errorUnder(WidgetTester tester, String id) => tester
      .widget<TextField>(find.byKey(Key('signup-$id')))
      .decoration
      ?.errorText;

  Future<void> reachIdentity(WidgetTester tester) async {
    await enter(tester, 'phone', '+224 621 23 45 67');
    await tap(tester, 'Recevoir le code');
    await enter(tester, 'code', FakeSignupServer.code);
    await tap(tester, 'Vérifier le code');
  }

  group('Critère 1 : numéro, code, identité et mot de passe, par l’API du site', () {
    testWidgets('crée un compte praticien en trois étapes', (tester) async {
      await pumpPage(tester);
      expect(find.text('Étape 1 sur 3'), findsOneWidget);
      await enter(tester, 'phone', '+224 621 23 45 67');
      await tap(tester, 'Recevoir le code');
      expect(find.text('Étape 2 sur 3'), findsOneWidget);
      expect(find.text('Code envoyé par SMS au 621 23 45 67.'), findsOneWidget);

      await enter(tester, 'code', FakeSignupServer.code);
      await tap(tester, 'Vérifier le code');
      expect(find.text('Étape 3 sur 3'), findsOneWidget);

      await enter(tester, 'firstName', ' Mariama ');
      await enter(tester, 'lastName', 'Soumah');
      await enter(tester, 'password', '40718293');
      await tap(tester, 'Créer mon compte');

      expect(server.requests.map((r) => r.path), [
        'code',
        'verification',
        'compte',
      ]);
      expect(server.requests[0].body, {'phone': '621234567'});
      expect(server.requests[1].body, {
        'phone': '621234567',
        'code': FakeSignupServer.code,
      });
      expect(server.requests[2].body, {
        'ticket': FakeSignupServer.ticket,
        'profile': 'praticien',
        'firstName': 'Mariama',
        'lastName': 'Soumah',
        'password': '40718293',
      });
      // Client natif : pas d'en-tête Origin (accepté par l'API, signup.test.ts)
      expect(server.requests.every((r) => r.origin == null), isTrue);
    });

    testWidgets('numéro invalide : erreur sous le champ, aucun SMS', (
      tester,
    ) async {
      await pumpPage(tester);
      await enter(tester, 'phone', '721234567');
      await tap(tester, 'Recevoir le code');
      expect(
        errorUnder(tester, 'phone'),
        'Saisissez un numéro de mobile guinéen : 9 chiffres commençant par 6.',
      );
      expect(server.requests, isEmpty);
    });

    testWidgets(
      'mauvais code : erreur sous le champ avec les essais restants',
      (tester) async {
        await pumpPage(tester);
        await enter(tester, 'phone', '621234567');
        await tap(tester, 'Recevoir le code');
        await enter(tester, 'code', '12345');
        await tap(tester, 'Vérifier le code');
        expect(
          errorUnder(tester, 'code'),
          'Le code reçu par SMS compte 6 chiffres.',
        );
        await enter(tester, 'code', '654321');
        await tap(tester, 'Vérifier le code');
        expect(
          errorUnder(tester, 'code'),
          'Code incorrect. Essais restants : 3.',
        );
        expect(find.text('Étape 2 sur 3'), findsOneWidget);
      },
    );

    testWidgets(
      'prénom, nom et mot de passe refusés : une erreur sous chaque champ',
      (tester) async {
        await pumpPage(tester);
        await reachIdentity(tester);
        await enter(tester, 'firstName', 'Ali2');
        await enter(tester, 'password', '621234567');
        await tap(tester, 'Créer mon compte');
        expect(
          errorUnder(tester, 'firstName'),
          'Le prénom ne contient que des lettres.',
        );
        expect(errorUnder(tester, 'lastName'), 'Indiquez votre nom.');
        expect(
          errorUnder(tester, 'password'),
          'Le mot de passe ne doit pas reprendre votre numéro de téléphone.',
        );
        expect(server.requests.where((r) => r.path == 'compte'), isEmpty);
      },
    );

    testWidgets('numéro déjà inscrit : invitation à se connecter', (
      tester,
    ) async {
      server.existing.add('621234567');
      await pumpPage(tester);
      await reachIdentity(tester);
      expect(
        find.text(
          'Ce numéro a déjà un compte. Connectez-vous avec votre mot de passe.',
        ),
        findsOneWidget,
      );
      await tap(tester, 'Se connecter');
      expect(signInHints, ['621234567']);
    });
  });

  group('Critère 2 : connexion à la fin', () {
    testWidgets('ouvre la connexion avec le numéro déjà rempli', (
      tester,
    ) async {
      await pumpPage(tester);
      await reachIdentity(tester);
      await enter(tester, 'firstName', 'Mariama');
      await enter(tester, 'lastName', 'Soumah');
      await enter(tester, 'password', '40718293');
      await tap(tester, 'Créer mon compte');
      expect(signInHints, ['621234567']);
    });

    testWidgets(
      'connexion fermée : le compte est créé, bouton pour reprendre',
      (tester) async {
        signInResult = false;
        await pumpPage(tester);
        await reachIdentity(tester);
        await enter(tester, 'firstName', 'Mariama');
        await enter(tester, 'lastName', 'Soumah');
        await enter(tester, 'password', '40718293');
        await tap(tester, 'Créer mon compte');
        expect(find.textContaining('Votre compte est créé.'), findsOneWidget);
        await tap(tester, 'Se connecter');
        expect(signInHints, ['621234567', '621234567']);
      },
    );
  });

  group('Critère 3 : sans réseau', () {
    testWidgets('le numéro reste et l’écran le dit', (tester) async {
      server.offline = true;
      await pumpPage(tester);
      await enter(tester, 'phone', '621 23 45 67');
      await tap(tester, 'Recevoir le code');
      expect(
        find.text(
          'Pas de réseau : votre saisie est gardée. Réessayez quand le réseau revient.',
        ),
        findsOneWidget,
      );
      expect(find.text('621 23 45 67'), findsOneWidget);
      expect(find.text('Étape 1 sur 3'), findsOneWidget);

      server.offline = false;
      await tap(tester, 'Recevoir le code');
      expect(find.text('Étape 2 sur 3'), findsOneWidget);
    });

    testWidgets('prénom, nom et mot de passe restent à la dernière étape', (
      tester,
    ) async {
      await pumpPage(tester);
      await reachIdentity(tester);
      await enter(tester, 'firstName', 'Mariama');
      await enter(tester, 'lastName', 'Soumah');
      await enter(tester, 'password', '40718293');
      server.offline = true;
      await tap(tester, 'Créer mon compte');
      expect(find.textContaining('Pas de réseau'), findsOneWidget);
      expect(find.text('Mariama'), findsOneWidget);
      expect(find.text('Soumah'), findsOneWidget);
      expect(signInHints, isEmpty);

      server.offline = false;
      await tap(tester, 'Créer mon compte');
      expect(signInHints, ['621234567']);
    });
  });

  group('Critère 4 : langues et accessibilité', () {
    testWidgets('en anglais si le téléphone est en anglais', (tester) async {
      await pumpPage(tester, locale: const Locale('en'));
      expect(find.text('Create a practitioner account'), findsOneWidget);
      await enter(tester, 'phone', '12');
      await tap(tester, 'Get the code');
      expect(
        errorUnder(tester, 'phone'),
        'Enter a Guinean mobile number: 9 digits starting with 6.',
      );
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
      await reachIdentity(tester);
      await check();
      handle.dispose();
    });
  });
}
