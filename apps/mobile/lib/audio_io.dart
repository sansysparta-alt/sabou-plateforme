// Enregistrement et lecture, derrière deux interfaces : l'écran se teste sans micro ni
// haut-parleur (test/studio_page_test.dart).
import 'dart:async';

import 'package:just_audio/just_audio.dart';
import 'package:record/record.dart';

import 'recording_format.dart';

abstract class VoiceRecorder {
  Future<bool> hasPermission();
  Future<void> start(String path, RecordingFormat format);

  /// Arrête et renvoie le chemin du fichier enregistré.
  Future<String?> stop();
  Future<void> dispose();
}

abstract class VoicePlayer {
  /// Lit [source] (fichier local ou adresse) et renvoie le délai entre l'appel et le
  /// début effectif du son.
  Future<Duration> play(Uri source);
  Future<void> stop();
  Future<void> dispose();
}

class DeviceVoiceRecorder implements VoiceRecorder {
  final AudioRecorder _recorder = AudioRecorder();

  @override
  Future<bool> hasPermission() => _recorder.hasPermission();

  @override
  Future<void> start(String path, RecordingFormat format) => _recorder.start(
    RecordConfig(
      encoder: format.codec == RecordingCodec.opus
          ? AudioEncoder.opus
          : AudioEncoder.aacLc,
      bitRate: format.bitRate,
      sampleRate: format.sampleRate,
      numChannels: 1,
      // Réduction du bruit du téléphone, en plus de celle du serveur
      noiseSuppress: true,
    ),
    path: path,
  );

  @override
  Future<String?> stop() => _recorder.stop();

  @override
  Future<void> dispose() => _recorder.dispose();
}

class DeviceVoicePlayer implements VoicePlayer {
  final AudioPlayer _player = AudioPlayer();

  @override
  Future<Duration> play(Uri source) async {
    await _player.stop();
    final stopwatch = Stopwatch()..start();
    final started = _player.playerStateStream
        .firstWhere(
          (s) => s.playing && s.processingState == ProcessingState.ready,
        )
        .timeout(const Duration(seconds: 30));
    if (source.isScheme('file')) {
      await _player.setFilePath(source.toFilePath());
    } else {
      // Lecture progressive : le son démarre avant la fin du téléchargement
      await _player.setUrl(source.toString());
    }
    unawaited(_player.play());
    await started;
    return stopwatch.elapsed;
  }

  @override
  Future<void> stop() => _player.stop();

  @override
  Future<void> dispose() => _player.dispose();
}
