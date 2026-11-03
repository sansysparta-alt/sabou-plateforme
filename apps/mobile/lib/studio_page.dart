// Studio (essai) de US-005 : enregistrer une voix, la réécouter, l'envoyer en 3G simulée,
// puis écouter les deux versions traitées par le serveur et mesurer leur démarrage.
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import 'audio_io.dart';
import 'essai_api.dart';
import 'recording_format.dart';

/// Au-delà, l'enregistrement s'arrête seul : la durée cible d'une voix est de 90 s (R-REC-14).
const Duration maxRecording = Duration(minutes: 3);

enum StudioStep { ready, recording, recorded, sending, processed }

class StudioPage extends StatefulWidget {
  const StudioPage({
    super.key,
    required this.recorder,
    required this.player,
    required this.api,
    required this.sdkInt,
    required this.tempDir,
  });

  final VoiceRecorder recorder;
  final VoicePlayer player;
  final EssaiApi api;
  final Future<int> Function() sdkInt;
  final Future<Directory> Function() tempDir;

  @override
  State<StudioPage> createState() => _StudioPageState();
}

String formatDuration(Duration d) =>
    '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';

String formatSeconds(Duration d) =>
    '${(d.inMilliseconds / 1000).toStringAsFixed(1).replaceAll('.', ',')} s';

String formatKo(int bytes) => '${(bytes / 1000).round()} Ko';

class _StudioPageState extends State<StudioPage> {
  StudioStep _step = StudioStep.ready;
  String? _message;
  String? _recordingPath;
  RecordingFormat? _format;
  Duration _elapsed = Duration.zero;
  Timer? _timer;
  UploadResult? _result;
  final Map<String, Duration> _startTimes = {};

  @override
  void dispose() {
    _timer?.cancel();
    unawaited(widget.recorder.dispose());
    unawaited(widget.player.dispose());
    super.dispose();
  }

  void _show(StudioStep step, [String? message]) => setState(() {
    _step = step;
    _message = message;
  });

  Future<void> _startRecording() async {
    if (!await widget.recorder.hasPermission()) {
      _show(
        StudioStep.ready,
        'Autorisez le micro dans les réglages du téléphone, puis réessayez.',
      );
      return;
    }
    try {
      _format = recordingFormatFor(await widget.sdkInt());
    } on UnsupportedError catch (e) {
      _show(StudioStep.ready, e.message);
      return;
    }
    final dir = await widget.tempDir();
    final path = '${dir.path}/voix-essai.${_format!.extension}';
    await widget.player.stop();
    await widget.recorder.start(path, _format!);
    _elapsed = Duration.zero;
    _startTimes.clear();
    _result = null;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      setState(() => _elapsed += const Duration(seconds: 1));
      if (_elapsed >= maxRecording) unawaited(_stopRecording());
    });
    _show(StudioStep.recording);
  }

  Future<void> _stopRecording() async {
    _timer?.cancel();
    _recordingPath = await widget.recorder.stop();
    _show(
      _recordingPath == null ? StudioStep.ready : StudioStep.recorded,
      _recordingPath == null ? 'L’enregistrement a échoué. Réessayez.' : null,
    );
  }

  Future<void> _listen(String key, Uri source) async {
    setState(() => _message = 'Lecture en cours…');
    try {
      final delay = await widget.player.play(source);
      setState(() {
        _startTimes[key] = delay;
        _message = null;
      });
    } on Exception {
      setState(() => _message = 'Lecture impossible.');
    }
  }

  Future<void> _send() async {
    _show(StudioStep.sending, 'Envoi en cours (réseau 3G simulé)…');
    try {
      final audio = await File(_recordingPath!).readAsBytes();
      _result = await widget.api.upload(audio, _format!.contentType);
      _show(StudioStep.processed);
    } on EssaiException catch (e) {
      _show(StudioStep.recorded, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Studio (essai)')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Enregistrez environ 90 secondes de voix, écoutez-la, puis envoyez-la : '
              'le serveur réduit le bruit et la compresse.',
              style: theme.textTheme.bodyLarge,
            ),
            const SizedBox(height: 16),
            if (_step == StudioStep.recording) ...[
              Semantics(
                liveRegion: true,
                label: 'Enregistrement en cours, ${formatDuration(_elapsed)}',
                child: ExcludeSemantics(
                  child: Text(
                    '● ${formatDuration(_elapsed)}',
                    style: theme.textTheme.displaySmall,
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _stopRecording,
                icon: const Icon(Icons.stop),
                label: const Text('Arrêter'),
              ),
            ] else
              FilledButton.icon(
                onPressed: _step == StudioStep.sending ? null : _startRecording,
                icon: const Icon(Icons.mic),
                label: Text(
                  _recordingPath == null
                      ? 'Enregistrer'
                      : 'Enregistrer à nouveau',
                ),
              ),
            if (_step == StudioStep.recorded ||
                _step == StudioStep.processed) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () => _listen('brut', Uri.file(_recordingPath!)),
                icon: const Icon(Icons.play_arrow),
                label: Text('Réécouter (${formatDuration(_elapsed)})'),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _step == StudioStep.processed ? null : _send,
                icon: const Icon(Icons.upload),
                label: const Text('Envoyer'),
              ),
            ],
            if (_step == StudioStep.sending) ...[
              const SizedBox(height: 16),
              const Center(
                child: CircularProgressIndicator(
                  semanticsLabel: 'Envoi en cours',
                ),
              ),
            ],
            if (_message != null) ...[
              const SizedBox(height: 16),
              Semantics(
                liveRegion: true,
                child: Text(_message!, style: theme.textTheme.bodyLarge),
              ),
            ],
            if (_step == StudioStep.processed && _result != null)
              ..._resultSection(theme),
          ],
        ),
      ),
    );
  }

  List<Widget> _resultSection(ThemeData theme) {
    final result = _result!;
    return [
      const SizedBox(height: 24),
      Text('Résultat', style: theme.textTheme.titleLarge),
      const SizedBox(height: 8),
      Text(
        'Envoyé : ${formatKo(result.sentBytes)} en ${formatSeconds(result.uploadTime)} '
        '(${result.receivedSeconds.toStringAsFixed(1).replaceAll('.', ',')} s de voix)',
        style: theme.textTheme.bodyLarge,
      ),
      for (final version in result.versions) ...[
        const SizedBox(height: 12),
        FilledButton.tonalIcon(
          onPressed: () => _listen(version.name, version.url),
          icon: const Icon(Icons.headphones),
          label: Text(
            'Écouter ${version.name == 'mi-force' ? 'mi-force (retenu)' : 'pleine force'} · '
            '${formatKo(version.bytes)}',
          ),
        ),
        if (_startTimes[version.name] case final delay?)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              'Démarrage de la lecture : ${formatSeconds(delay)}',
              style: theme.textTheme.bodyLarge,
            ),
          ),
      ],
    ];
  }
}
