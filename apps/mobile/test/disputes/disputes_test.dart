// US-101 (côté application) : le praticien dépose son recours dans les 30 jours d'un rejet
// définitif, ouvre un litige, échange avec l'administration, joint des photos et lit la
// décision motivée. API simulée ; les règles (délai, un recours par rejet, qui décide, effets
// d'un recours accepté) sont prouvées par packages/db (litiges) et apps/api (disputes).
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sabou_mobile/disputes/disputes_api.dart';
import 'package:sabou_mobile/disputes/disputes_pages.dart';
import 'package:sabou_mobile/dossier/photo.dart';
import 'package:sabou_mobile/dossier/session.dart';
import 'package:sabou_mobile/ui/theme.dart';

import '../dossier/fakes.dart';

Map<String, Object?> _summary(
  String code, {
  String statut = 'ouvert',
  String? issue,
}) => {
  'code': code,
  'type': code == 'LT-00001' ? 'recours' : 'autre',
  'objet': code == 'LT-00001'
      ? 'Contestation du rejet définitif'
      : 'Photo refusée',
  'statut': statut,
  'issue': issue,
  'praticien': 'PR-1042',
  'praticienNom': 'Mamadou Diallo',
  'prefecture': 'Labé',
  'ouvertLe': '2026-11-19T08:00:00Z',
  'recoursJusquau': code == 'LT-00001' ? '2026-12-14' : null,
};

/// API simulée du praticien : liste, ouverture, détail, message, pièce.
class DisputesServer {
  final requests = <http.Request>[];
  bool canAppeal = true;
  final disputes = <String, Map<String, Object?>>{};
  final messages = <String, List<Map<String, Object?>>>{};
  int pieces = 0;
  String? refuse;

  late final client = MockClient((request) async {
    requests.add(request);
    final path = request.url.path.replaceFirst('/api/praticien/', '');
    if (refuse != null && request.method == 'POST') {
      return _json(409, {'error': 'too_late', 'message': refuse});
    }
    if (request.method == 'GET' && path == 'litiges') {
      return _json(200, {
        'recoursPossible': canAppeal,
        'recoursJusquau': '2026-12-14',
        'litiges': disputes.values.toList(),
      });
    }
    if (request.method == 'POST' && path == 'litiges') {
      final body = jsonDecode(request.body) as Map<String, Object?>;
      final code = body['type'] == 'recours' ? 'LT-00001' : 'LT-00002';
      disputes[code] = _summary(code);
      messages[code] = [
        {
          'id': 1,
          'auteur': 'praticien',
          'auteurNom': 'Mamadou Diallo',
          'contenu': body['message'],
          'le': '2026-11-19T08:00:00Z',
        },
      ];
      if (body['type'] == 'recours') canAppeal = false;
      return _json(201, {'code': code});
    }
    final match = RegExp(r'^litiges/(LT-\d{5})(/messages|/pieces)?$')
        .firstMatch(path);
    if (match != null) {
      final code = match.group(1)!;
      if (match.group(2) == '/messages') {
        messages[code]!.add({
          'id': messages[code]!.length + 1,
          'auteur': 'praticien',
          'auteurNom': 'Mamadou Diallo',
          'contenu': (jsonDecode(request.body) as Map)['contenu'],
          'le': '2026-11-19T09:00:00Z',
        });
        return http.Response('', 204);
      }
      if (match.group(2) == '/pieces') {
        pieces++;
        return _json(201, {'id': pieces});
      }
      final summary = disputes[code]!;
      return _json(200, {
        ...summary,
        'messages': messages[code],
        'pieces': [
          for (var i = 0; i < pieces; i++)
            {
              'id': i + 1,
              'mime': 'image/jpeg',
              'taille': 10,
              'parPraticien': true,
              'deposeLe': '2026-11-19T09:00:00Z',
            },
        ],
        'rejetMotif': code == 'LT-00001' ? 'Pièce falsifiée' : null,
        'avisSens': null,
        'avis': null,
        'avisLe': null,
        'decision': summary['statut'] == 'resolu'
            ? 'Pièce authentique, recours fondé.'
            : null,
        'decideLe': null,
        'certificat': summary['statut'] == 'resolu'
            ? 'SAB-2026-PR1042-ABC'
            : null,
      });
    }
    return http.Response('', 404);
  });

  static http.Response _json(int status, Object body) => http.Response.bytes(
    utf8.encode(jsonEncode(body)),
    status,
    headers: {'content-type': 'application/json; charset=utf-8'},
  );
}

class _Picker implements PhotoPicker {
  @override
  Future<Uint8List?> pick(PhotoOrigin origin) async =>
      Uint8List.fromList([0xff, 0xd8, 1, 2]);
}

void main() {
  late DisputesServer server;
  late DisputesApi api;

  setUp(() async {
    server = DisputesServer();
    final session = PractitionerSession(
      store: MemorySecretStore(),
      launcher: FakeLauncher(),
      client: server.client,
      issuer: issuer,
    );
    await session.signIn();
    api = DisputesApi(
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
          body: DisputesPage(
            api: api,
            picker: _Picker(),
            prepare: (b) async => b,
            onSignedOut: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  test(
    'recours : type, objet et message envoyés avec le jeton de l’application',
    () async {
      expect(
        await api.open(
          recourse: true,
          subject: 'Contestation',
          message: 'Pièce authentique.',
        ),
        'LT-00001',
      );
      final sent = server.requests.last;
      expect(sent.url.path, '/api/praticien/litiges');
      expect(sent.headers['authorization'], 'Bearer ${fakeAccess('acces-1')}');
      expect(jsonDecode(sent.body), {
        'type': 'recours',
        'objet': 'Contestation',
        'message': 'Pièce authentique.',
      });
    },
  );

  test('refus de la base dit tel quel (délai de 30 jours dépassé)', () async {
    server.refuse = 'Le délai de recours de 30 jours est dépassé.';
    await expectLater(
      api.open(recourse: true, subject: 'x', message: 'y'),
      throwsA(
        isA<DisputeException>().having((e) => e.code, 'code', 'too_late'),
      ),
    );
  });

  testWidgets('recours déposé dans le délai, échanges et photo jointe', (
    tester,
  ) async {
    await pump(tester);
    expect(find.textContaining('jusqu’au 14/12/2026'), findsOneWidget);
    await tester.tap(find.byKey(const Key('deposer-recours')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('litige-envoyer')));
    await tester.pumpAndSettle();
    expect(find.text('Expliquez ce que vous contestez.'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('litige-message')),
      'La pièce est authentique ; voici l’attestation.',
    );
    await tester.tap(find.byKey(const Key('litige-envoyer')));
    await tester.pumpAndSettle();
    // Détail du litige ouvert aussitôt
    expect(find.text('Litige LT-00001'), findsOneWidget);
    expect(
      find.text('Motif du rejet contesté : Pièce falsifiée'),
      findsOneWidget,
    );
    expect(
      find.text('La pièce est authentique ; voici l’attestation.'),
      findsOneWidget,
    );
    await tester.enterText(
      find.byKey(const Key('litige-reponse')),
      'Une précision.',
    );
    await tester.tap(find.byKey(const Key('litige-repondre')));
    await tester.pumpAndSettle();
    expect(find.text('Message envoyé.'), findsOneWidget);
    expect(find.text('Une précision.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('litige-photo')));
    await tester.pumpAndSettle();
    expect(find.text('Pièce jointe au litige.'), findsOneWidget);
    expect(find.text('1 pièce jointe.'), findsOneWidget);
    // Retour à la liste : plus de recours possible, le litige est listé
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('deposer-recours')), findsNothing);
    expect(find.byKey(const Key('litige-LT-00001')), findsOneWidget);
  });

  testWidgets(
    'décision motivée lue dans l’application, avec le nouveau certificat',
    (tester) async {
      server.canAppeal = false;
      server.disputes['LT-00001'] = _summary(
        'LT-00001',
        statut: 'resolu',
        issue: 'accepte',
      );
      server.messages['LT-00001'] = [];
      await pump(tester);
      expect(find.textContaining('Recours accepté'), findsOneWidget);
      await tester.tap(find.byKey(const Key('litige-LT-00001')));
      await tester.pumpAndSettle();
      expect(
        find.textContaining(
          'Pièce authentique, recours fondé. Nouveau certificat : SAB-2026-PR1042-ABC',
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('litige-reponse')), findsNothing);
    },
  );

  testWidgets(
    'sans rejet récent : pas de recours, un litige ordinaire reste possible',
    (tester) async {
      server.canAppeal = false;
      await pump(tester);
      expect(find.byKey(const Key('deposer-recours')), findsNothing);
      expect(find.text('Aucun litige pour le moment.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('ouvrir-litige')));
      await tester.pumpAndSettle();
      expect(find.text('Ouvrir un litige'), findsWidgets);
    },
  );

  testWidgets('écrans accessibles (WCAG 2.2 AA)', (tester) async {
    final handle = tester.ensureSemantics();
    await pump(tester);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));
    await tester.tap(find.byKey(const Key('deposer-recours')));
    await tester.pumpAndSettle();
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));
    handle.dispose();
  });
}
