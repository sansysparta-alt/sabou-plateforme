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

  /// Niveau du micro pendant l'enregistrement (dBFS, environ 10 relevés par seconde), pour
  /// l'alerte de bruit (US-081). Par défaut, aucun relevé.
  Stream<double> levels() => const Stream.empty();
}

abstract class VoicePlayer {
  /// Lit [source] (fichier local ou adresse) et renvoie le délai entre l'appel et le
  /// début effectif du son.
  Future<Duration> play(Uri source);
  Future<void> stop();
  Future<void> dispose();

  /// Lit une voix gardée en mémoire (voix déchiffrée du coffre, voix reçue du serveur) sans
  /// l'écrire en clair sur le disque (US-081).
  Future<void> playBytes(List<int> bytes, String contentType) =>
      throw UnsupportedError('Lecture en mémoire non prise en charge');
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
  Stream<double> levels() => _recorder
      .onAmplitudeChanged(const Duration(milliseconds: 100))
      .map((a) => a.current);

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
  Future<void> playBytes(List<int> bytes, String contentType) async {
    await _player.stop();
    await _player.setAudioSource(_MemorySource(bytes, contentType));
    unawaited(_player.play());
  }

  @override
  Future<void> stop() => _player.stop();

  @override
  Future<void> dispose() => _player.dispose();
}

/// Source de lecture en mémoire pour just_audio. StreamAudioSource est marquée
/// « expérimentale » par just_audio (0.10) ; c'est sa seule voie de lecture sans
/// fichier, à vérifier par l'essai sur le téléphone.
// ignore: experimental_member_use
class _MemorySource extends StreamAudioSource {
  _MemorySource(this._bytes, this._contentType);

  final List<int> _bytes;
  final String _contentType;

  @override
  // ignore: experimental_member_use
  Future<StreamAudioResponse> request([int? start, int? end]) async {
    final from = start ?? 0;
    final to = end ?? _bytes.length;
    // ignore: experimental_member_use
    return StreamAudioResponse(
      sourceLength: _bytes.length,
      contentLength: to - from,
      offset: from,
      stream: Stream.value(_bytes.sublist(from, to)),
      contentType: _contentType,
    );
  }
}
