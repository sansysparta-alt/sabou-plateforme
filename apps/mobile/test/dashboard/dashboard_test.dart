// US-090 (côté application) : le tableau de bord du praticien (CdC §6.6) montre ses
// traitements par état, la frise de certification de son dernier dossier et son certificat.
// API simulée ; le calcul et le cloisonnement (ses seules données) sont prouvés par
// packages/db/test/tableau-de-bord.test.ts et apps/api (dashboard).
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sabou_mobile/dashboard/dashboard_api.dart';
import 'package:sabou_mobile/dashboard/dashboard_page.dart';
import 'package:sabou_mobile/dossier/session.dart';
import 'package:sabou_mobile/ui/theme.dart';

import '../dossier/fakes.dart';

Map<String, Object?> _board({
  bool certified = false,
  bool withDossier = true,
}) => {
  'profil': 'praticien',
  'traitements': {
    'certifies': certified ? 3 : 0,
    'enExamen': 1,
    'brouillons': 2,
    'suspendus': 0,
  },
  'dossier': withDossier
      ? {
          'code': 'DS-1041',
          'statut': certified ? 'approuve' : 'en_cours',
          'etape': certified ? 6 : 2,
          'etapes': [
            for (var n = 1; n <= 6; n++)
              {
                'etape': n,
                'etat': certified || n < 2
                    ? 'franchie'
                    : n == 2
                    ? 'en_cours'
                    : 'a_venir',
                'le': certified || n <= 2 ? '2026-11-0${n}T10:00:00Z' : null,
              },
          ],
        }
      : null,
  'certificat': certified
      ? {
          'numero': 'CERT-2026-0042',
          'emisLe': '2026-11-06',
          'expireLe': '2029-11-06',
        }
      : null,
};

class DashboardServer {
  final requests = <http.Request>[];
  Map<String, Object?> board = _board();
  int status = 200;

  late final client = MockClient((request) async {
    requests.add(request);
    if (request.url.path == '/api/praticien/tableau-de-bord') {
      return http.Response.bytes(
        utf8.encode(jsonEncode(board)),
        status,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    }
    return http.Response('', 404);
  });
}

void main() {
  late DashboardServer server;
  late DashboardApi api;

  setUp(() async {
    server = DashboardServer();
    final session = PractitionerSession(
      store: MemorySecretStore(),
      launcher: FakeLauncher(),
      client: server.client,
      issuer: issuer,
    );
    await session.signIn();
    api = DashboardApi(
      baseUrl: Uri.parse('http://api.test'),
      session: session,
      client: server.client,
    );
  });

  Future<void> pump(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 4000);
    tester.view.devicePixelRatio = 2.5;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        theme: sabouTheme(),
        home: Scaffold(
          body: DashboardPage(api: api, onSignedOut: () {}),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  test('lecture avec le jeton de l’application', () async {
    final board = await api.load();
    expect(
      server.requests.single.headers['authorization'],
      startsWith('Bearer '),
    );
    expect(board.drafts, 2);
    expect(board.dossier!.steps, hasLength(6));
    expect(board.dossier!.steps[1].state, CertificationStepState.current);
    expect(board.dossier!.steps[2].at, isNull);
  });

  testWidgets(
    'traitements par état et frise : étape 2 en cours, suivantes à venir',
    (tester) async {
      await pump(tester);
      expect(find.text('Mes traitements'), findsOneWidget);
      expect(find.text('Brouillons'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      // Aucun traitement suspendu : pas de tuile vide
      expect(find.text('Suspendus'), findsNothing);
      expect(find.text('Dossier DS-1041'), findsOneWidget);
      expect(find.text('Soumission du dossier'), findsOneWidget);
      expect(find.text('Franchie le 01/11/2026'), findsOneWidget);
      expect(find.text('En cours depuis le 02/11/2026'), findsOneWidget);
      expect(find.text('À venir'), findsNWidgets(4));
      // Les indicateurs sans donnée (vues, écoutes, revenus) n'apparaissent pas
      expect(
        find.textContaining(
          RegExp('vues|écoutes|revenus', caseSensitive: false),
        ),
        findsNothing,
      );
    },
  );

  testWidgets(
    'praticien certifié : toutes les étapes franchies et son certificat',
    (tester) async {
      server.board = _board(certified: true);
      await pump(tester);
      expect(find.textContaining('Franchie le'), findsNWidgets(6));
      expect(
        find.text('Certificat CERT-2026-0042, valable jusqu’au 06/11/2029.'),
        findsOneWidget,
      );
    },
  );

  testWidgets('sans dossier : renvoi vers « Mon dossier »', (tester) async {
    server.board = _board(withDossier: false);
    await pump(tester);
    expect(find.textContaining('rubrique « Mon dossier »'), findsOneWidget);
  });

  testWidgets('erreur du serveur : message et bouton Réessayer', (
    tester,
  ) async {
    server.status = 500;
    await pump(tester);
    expect(find.textContaining('n’a pas pu être chargé'), findsOneWidget);
    server.status = 200;
    await tester.tap(find.text('Réessayer'));
    await tester.pumpAndSettle();
    expect(find.text('Mes traitements'), findsOneWidget);
  });

  testWidgets('chaque étape est annoncée avec son rang aux lecteurs d’écran', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await pump(tester);
    expect(
      find.bySemanticsLabel(
        RegExp(r'Étape 2 sur 6.*Vérification sur le terrain', dotAll: true),
      ),
      findsOneWidget,
    );
    semantics.dispose();
  });
}
