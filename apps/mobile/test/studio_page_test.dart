// Écran Studio (essai) : parcours complet sans micro ni réseau, et règles d'accessibilité
// de Flutter (cibles tactiles, libellés, contraste du texte).
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sabou_mobile/audio_io.dart';
import 'package:sabou_mobile/essai_api.dart';
import 'package:sabou_mobile/main.dart';
import 'package:sabou_mobile/recording_format.dart';
import 'package:sabou_mobile/studio_page.dart';

class FakeRecorder implements VoiceRecorder {
  bool permission = true;
  String? path;
  RecordingFormat? format;

  @override
  Future<bool> hasPermission() async => permission;

  @override
  Future<void> start(String path, RecordingFormat format) async {
    this.path = path;
    this.format = format;
    File(path).writeAsBytesSync(List.filled(2000, 1));
  }

  @override
  Future<String?> stop() async => path;

  @override
  Future<void> dispose() async {}
}

class FakePlayer implements VoicePlayer {
  final List<Uri> played = [];

  @override
  Future<Duration> play(Uri source) async {
    played.add(source);
    return const Duration(milliseconds: 2140);
  }

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() async {}
}

void main() {
  late Directory temp;
  late FakeRecorder recorder;
  late FakePlayer player;
  http.Request? uploaded;

  setUp(() {
    temp = Directory.systemTemp.createTempSync('sabou-studio-');
    recorder = FakeRecorder();
    player = FakePlayer();
    uploaded = null;
  });

  tearDown(() => temp.deleteSync(recursive: true));

  Widget app({int sdk = 34}) => MaterialApp(
    theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: sabouGreen)),
    home: StudioPage(
      recorder: recorder,
      player: player,
      api: EssaiApi(
        baseUrl: Uri.parse('http://localhost:3300'),
        client: MockClient((request) async {
          uploaded = request;
          return http.Response(
            jsonEncode({
              'receivedSeconds': 90.0,
              'versions': [
                {
                  'name': 'mi-force',
                  'url': '/voix/a/mi-force.webm',
                  'bytes': 268000,
                },
                {
                  'name': 'pleine-force',
                  'url': '/voix/a/pleine-force.webm',
                  'bytes': 270000,
                },
              ],
            }),
            201,
          );
        }),
      ),
      sdkInt: () async => sdk,
      tempDir: () async => temp,
    ),
  );

  Future<void> recordAndSend(WidgetTester tester) async {
    await tester.tap(find.text('Enregistrer'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    expect(find.text('● 0:03'), findsOneWidget);
    await tester.tap(find.text('Arrêter'));
    await tester.pumpAndSettle();
    await tester.runAsync(() async {
      await tester.tap(find.text('Envoyer'));
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pumpAndSettle();
  }

  testWidgets(
    'enregistrer, envoyer, puis écouter la version traitée avec son démarrage',
    (tester) async {
      await tester.pumpWidget(app());
      await recordAndSend(tester);

      expect(recorder.format, opusFormat);
      expect(uploaded!.headers['Content-Type'], 'audio/ogg');
      expect(uploaded!.bodyBytes.length, 2000);
      expect(find.textContaining('Envoyé : 2 Ko'), findsOneWidget);

      await tester.tap(find.textContaining('Écouter mi-force (retenu)'));
      await tester.pumpAndSettle();
      expect(
        player.played.single.toString(),
        'http://localhost:3300/voix/a/mi-force.webm',
      );
      expect(find.text('Démarrage de la lecture : 2,1 s'), findsOneWidget);
      expect(find.textContaining('Écouter pleine force'), findsOneWidget);
    },
  );

  testWidgets('Android 9 : enregistrement en AAC, envoyé comme audio/mp4', (
    tester,
  ) async {
    await tester.pumpWidget(app(sdk: 28));
    await recordAndSend(tester);
    expect(recorder.format, aacFormat);
    expect(uploaded!.headers['Content-Type'], 'audio/mp4');
  });

  testWidgets('micro refusé : message clair, pas d’enregistrement', (
    tester,
  ) async {
    recorder.permission = false;
    await tester.pumpWidget(app());
    await tester.tap(find.text('Enregistrer'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Autorisez le micro'), findsOneWidget);
    expect(recorder.path, isNull);
  });

  testWidgets(
    'accessibilité : cibles tactiles, libellés et contraste à chaque étape',
    (tester) async {
      final semantics = tester.ensureSemantics();
      Future<void> checkGuidelines() async {
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      }

      await tester.pumpWidget(app());
      await checkGuidelines();
      await recordAndSend(tester);
      await tester.tap(find.textContaining('Écouter mi-force'));
      await tester.pumpAndSettle();
      await checkGuidelines();
      semantics.dispose();
    },
  );
}
