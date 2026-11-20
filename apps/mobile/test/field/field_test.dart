// US-082 (côté application), décisions du maître d'œuvre du 19 novembre 2026 (§2.86) :
// critère 1 : numérisation au nom du praticien choisi, par les routes du Studio sous
//             /api/terrain/praticiens/PR-… ; voix proposée seulement après l'accord du praticien ;
// critère 2 : dossier (identité, spécialité, localité, pièces, photo) constitué sans réseau,
//             chiffré sur le téléphone, envoyé au retour du réseau sans doublon.
// Les règles réelles (préfecture, second facteur, auteur ≠ vérificateur) sont prouvées par
// apps/api (field-agent-guard, studio) et packages/db (numerisation-terrain).
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sabou_mobile/dossier/photo.dart';
import 'package:sabou_mobile/dossier/session.dart';
import 'package:sabou_mobile/field/field_api.dart';
import 'package:sabou_mobile/field/field_pages.dart';
import 'package:sabou_mobile/recording_format.dart';
import 'package:sabou_mobile/studio/sealed_files.dart';
import 'package:sabou_mobile/studio/studio_api.dart';
import 'package:sabou_mobile/studio/studio_pages.dart';
import 'package:sabou_mobile/studio/voice_field.dart';
import 'package:sabou_mobile/studio/voice_vault.dart';
import 'package:sabou_mobile/ui/theme.dart';

import '../dossier/fakes.dart';
import '../studio/studio_offline_pages_test.dart' show MemorySealedFiles;
import '../studio/voice_field_test.dart' show FakePlayer, FakeRecorder;

const _practitioners = [
  {
    'code': 'PR-1042',
    'nom': 'Mamadou Diallo',
    'langue': 'pul',
    'statut': 'certifie',
  },
  {
    'code': 'PR-1050',
    'nom': 'Aïssatou Bah',
    'langue': 'pul',
    'statut': 'en_attente',
  },
];

const _referentials = {
  'prefecture': 'Labé',
  'specialites': [
    {'id': 1, 'libelle': 'Herboristerie'},
  ],
  'sousPrefectures': [
    {'id': 40, 'nom': 'Garambé'},
  ],
  'langues': [
    {'code': 'pul', 'nom': 'Pular'},
  ],
};

/// API de l'agent simulée ; [offline] coupe le réseau, [failPieces] coupe pendant les pièces.
class FieldServer {
  final requests = <http.Request>[];
  bool offline = false;
  bool failPieces = false;
  int status = 200;
  final pieces = <String>[];
  int created = 0;
  bool submitted = false;

  late final client = MockClient((request) async {
    if (offline) throw http.ClientException('Réseau injoignable');
    requests.add(request);
    if (status != 200) return _json(status, {'error': 'forbidden'});
    final path = request.url.path;
    switch ((request.method, path)) {
      case ('GET', '/api/terrain/praticiens'):
        return _json(200, _practitioners);
      case ('GET', '/api/dossiers-terrain/referentiels'):
        return _json(200, _referentials);
      case ('POST', '/api/dossiers-terrain'):
        created++;
        return _json(201, {'code': 'DS-3001'});
      case ('POST', '/api/dossiers-terrain/DS-3001/soumission'):
        submitted = true;
        return _json(200, {
          'code': 'DS-3001',
          'etape': 2,
          'soumisLe': '2026-11-20T08:00:00.000Z',
        });
      case ('GET', '/api/terrain/praticiens/PR-1042/traitements'):
        return _json(200, [
          {
            'code': 'REC-0001',
            'titreFr': 'Tisane du terrain',
            'maladie': {'code': 'MAL-0001', 'nomFr': 'Paludisme'},
            'statut': 'brouillon',
            'attenteRaison': null,
            'modifieLe': '2026-11-20T08:00:00.000Z',
            'saisieTerrain': true,
          },
        ]);
    }
    if (request.method == 'POST' &&
        path.startsWith('/api/dossiers-terrain/DS-3001/pieces/')) {
      if (failPieces) throw http.ClientException('Réseau coupé');
      pieces.add(path.split('/').last);
      return _json(201, {'id': pieces.length});
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
      Uint8List.fromList([0xff, 0xd8, 1, 2, 3]);
}

void main() {
  late Directory dir;
  late FieldServer server;
  late PractitionerSession session;
  late FieldApi api;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('sabou-terrain-');
    server = FieldServer();
    final launcher = FakeLauncher();
    session = PractitionerSession(
      store: MemorySecretStore(),
      launcher: launcher,
      client: server.client,
      issuer: issuer,
      fieldIssuer: issuer,
    );
    await session.signIn(realm: SignInRealm.fieldAgent);
    api = FieldApi(
      baseUrl: Uri.parse('http://api.test'),
      session: session,
      client: server.client,
      store: FieldStore(
        SealedFiles(
          directory: dir,
          secrets: MemorySecretStore(),
          keyName: 'sabou.terrain_key',
        ),
      ),
    );
  });

  tearDown(() => dir.delete(recursive: true));

  FieldDraft draft({bool withPieces = true}) => FieldDraft(
    id: 'local-1',
    fields: {
      'telephone': '621000111',
      'prenom': 'Fanta',
      'nom': 'Camara',
      'specialiteId': 1,
      'sousPrefectureId': 40,
      'languePrincipale': 'pul',
      'anneesExperience': 12,
    },
    pieces: withPieces ? {'identite', 'photo'} : {},
  );

  Future<FieldDraft> stored() async {
    final d = draft();
    for (final type in d.pieces) {
      await api.store.savePiece(
        d,
        type,
        Uint8List.fromList([1, 2, type.length]),
      );
    }
    await api.store.saveDraft(d);
    return d;
  }

  group('Critère 1 : praticiens de la préfecture, numérisation à leur nom', () {
    test(
      'liste reçue avec le jeton de l’agent, gardée pour l’usage sans réseau',
      () async {
        final online = await api.practitioners();
        expect(online!.fromCopy, isFalse);
        expect(online.value.map((p) => p.code), ['PR-1042', 'PR-1050']);
        expect(
          server.requests.first.headers['authorization'],
          'Bearer ${fakeAccess('acces-1')}',
        );
        server.offline = true;
        final copy = await api.practitioners();
        expect(copy!.fromCopy, isTrue);
        expect(copy.value.first.name, 'Mamadou Diallo');
      },
    );

    test('jamais reçue et sans réseau : rien à montrer, sans erreur', () async {
      server.offline = true;
      expect(await api.practitioners(), isNull);
      expect(await api.referentials(), isNull);
    });

    test(
      'Studio du praticien : mêmes routes sous /api/terrain/praticiens/PR-…',
      () async {
        final studio = StudioApi.forPractitioner(
          baseUrl: Uri.parse('http://api.test'),
          session: session,
          practitionerCode: 'PR-1042',
          client: server.client,
        );
        final list = await studio.list();
        expect(
          server.requests.last.url.path,
          '/api/terrain/praticiens/PR-1042/traitements',
        );
        expect(list.single.fieldEntry, isTrue);
      },
    );

    test(
      'compte sans le profil ni le second facteur : refus définitif de l’API',
      () async {
        server.status = 403;
        await expectLater(
          api.practitioners(),
          throwsA(
            isA<FieldException>().having(
              (e) => e.definitive,
              'définitif',
              isTrue,
            ),
          ),
        );
      },
    );
  });

  group('Critère 2 : dossier constitué sans réseau, envoyé sans doublon', () {
    test('brouillon et photos chiffrés sur le téléphone', () async {
      final d = await stored();
      final names = dir.listSync().map((f) => f.uri.pathSegments.last).toList();
      expect(
        names,
        containsAll(['brouillons.json', 'piece-local-1-identite.bin']),
      );
      final raw = File('${dir.path}/brouillons.json')
          .readAsStringSync(encoding: latin1);
      expect(raw, isNot(contains('Camara')));
      expect(raw, isNot(contains('621000111')));
      expect((await api.store.drafts()).single.displayName, d.displayName);
    });

    test(
      'envoi complet : création, pièces, soumission, puis brouillon effacé',
      () async {
        final d = await stored();
        expect(await api.send(d), 'DS-3001');
        expect(server.created, 1);
        expect(server.pieces, ['identite', 'photo']);
        expect(server.submitted, isTrue);
        final body = jsonDecode(
          server.requests.firstWhere((r) => r.method == 'POST').body,
        );
        expect(body, d.fields);
        expect(await api.store.drafts(), isEmpty);
        expect(dir.listSync().where((f) => f.path.endsWith('.bin')), isEmpty);
      },
    );

    test(
      'envoi coupé pendant les pièces : la reprise ne recrée pas le dossier',
      () async {
        final d = await stored();
        server.failPieces = true;
        await expectLater(api.send(d), throwsA(isA<http.ClientException>()));
        final kept = (await api.store.drafts()).single;
        expect(kept.code, 'DS-3001');
        server.failPieces = false;
        expect(await api.send(kept), 'DS-3001');
        expect(server.created, 1);
        expect(server.pieces, ['identite', 'photo']);
      },
    );

    test('pièce d’identité ou photo manquante : rien n’est envoyé', () async {
      await expectLater(
        api.send(draft(withPieces: false)),
        throwsA(
          isA<FieldException>().having((e) => e.code, 'code', 'missing_pieces'),
        ),
      );
      expect(server.requests, isEmpty);
    });
  });

  // Écrans : copie en mémoire (le chiffrement réel est prouvé ci-dessus et par
  // sealed_files) ; la voix n'est jamais touchée ici, seul son passage au Studio est vérifié.
  group('Écrans de l’agent', () {
    late VoiceTools tools;
    late FieldApi uiApi;

    setUp(() {
      tools = VoiceTools(
        recorder: FakeRecorder(),
        player: FakePlayer(),
        format: () async => aacFormat,
        vault: VoiceVault(directory: dir, secrets: MemorySecretStore()),
        tempPath: (ext) async => '${dir.path}/prise.$ext',
      );
      uiApi = FieldApi(
        baseUrl: Uri.parse('http://api.test'),
        session: session,
        client: server.client,
        store: FieldStore(MemorySealedFiles()),
      );
    });

    Future<void> pump(WidgetTester tester, Widget page) async {
      // Écran haut : le formulaire entier est construit (la liste ne bâtit que le visible)
      tester.view.physicalSize = const Size(1080, 6000);
      tester.view.devicePixelRatio = 2.5;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: sabouTheme(),
          home: Scaffold(body: page),
        ),
      );
      await tester.pumpAndSettle();
    }

    Future<List<String>> openStudio(
      WidgetTester tester, {
      required bool agree,
    }) async {
      final opened = <String>[];
      await uiApi.practitioners();
      server.offline =
          true; // liste tirée de la copie : rubrique utilisable sans réseau
      await pump(
        tester,
        FieldPractitionersPage(
          api: uiApi,
          onSignedOut: () {},
          studioFor: (code) async {
            opened.add(code);
            return FieldStudioTools(
              api: StudioApi.forPractitioner(
                baseUrl: Uri.parse('http://api.test'),
                session: session,
                practitionerCode: code,
                client: server.client,
              ),
              voiceTools: tools,
            );
          },
        ),
      );
      expect(find.textContaining('Sans réseau'), findsOneWidget);
      await tester.tap(find.byKey(const Key('praticien-PR-1042')));
      await tester.pumpAndSettle();
      if (agree) await tester.tap(find.byKey(const Key('accord-praticien')));
      await tester.pumpAndSettle();
      server.offline = false;
      await tester.tap(find.byKey(const Key('ouvrir-studio')));
      await tester.pump();
      await tester.pump();
      return opened;
    }

    testWidgets(
      'accord du praticien coché : Studio du praticien, voix proposée',
      (tester) async {
        final opened = await openStudio(tester, agree: true);
        expect(opened, ['PR-1042']);
        final page = tester.widget<TreatmentsPage>(find.byType(TreatmentsPage));
        expect(page.voiceTools, same(tools));
        expect(
          find.descendant(
            of: find.byType(AppBar),
            matching: find.text('Mamadou Diallo'),
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets('sans l’accord : Studio en texte seul, aucune voix', (
      tester,
    ) async {
      await openStudio(tester, agree: false);
      final page = tester.widget<TreatmentsPage>(find.byType(TreatmentsPage));
      expect(page.voiceTools, isNull);
    });

    testWidgets('fenêtre d’accord fermée : le Studio ne s’ouvre pas', (
      tester,
    ) async {
      final opened = <String>[];
      await pump(
        tester,
        FieldPractitionersPage(
          api: uiApi,
          onSignedOut: () {},
          studioFor: (code) async {
            opened.add(code);
            throw StateError('inattendu');
          },
        ),
      );
      await tester.tap(find.byKey(const Key('praticien-PR-1050')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Annuler'));
      await tester.pumpAndSettle();
      expect(opened, isEmpty);
      expect(find.byType(TreatmentsPage), findsNothing);
    });

    testWidgets(
      'dossier saisi sans réseau, gardé sur le téléphone, retrouvé dans la liste',
      (tester) async {
        await uiApi.referentials();
        server.offline = true;
        await pump(
          tester,
          FieldDossiersPage(
            api: uiApi,
            picker: _Picker(),
            prepare: (b) async => b,
            onSignedOut: () {},
            newId: () => 'local-9',
          ),
        );
        await tester.tap(find.byKey(const Key('nouveau-dossier')));
        await tester.pumpAndSettle();
        expect(find.text('Identité · préfecture de Labé'), findsOneWidget);
        await tester.enterText(
          find.byKey(const Key('terrain-prenom')),
          'Fanta',
        );
        await tester.enterText(find.byKey(const Key('terrain-nom')), 'Camara');
        await tester.enterText(
          find.byKey(const Key('terrain-telephone')),
          '+224 621 00 01 11',
        );
        await tester.enterText(find.byKey(const Key('terrain-annees')), '12');
        await tester.tap(find.byKey(const Key('terrain-specialite')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Herboristerie').last);
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('terrain-langue')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Pular').last);
        await tester.pumpAndSettle();
        final photo = find.byKey(const Key('photo-photo'));
        await tester.ensureVisible(photo);
        await tester.tap(photo);
        await tester.pumpAndSettle();
        expect(find.text('Photo du praticien ajoutée.'), findsOneWidget);
        final keep = find.byKey(const Key('garder-dossier'));
        await tester.ensureVisible(keep);
        await tester.tap(keep);
        await tester.pumpAndSettle();
        expect(find.text('Dossier gardé sur le téléphone.'), findsOneWidget);
        final kept = (await uiApi.store.drafts()).single;
        expect(kept.fields['telephone'], '621000111');
        expect(kept.fields['specialiteId'], 1);
        expect(kept.fields['languePrincipale'], 'pul');
        expect(kept.pieces, {'photo'});

        // Envoi sans réseau : le dossier reste sur le téléphone, l'écran le dit
        await tester.tap(find.byKey(const Key('envoyer-dossier')));
        await tester.pumpAndSettle();
        expect(
          find.textContaining('Ajoutez la pièce d’identité'),
          findsOneWidget,
        );
        await tester.pageBack();
        await tester.pumpAndSettle();
        expect(find.text('Fanta Camara'), findsOneWidget);
        expect(find.text('Pas encore envoyé'), findsOneWidget);
      },
    );

    testWidgets('dossier complet envoyé : code annoncé, retiré du téléphone', (
      tester,
    ) async {
      final d = draft();
      for (final type in d.pieces) {
        await uiApi.store.savePiece(d, type, Uint8List.fromList([1, 2, 3]));
      }
      await uiApi.store.saveDraft(d);
      await uiApi.referentials();
      await pump(
        tester,
        FieldDossiersPage(
          api: uiApi,
          picker: _Picker(),
          prepare: (b) async => b,
          onSignedOut: () {},
        ),
      );
      await tester.tap(find.text('Fanta Camara'));
      await tester.pumpAndSettle();
      final send = find.byKey(const Key('envoyer-dossier'));
      await tester.ensureVisible(send);
      await tester.tap(send);
      await tester.pumpAndSettle();
      expect(find.textContaining('Dossier DS-3001 envoyé'), findsOneWidget);
      expect(find.text('Aucun dossier en attente d’envoi.'), findsOneWidget);
      expect(server.submitted, isTrue);
    });

    testWidgets(
      'formulaire incomplet : erreurs sous les champs, rien n’est gardé',
      (tester) async {
        await uiApi.referentials();
        await pump(
          tester,
          FieldDossierFormPage(
            api: uiApi,
            picker: _Picker(),
            prepare: (b) async => b,
            onSignedOut: () {},
            draft: FieldDraft(id: 'local-2', fields: {}),
          ),
        );
        await tester.enterText(
          find.byKey(const Key('terrain-telephone')),
          '12345',
        );
        final keep = find.byKey(const Key('garder-dossier'));
        await tester.ensureVisible(keep);
        await tester.tap(keep);
        await tester.pumpAndSettle();
        expect(
          find.textContaining('Numéro mobile guinéen attendu'),
          findsOneWidget,
        );
        expect(find.text('Champ obligatoire.'), findsWidgets);
        expect(await uiApi.store.drafts(), isEmpty);
      },
    );

    testWidgets('écrans de l’agent accessibles (WCAG 2.2 AA)', (tester) async {
      final handle = tester.ensureSemantics();
      await uiApi.referentials();
      await pump(
        tester,
        FieldDossierFormPage(
          api: uiApi,
          picker: _Picker(),
          prepare: (b) async => b,
          onSignedOut: () {},
          draft: FieldDraft(id: 'local-3', fields: {}),
        ),
      );
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      await pump(
        tester,
        FieldPractitionersPage(
          api: uiApi,
          onSignedOut: () {},
          studioFor: (code) async => throw StateError('inattendu'),
        ),
      );
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  });
}
