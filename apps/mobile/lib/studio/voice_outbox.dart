// File d'envoi des voix (US-081, UC-74) : les enregistrements chiffrés du coffre partent au
// serveur dès que le réseau le permet, du plus ancien au plus récent. Une coupure arrête la
// tournée sans rien perdre ; la clé d'envoi rend un envoi rejoué sans doublon. Un refus
// définitif (traitement soumis entre-temps, consentement retiré…) est gardé avec sa raison,
// pour être dit au praticien, et n'est plus tenté.
import '../dossier/session.dart';
import 'studio_api.dart';
import 'voice_vault.dart';

/// Refus du serveur qui ne changeront pas en réessayant.
const _definitive = {
  'locked',
  'not_found',
  'invalid',
  'consent_required',
  'unsupported_file',
  'too_large',
  'no_profile',
};

class OutboxResult {
  const OutboxResult({
    required this.sent,
    required this.failed,
    required this.left,
  });

  /// Voix reçues par le serveur pendant cette tournée.
  final int sent;

  /// Voix refusées définitivement pendant cette tournée.
  final int failed;

  /// Voix encore en attente (réseau absent ou coupé pendant l'envoi).
  final int left;
}

class VoiceOutbox {
  VoiceOutbox({required this.vault, required this.api});

  final VoiceVault vault;
  final StudioApi api;
  bool _running = false;

  /// Une tournée d'envoi ; sans effet si une tournée est déjà en cours.
  /// Lève [SignedOutException] si la session n'est plus valable.
  Future<OutboxResult> flush() async {
    if (_running) return OutboxResult(sent: 0, failed: 0, left: await _left());
    _running = true;
    var sent = 0;
    var failed = 0;
    try {
      for (final voice in await vault.pending()) {
        // Traitement créé hors réseau, pas encore reçu par le serveur : la voix attend son code
        if (voice.error != null || isLocalCode(voice.code)) continue;
        try {
          await api.uploadVoice(
            code: voice.code,
            target: voice.target,
            object: voice.object,
            clientKey: voice.clientKey,
            audio: await vault.read(voice),
            contentType: voice.contentType,
          );
          await vault.remove(voice);
          sent++;
        } on SignedOutException {
          rethrow;
        } on StudioException catch (error) {
          // Serveur saturé ou passerelle en panne : la voix attend la tournée suivante
          if (!_definitive.contains(error.code)) break;
          await vault.markFailed(voice, error.message);
          failed++;
        } on Exception {
          break; // réseau absent ou coupé : la tournée reprendra au retour du réseau
        }
      }
    } finally {
      _running = false;
    }
    return OutboxResult(sent: sent, failed: failed, left: await _left());
  }

  Future<int> _left() async =>
      (await vault.pending()).where((p) => p.error == null).length;
}
