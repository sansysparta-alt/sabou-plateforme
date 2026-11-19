// Voix d'un champ du Studio mobile (US-081, UC-21) : sous chaque section et chaque plante, le
// praticien enregistre sa voix dans sa langue, la réécoute, recommence ou la retire. Une alerte
// de bruit propose de recommencer (UC-21 2a). L'enregistrement est chiffré dans le coffre du
// téléphone et part au serveur dès que le réseau le permet (voice_outbox.dart) : il est donc
// gardé même sans réseau.
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import '../audio_io.dart';
import '../recording_format.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'noise_meter.dart';
import 'studio_api.dart';
import 'voice_vault.dart';

/// Outils de la voix, remplaçables dans les tests (ni micro, ni haut-parleur, ni disque).
class VoiceTools {
  const VoiceTools({
    required this.recorder,
    required this.player,
    required this.format,
    required this.vault,
    required this.tempPath,
  });

  final VoiceRecorder recorder;
  final VoicePlayer player;
  final Future<RecordingFormat> Function() format;
  final VoiceVault vault;

  /// Fichier de travail de l'enregistreur, effacé dès que la voix est dans le coffre.
  final Future<String> Function(String extension) tempPath;
}

/// État affiché d'une voix.
String voiceStateLabel({PendingVoice? pending, PractitionerVoice? server}) {
  if (pending != null) {
    return pending.error != null
        ? 'Non envoyée : ${pending.error}'
        : 'Gardée sur le téléphone, envoi au retour du réseau.';
  }
  return switch (server?.state) {
    null => 'Aucune voix enregistrée.',
    'echec' =>
      'Le serveur n’a pas pu lire cette voix : enregistrez-la de nouveau.',
    'traitee' => 'Voix reçue (${server!.durationSec?.round() ?? 0} s).',
    _ => 'Voix reçue, en cours de traitement.',
  };
}

class VoiceField extends StatefulWidget {
  const VoiceField({
    super.key,
    required this.id,
    required this.label,
    required this.tools,
    required this.enabledReason,
    required this.pending,
    required this.server,
    required this.onRecorded,
    required this.onRemove,
    required this.loadServerAudio,
  });

  /// Identifiant des clés de test (`studio-voix-<id>-…`).
  final String id;

  /// Champ dit, pour les lecteurs d'écran (« Préparation », « Nom de la plante Kinkéliba »).
  final String label;
  final VoiceTools tools;

  /// Raison pour laquelle l'enregistrement est impossible ; null s'il est possible.
  final String? enabledReason;
  final PendingVoice? pending;
  final PractitionerVoice? server;

  /// Range la voix enregistrée (coffre puis envoi).
  final Future<void> Function(List<int> audio, String contentType) onRecorded;
  final Future<void> Function() onRemove;
  final Future<List<int>> Function() loadServerAudio;

  @override
  State<VoiceField> createState() => _VoiceFieldState();
}

enum _Phase { idle, recording, review, busy }

class _VoiceFieldState extends State<VoiceField> {
  var _phase = _Phase.idle;
  final _meter = NoiseMeter();
  StreamSubscription<double>? _levels;
  Timer? _clock;
  int _seconds = 0;
  String? _path;
  RecordingFormat? _format;

  /// Prise en attente de décision (bruit trop fort) : garder ou recommencer.
  List<int>? _take;
  String? _warning;
  String? _error;

  @override
  void dispose() {
    _levels?.cancel();
    _clock?.cancel();
    super.dispose();
  }

  Future<void> _start() async {
    setState(() {
      _error = null;
      _warning = null;
      _take = null;
    });
    final tools = widget.tools;
    if (!await tools.recorder.hasPermission()) {
      setState(
        () => _error = 'Autorisez le micro pour enregistrer votre voix (réglages du téléphone).',
      );
      return;
    }
    _format = await tools.format();
    _path = await tools.tempPath(_format!.extension);
    _meter.reset();
    _levels = tools.recorder.levels().listen(_meter.add);
    await tools.recorder.start(_path!, _format!);
    _seconds = 0;
    _clock = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _seconds++);
    });
    setState(() => _phase = _Phase.recording);
  }

  Future<void> _stop() async {
    _clock?.cancel();
    await _levels?.cancel();
    _levels = null;
    final path = await widget.tools.recorder.stop() ?? _path;
    if (path == null) return setState(() => _phase = _Phase.idle);
    final file = File(path);
    final audio = await file.readAsBytes();
    // Le fichier en clair ne reste pas sur le téléphone
    if (await file.exists()) await file.delete();
    final message = noiseMessage(_meter.verdict());
    if (message != null && _meter.verdict() != NoiseVerdict.tooShort) {
      setState(() {
        _take = audio;
        _warning = message;
        _phase = _Phase.review;
      });
      return;
    }
    if (message != null) {
      setState(() {
        _warning = message;
        _phase = _Phase.idle;
      });
      return;
    }
    await _keep(audio);
  }

  Future<void> _keep(List<int> audio) async {
    setState(() {
      _phase = _Phase.busy;
      _take = null;
      _warning = null;
    });
    try {
      await widget.onRecorded(audio, _format!.contentType);
    } on Exception {
      _error = 'La voix n’a pas pu être gardée. Réessayez.';
    }
    if (mounted) setState(() => _phase = _Phase.idle);
  }

  Future<void> _listen() async {
    setState(() => _error = null);
    try {
      final pending = widget.pending;
      if (pending != null) {
        await widget.tools.player.playBytes(
          await widget.tools.vault.read(pending),
          pending.contentType,
        );
      } else {
        await widget.tools.player.playBytes(
          await widget.loadServerAudio(),
          'audio/mp4',
        );
      }
    } on Exception {
      if (mounted) {
        setState(
          () => _error = 'La voix n’a pas pu être lue. Sans réseau, seule la voix pas encore envoyée se réécoute.',
        );
      }
    }
  }

  Future<void> _remove() async {
    setState(() => _phase = _Phase.busy);
    try {
      await widget.onRemove();
    } on Exception {
      _error = 'La voix n’a pas pu être retirée. Vérifiez le réseau, puis réessayez.';
    }
    if (mounted) setState(() => _phase = _Phase.idle);
  }

  @override
  Widget build(BuildContext context) {
    final reason = widget.enabledReason;
    final hasVoice =
        widget.pending != null ||
        (widget.server != null && widget.server!.state != 'echec');
    final canListen =
        widget.pending != null || widget.server?.state == 'traitee';
    final idle = _phase == _Phase.idle;
    final key = 'studio-voix-${widget.id}';
    return Semantics(
      container: true,
      label: 'Voix : ${widget.label}',
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: SabouSpace.s2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              reason ??
                  voiceStateLabel(
                    pending: widget.pending,
                    server: widget.server,
                  ),
              key: Key('$key-etat'),
            ),
            if (_warning != null)
              StatusMessage(_warning!, kind: StatusKind.warning),
            if (_error != null) StatusMessage(_error!, kind: StatusKind.error),
            const SizedBox(height: SabouSpace.s2),
            Wrap(
              spacing: SabouSpace.s2,
              runSpacing: SabouSpace.s2,
              children: [
                if (_phase == _Phase.recording)
                  FilledButton.icon(
                    key: Key('$key-arreter'),
                    onPressed: _stop,
                    icon: const Icon(Icons.stop),
                    label: Text('Arrêter (${_seconds}s)'),
                  )
                else if (_phase == _Phase.review) ...[
                  FilledButton.icon(
                    key: Key('$key-recommencer'),
                    onPressed: _start,
                    icon: const Icon(Icons.mic),
                    label: const Text('Recommencer'),
                  ),
                  OutlinedButton(
                    key: Key('$key-garder'),
                    onPressed: () => _keep(_take!),
                    child: const Text('Garder quand même'),
                  ),
                ] else
                  FilledButton.tonalIcon(
                    key: Key('$key-enregistrer'),
                    onPressed: reason == null && idle ? _start : null,
                    icon: const Icon(Icons.mic),
                    label: Text(
                      hasVoice
                          ? 'Enregistrer de nouveau'
                          : 'Enregistrer ma voix',
                    ),
                  ),
                if (canListen && idle)
                  OutlinedButton.icon(
                    key: Key('$key-ecouter'),
                    onPressed: _listen,
                    icon: const Icon(Icons.play_arrow),
                    label: const Text('Réécouter'),
                  ),
                if (hasVoice && idle && reason == null)
                  TextButton(
                    key: Key('$key-retirer'),
                    onPressed: _remove,
                    child: const Text('Retirer'),
                  ),
              ],
            ),
            if (_phase == _Phase.recording)
              const Padding(
                padding: EdgeInsets.only(top: SabouSpace.s2),
                child: Text(
                  'Parlez calmement, environ une minute et demie au plus.',
                ),
              ),
          ],
        ),
      ),
    );
  }
}
