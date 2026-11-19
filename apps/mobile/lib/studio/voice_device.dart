// Outils de la voix sur le téléphone (US-081) : micro, haut-parleur, format selon la version
// d'Android (US-005), coffre chiffré dans l'espace privé de l'application. Copie chiffrée du
// Studio pour l'usage hors réseau (US-080).
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import '../audio_io.dart';
import '../recording_format.dart';
import '../sync/database_key.dart';
import 'sealed_files.dart';
import 'studio_offline.dart';
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

/// US-080 : copie chiffrée du dossier (consultation sans réseau).
Future<SealedFiles> deviceDossierCopy() async {
  final support = await getApplicationSupportDirectory();
  return SealedFiles(
    directory: Directory('${support.path}/dossier'),
    secrets: DeviceSecretStore(),
    keyName: 'sabou.dossier_copy_key',
  );
}

/// US-082 : données de l'agent préfectoral (brouillons de dossiers, listes), chiffrées.
Future<SealedFiles> deviceFieldFiles() async {
  final support = await getApplicationSupportDirectory();
  return SealedFiles(
    directory: Directory('${support.path}/terrain'),
    secrets: DeviceSecretStore(),
    keyName: 'sabou.terrain_key',
  );
}

/// US-082 : copie du Studio et coffre de voix propres au praticien [code], numérisé par
/// l'agent : une voix ou un envoi en attente ne part jamais au nom d'un autre praticien.
Future<({StudioStore store, VoiceTools tools})> deviceFieldStudio(
  String code,
  VoiceTools base,
) async {
  final support = await getApplicationSupportDirectory();
  final folder = '${support.path}/terrain/praticiens/$code';
  return (
    store: StudioStore(
      SealedFiles(
        directory: Directory('$folder/studio'),
        secrets: DeviceSecretStore(),
        keyName: 'sabou.terrain_key',
      ),
    ),
    tools: VoiceTools(
      recorder: base.recorder,
      player: base.player,
      format: base.format,
      vault: VoiceVault(
        directory: Directory('$folder/voix'),
        secrets: DeviceSecretStore(),
      ),
      tempPath: base.tempPath,
    ),
  );
}

/// US-080 : copie chiffrée du Studio, dans l'espace privé de l'application.
Future<StudioStore> deviceStudioStore() async {
  final support = await getApplicationSupportDirectory();
  return StudioStore(
    SealedFiles(
      directory: Directory('${support.path}/studio'),
      secrets: DeviceSecretStore(),
      keyName: 'sabou.studio_store_key',
    ),
  );
}
