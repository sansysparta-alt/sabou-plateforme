// US-081, critère 1 : un enregistrement par champ, réécoute, ré-enregistrement, alerte de
// bruit ; critère 2 : la voix est gardée sur le téléphone (coffre chiffré) sans réseau.
// Micro et haut-parleur simulés ; le coffre est le vrai, dans un dossier temporaire.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/audio_io.dart';
import 'package:sabou_mobile/recording_format.dart';
import 'package:sabou_mobile/studio/studio_api.dart';
import 'package:sabou_mobile/studio/voice_field.dart';
import 'package:sabou_mobile/studio/voice_vault.dart';
import 'package:sabou_mobile/ui/theme.dart';

import '../dossier/fakes.dart';

final voice = utf8.encode('ftypM4A voix de la préparation');

class FakeRecorder extends VoiceRecorder {
  List<double> levelsToSend = List.generate(
    40,
    (i) => i % 3 == 0 ? -55.0 : -15.0,
  );
  String? path;

  @override
  Future<bool> hasPermission() async => true;

  @override
  Future<void> start(String path, RecordingFormat format) async {
    this.path = path;
    await File(path).writeAsBytes(voice);
  }

  @override
  Stream<double> levels() => Stream.fromIterable(levelsToSend);

  @override
  Future<String?> stop() async => path;

  @override
  Future<void> dispose() async {}
}

class FakePlayer extends VoicePlayer {
  final played = <List<int>>[];

  @override
  Future<Duration> play(Uri source) async => Duration.zero;

  @override
  Future<void> playBytes(List<int> bytes, String contentType) async =>
      played.add(bytes);

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() async {}
}

void main() {
  late Directory dir;
  late VoiceVault vault;
  late FakeRecorder recorder;
  late FakePlayer player;
  late List<(List<int>, String)> recorded;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('sabou-champ-');
    vault = VoiceVault(directory: dir, secrets: MemorySecretStore());
    recorder = FakeRecorder();
    player = FakePlayer();
    recorded = [];
  });

  tearDown(() => dir.delete(recursive: true));

  VoiceTools tools() => VoiceTools(
    recorder: recorder,
    player: player,
    format: () async => aacFormat,
    vault: vault,
    tempPath: (ext) async => '${dir.path}/prise.$ext',
  );

  Future<void> pump(
    WidgetTester tester, {
    String? reason,
    PendingVoice? pending,
    PractitionerVoice? server,
  }) => tester.pumpWidget(
    MaterialApp(
      theme: sabouTheme(),
      home: Scaffold(
        body: VoiceField(
          id: 'section-preparation',
          label: 'Préparation',
          tools: tools(),
          enabledReason: reason,
          pending: pending,
          server: server,
          onRecorded: (audio, type) async => recorded.add((audio, type)),
          onRemove: () async {},
          loadServerAudio: () async => voice,
        ),
      ),
    ),
  );

  // Les accès au disque (prise, coffre) se font hors de l'horloge simulée
  Future<void> tapReal(WidgetTester tester, String key) async {
    await tester.runAsync(() async {
      await tester.tap(find.byKey(Key('studio-voix-section-preparation-$key')));
      await Future<void>.delayed(const Duration(milliseconds: 200));
    });
    await tester.pump();
  }

  testWidgets(
    'sans brouillon enregistré ni consentement : la raison est dite, bouton inactif',
    (tester) async {
      await pump(
        tester,
        reason: 'Enregistrez d’abord le brouillon pour ajouter votre voix.',
      );
      expect(
        find.text('Enregistrez d’abord le brouillon pour ajouter votre voix.'),
        findsOneWidget,
      );
      final button = tester.widget<ButtonStyleButton>(
        find.byKey(const Key('studio-voix-section-preparation-enregistrer')),
      );
      expect(button.onPressed, isNull);
    },
  );

  testWidgets(
    'enregistrer puis arrêter : la voix est remise, le fichier en clair effacé',
    (tester) async {
      await pump(tester);
      await tapReal(tester, 'enregistrer');
      expect(
        find.byKey(const Key('studio-voix-section-preparation-arreter')),
        findsOneWidget,
      );
      await tapReal(tester, 'arreter');
      expect(recorded.single.$1, voice);
      expect(recorded.single.$2, 'audio/mp4');
      expect(File('${dir.path}/prise.m4a').existsSync(), isFalse);
    },
  );

  testWidgets(
    'bruit trop fort : alerte, puis recommencer ou garder quand même',
    (tester) async {
      recorder.levelsToSend = List.generate(
        40,
        (i) => i % 3 == 0 ? -25.0 : -12.0,
      );
      await pump(tester);
      await tapReal(tester, 'enregistrer');
      await tapReal(tester, 'arreter');
      expect(find.textContaining('beaucoup de bruit'), findsOneWidget);
      expect(recorded, isEmpty);
      expect(
        find.byKey(const Key('studio-voix-section-preparation-recommencer')),
        findsOneWidget,
      );
      await tapReal(tester, 'garder');
      expect(recorded.single.$1, voice);
    },
  );

  testWidgets(
    'voix gardée sur le téléphone : état dit, réécoute de la voix déchiffrée',
    (tester) async {
      final pending = (await tester.runAsync(
        () => vault.put(
          code: 'REC-0001',
          target: 'section',
          object: 'preparation',
          contentType: 'audio/mp4',
          audio: voice,
        ),
      ))!;
      await pump(tester, pending: pending);
      expect(
        find.text('Gardée sur le téléphone, envoi au retour du réseau.'),
        findsOneWidget,
      );
      expect(find.text('Enregistrer de nouveau'), findsOneWidget);
      await tapReal(tester, 'ecouter');
      expect(player.played.single, voice);
    },
  );

  testWidgets('voix reçue puis en échec côté serveur : états dits', (
    tester,
  ) async {
    await pump(
      tester,
      server: const PractitionerVoice(
        target: 'section',
        object: 'preparation',
        state: 'traitee',
        durationSec: 61.5,
      ),
    );
    expect(find.text('Voix reçue (62 s).'), findsOneWidget);
    await pump(
      tester,
      server: const PractitionerVoice(
        target: 'section',
        object: 'preparation',
        state: 'echec',
        durationSec: null,
      ),
    );
    expect(find.textContaining('enregistrez-la de nouveau'), findsOneWidget);
  });
}
