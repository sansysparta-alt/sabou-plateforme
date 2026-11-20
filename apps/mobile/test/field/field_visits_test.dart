// US-083 (côté application), décisions du maître d'œuvre du 19 novembre 2026 (§2.87) :
// critère : agenda des visites (gardé pour l'usage sans réseau), itinéraire (ordre de la
// tournée, localité seule passée à l'application de cartes), compte rendu signé sans réseau
// et photo de la fiche ajoutée au dossier, envoyés sans doublon au retour du réseau.
// Les règles réelles (préfecture, étape 2, empreinte SHA3-256, heure déclarée bornée) sont
// prouvées par packages/db (agenda-terrain, visites-terrain) et apps/api (visits).
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sabou_mobile/dossier/photo.dart';
import 'package:sabou_mobile/dossier/session.dart';
import 'package:sabou_mobile/field/field_api.dart';
import 'package:sabou_mobile/field/field_visits_pages.dart';
import 'package:sabou_mobile/ui/theme.dart';

import '../dossier/fakes.dart';
import '../studio/studio_offline_pages_test.dart' show MemorySealedFiles;

const _agenda = [
  {
    'categorie': 'planifiee',
    'dossier': 'DS-1041',
    'visite': 2,
    'praticien': 'Sekou Kourouma',
    'sousPrefecture': 'Garambé',
    'prefecture': 'Labé',
    'prevueLe': '2026-11-23T09:30',
    'entreeLe': '2026-11-14',
  },
  {
    'categorie': 'planifiee',
    'dossier': 'DS-1050',
    'visite': 7,
    'praticien': 'Aïssatou Bah',
    'sousPrefecture': null,
    'prefecture': 'Labé',
    'prevueLe': '2026-11-24T08:00',
    'entreeLe': '2026-11-15',
  },
  {
    'categorie': 'a_planifier',
    'dossier': 'DS-1060',
    'visite': null,
    'praticien': 'Fanta Camara',
    'sousPrefecture': 'Dara-Labé',
    'prefecture': 'Labé',
    'prevueLe': null,
    'entreeLe': '2026-11-16',
  },
];

/// API simulée de l'agent : agenda, planification, compte rendu, photo de la fiche.
class VisitsServer {
  final requests = <http.Request>[];
  bool offline = false;

  /// Le serveur enregistre le compte rendu, puis la réponse se perd (coupure).
  bool dropReportResponse = false;
  final reports = <Map<String, Object?>>[];
  final photos = <int>[];

  late final client = MockClient((request) async {
    if (offline) throw http.ClientException('Réseau injoignable');
    requests.add(request);
    final path = request.url.path;
    switch ((request.method, path)) {
      case ('GET', '/api/terrain/visites'):
        return _json(200, _agenda);
      case ('POST', '/api/dossiers/DS-1060/visite'):
        return _json(200, {'id': 9, 'statut': 'planifiee'});
      case ('POST', '/api/dossiers/DS-1041/visite/compte-rendu'):
        if (reports.isNotEmpty) {
          return _json(409, {
            'error': 'stale',
            'message': 'Ce dossier ou sa visite a changé entre-temps.',
          });
        }
        reports.add(jsonDecode(request.body) as Map<String, Object?>);
        if (dropReportResponse) throw http.ClientException('Coupure');
        return _json(200, {'id': 2, 'statut': 'realisee'});
      case ('POST', '/api/dossiers/DS-1041/visite/2/photo'):
        photos.add(request.bodyBytes.length);
        return _json(200, {'id': 2, 'statut': 'realisee', 'photo': true});
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
      Uint8List.fromList([0xff, 0xd8, 9, 9, 9, 9]);
}

final _now = DateTime.utc(2026, 11, 23, 11, 15);

void main() {
  late VisitsServer server;
  late FieldApi api;

  setUp(() async {
    server = VisitsServer();
    final session = PractitionerSession(
      store: MemorySecretStore(),
      launcher: FakeLauncher(),
      client: server.client,
      issuer: issuer,
      fieldIssuer: issuer,
    );
    await session.signIn(realm: SignInRealm.fieldAgent);
    api = FieldApi(
      baseUrl: Uri.parse('http://api.test'),
      session: session,
      client: server.client,
      store: FieldStore(MemorySealedFiles()),
    );
  });

  FieldReport report({bool photo = true}) => FieldReport(
    dossier: 'DS-1041',
    visit: 2,
    practitioner: 'Sekou Kourouma',
    date: '2026-11-23',
    opinion: 'favorable',
    notes: 'Lieu conforme ; registre tenu.',
    attestedAt: DateTime.utc(2026, 11, 23, 10, 5),
    hasPhoto: photo,
  );

  Future<FieldReport> signed({bool photo = true}) async {
    final r = report(photo: photo);
    if (photo) {
      await api.store.saveReportPhoto(r, Uint8List.fromList([1, 2, 3, 4]));
    }
    await api.store.saveReport(r);
    return r;
  }

  group('Agenda et itinéraire', () {
    test(
      'agenda reçu avec le jeton de l’agent, gardé pour la tournée sans réseau',
      () async {
        final online = await api.agenda();
        expect(online!.fromCopy, isFalse);
        expect(online.value.map((i) => i.dossier), [
          'DS-1041',
          'DS-1050',
          'DS-1060',
        ]);
        server.offline = true;
        final copy = await api.agenda();
        expect(copy!.fromCopy, isTrue);
        expect(copy.value.first.when, '2026-11-23T09:30');
      },
    );

    test('itinéraire : la localité seule, jamais le nom du praticien', () {
      final item = AgendaItem.fromJson(_agenda.first);
      final uri = mapsUri(item.locality);
      expect(uri.scheme, 'geo');
      expect(
        uri.toString(),
        'geo:0,0?q=Garamb%C3%A9%2C%20Lab%C3%A9%2C%20Guin%C3%A9e',
      );
      expect(uri.toString(), isNot(contains('Kourouma')));
      expect(AgendaItem.fromJson(_agenda[1]).locality, 'Labé, Guinée');
    });

    test('jours de la tournée en toutes lettres', () {
      expect(dayLabel('2026-11-23T09:30'), 'Lundi 23/11/2026');
      expect(conakryToday(DateTime.utc(2026, 11, 23, 23, 59)), '2026-11-23');
    });

    test('planifier : date et heure transmises telles que choisies', () async {
      await api.plan('DS-1060', '2026-11-25T10:00');
      expect(server.requests.last.url.path, '/api/dossiers/DS-1060/visite');
      expect(jsonDecode(server.requests.last.body), {
        'prevueLe': '2026-11-25T10:00',
      });
    });
  });

  group('Compte rendu signé sans réseau', () {
    test(
      'envoi : texte, attestation et heure déclarée, puis photo de la fiche',
      () async {
        final r = await signed();
        expect(await api.sendPendingReports(), isEmpty);
        expect(server.reports.single, {
          'visite': 2,
          'realiseeLe': '2026-11-23',
          'avis': 'favorable',
          'constats': 'Lieu conforme ; registre tenu.',
          'attestation': true,
          'attesteLe': '2026-11-23T10:05:00.000Z',
        });
        expect(server.photos, [4]);
        expect(await api.store.reportPhoto(r), isNull);
      },
    );

    test(
      'sans réseau : le compte rendu reste sur le téléphone, sans erreur',
      () async {
        await signed();
        server.offline = true;
        final left = await api.sendPendingReports();
        expect(left.single.dossier, 'DS-1041');
        expect(left.single.error, isNull);
      },
    );

    test('réponse perdue après enregistrement : la reprise ne double rien et envoie la photo', () async {
      await signed();
      server.dropReportResponse = true;
      expect((await api.sendPendingReports()).single.tried, isTrue);
      server.dropReportResponse = false;
      expect(await api.sendPendingReports(), isEmpty);
      expect(server.reports, hasLength(1));
      expect(server.photos, [4]);
    });

    test('visite déjà enregistrée par un autre, sans essai de notre part : refus montré', () async {
      await signed();
      server.reports.add({'autre': true});
      final left = await api.sendPendingReports();
      expect(left.single.error, contains('changé entre-temps'));
      expect(server.photos, isEmpty);
    });
  });

  group('Écrans', () {
    late List<Uri> opened;

    setUp(() => opened = []);

    Future<void> pump(WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 5000);
      tester.view.devicePixelRatio = 2.5;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: sabouTheme(),
          home: Scaffold(
            body: FieldVisitsPage(
              api: api,
              picker: _Picker(),
              prepare: (b) async => b,
              openExternal: (url) async => opened.add(url),
              onSignedOut: () {},
              now: () => _now,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets(
      'tournée par jour, itinéraire vers la localité, dossiers à planifier',
      (tester) async {
        await pump(tester);
        expect(find.text('Lundi 23/11/2026'), findsOneWidget);
        expect(find.text('Mardi 24/11/2026'), findsOneWidget);
        expect(find.text('09:30 · Garambé'), findsOneWidget);
        expect(find.text('Dossiers à planifier'), findsOneWidget);
        await tester.tap(find.text('Itinéraire').first);
        await tester.pump();
        expect(opened.single.toString(), contains('Garamb%C3%A9'));
      },
    );

    testWidgets('compte rendu incomplet : erreurs, rien n’est gardé', (
      tester,
    ) async {
      await pump(tester);
      await tester.tap(find.byKey(const Key('compte-rendu-2')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('signer')));
      await tester.pumpAndSettle();
      expect(find.text('Choisissez un avis.'), findsOneWidget);
      expect(find.text('Décrivez ce que vous avez constaté.'), findsOneWidget);
      expect(
        find.text('Cochez l’attestation pour signer le compte rendu.'),
        findsOneWidget,
      );
      expect(await api.store.reports(), isEmpty);
    });

    testWidgets(
      'signé sans réseau, gardé sur le téléphone, envoyé au retour du réseau',
      (tester) async {
        await pump(tester);
        server.offline = true;
        await tester.tap(find.byKey(const Key('compte-rendu-2')));
        await tester.pumpAndSettle();
        expect(
          find.text('Visite du Lundi 23/11/2026 · Garambé'),
          findsOneWidget,
        );
        await tester.tap(find.byKey(const Key('avis-reserve')));
        await tester.enterText(
          find.byKey(const Key('constats')),
          'Plantes à l’abri.',
        );
        await tester.tap(find.byKey(const Key('photo-fiche')));
        await tester.pumpAndSettle();
        expect(find.text('Photo gardée sur le téléphone'), findsOneWidget);
        await tester.tap(find.byKey(const Key('attestation')));
        await tester.tap(find.byKey(const Key('signer')));
        await tester.pumpAndSettle();
        expect(
          find.textContaining('gardé sur le téléphone ; il part'),
          findsOneWidget,
        );
        expect(find.text('Comptes rendus à envoyer'), findsOneWidget);
        expect(find.byKey(const Key('visite-2')), findsNothing);
        final kept = (await api.store.reports()).single;
        expect(kept.opinion, 'reserve');
        expect(kept.attestedAt, _now);
        expect(kept.hasPhoto, isTrue);

        // Retour du réseau : l'ouverture de la rubrique envoie le compte rendu et la photo
        server.offline = false;
        await tester.fling(find.byType(ListView), const Offset(0, 600), 1000);
        await tester.pumpAndSettle();
        expect(server.reports.single['avis'], 'reserve');
        expect(server.photos, [6]);
        expect(await api.store.reports(), isEmpty);
      },
    );

    testWidgets('planifier sans réseau : message clair', (tester) async {
      await pump(tester);
      server.offline = true;
      await tester.tap(find.text('Planifier'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('la planification se fait en ligne'),
        findsOneWidget,
      );
    });

    testWidgets('écrans accessibles (WCAG 2.2 AA)', (tester) async {
      final handle = tester.ensureSemantics();
      await pump(tester);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      await tester.tap(find.byKey(const Key('compte-rendu-2')));
      await tester.pumpAndSettle();
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  });
}
