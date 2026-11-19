// Outils de la voix sur le téléphone (US-081) : micro, haut-parleur, format selon la version
// d'Android (US-005), coffre chiffré dans l'espace privé de l'application.
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import '../audio_io.dart';
import '../recording_format.dart';
import '../sync/database_key.dart';
import 'voice_field.dart';
import 'voice_vault.dart';

Future<VoiceTools> deviceVoiceTools() async {
  final support = await getApplicationSupportDirectory();
  final temp = await getTemporaryDirectory();
  return VoiceTools(
    recorder: DeviceVoiceRecorder(),
    player: DeviceVoicePlayer(),
    format: () async => recordingFormatFor(
      (await DeviceInfoPlugin().androidInfo).version.sdkInt,
    ),
    vault: VoiceVault(
      directory: Directory('${support.path}/voix'),
      secrets: DeviceSecretStore(),
    ),
    tempPath: (extension) async =>
        '${temp.path}/enregistrement-${DateTime.now().microsecondsSinceEpoch}.$extension',
  );
}
