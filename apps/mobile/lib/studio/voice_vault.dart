// Voix en attente d'envoi (US-081, décision du maître d'œuvre du 19 novembre 2026) : chaque
// enregistrement est chiffré (AES-256-GCM) avant d'être rangé dans l'espace privé de
// l'application ; la clé, tirée au hasard au premier usage, est gardée dans le magasin
// sécurisé du système (Keystore Android), comme celle de la base (US-004). Le fichier est
// effacé dès que le serveur l'a reçu. La liste des envois en attente ne contient ni voix ni
// donnée de santé : code du traitement, cible, clé d'envoi.
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:cryptography/cryptography.dart';

import '../sync/database_key.dart';

const _vaultKeyName = 'sabou.voice_vault_key';

/// Un enregistrement en attente d'envoi au serveur.
class PendingVoice {
  const PendingVoice({
    required this.clientKey,
    required this.code,
    required this.target,
    required this.object,
    required this.contentType,
    required this.recordedAt,
    this.error,
  });

  factory PendingVoice.fromJson(Map<String, dynamic> json) => PendingVoice(
    clientKey: json['cle'] as String,
    code: json['code'] as String,
    target: json['cible'] as String,
    object: json['objet'] as String,
    contentType: json['type'] as String,
    recordedAt: DateTime.parse(json['le'] as String),
    error: json['erreur'] as String?,
  );

  /// Clé d'envoi (UUID v4) tirée sur le téléphone : l'API ne crée pas de doublon si l'envoi
  /// est rejoué après une coupure.
  final String clientKey;
  final String code;

  /// « section » ou « plante ».
  final String target;

  /// Type de section (preparation…) ou code de plante (PL-…).
  final String object;
  final String contentType;
  final DateTime recordedAt;

  /// Refus définitif du serveur (traitement soumis entre-temps…) : l'envoi n'est plus tenté.
  final String? error;

  PendingVoice failed(String message) => PendingVoice(
    clientKey: clientKey,
    code: code,
    target: target,
    object: object,
    contentType: contentType,
    recordedAt: recordedAt,
    error: message,
  );

  Map<String, dynamic> toJson() => {
    'cle': clientKey,
    'code': code,
    'cible': target,
    'objet': object,
    'type': contentType,
    'le': recordedAt.toUtc().toIso8601String(),
    if (error != null) 'erreur': error,
  };
}

/// UUID v4 tiré au hasard (clé d'envoi).
String newClientKey([Random? random]) {
  final rng = random ?? Random.secure();
  final b = List<int>.generate(16, (_) => rng.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-'
      '${h.substring(16, 20)}-${h.substring(20)}';
}

/// Coffre des voix en attente, dans [directory] (espace privé de l'application).
class VoiceVault {
  VoiceVault({required this.directory, required this.secrets, Random? random})
    : _random = random ?? Random.secure();

  final Directory directory;
  final SecretStore secrets;
  final Random _random;
  final _cipher = AesGcm.with256bits();
  SecretKey? _key;

  File get _index => File('${directory.path}/attente.json');
  File _file(String clientKey) => File('${directory.path}/$clientKey.voix');

  Future<SecretKey> _secretKey() async {
    if (_key != null) return _key!;
    var hex = await secrets.read(_vaultKeyName);
    if (hex == null || hex.length != 64) {
      hex = List.generate(
        32,
        (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0'),
      ).join();
      await secrets.write(_vaultKeyName, hex);
    }
    final bytes = [
      for (var i = 0; i < 64; i += 2)
        int.parse(hex.substring(i, i + 2), radix: 16),
    ];
    return _key = SecretKey(bytes);
  }

  /// Envois en attente, du plus ancien au plus récent.
  Future<List<PendingVoice>> pending() async {
    if (!await _index.exists()) return [];
    try {
      final list = jsonDecode(await _index.readAsString()) as List;
      return [
        for (final p in list) PendingVoice.fromJson(p as Map<String, dynamic>),
      ];
    } on FormatException {
      return [];
    }
  }

  Future<void> _save(List<PendingVoice> list) async {
    await directory.create(recursive: true);
    // Écriture dans un fichier voisin puis renommage : la liste n'est jamais à moitié écrite
    final tmp = File('${_index.path}.tmp');
    await tmp.writeAsString(jsonEncode([for (final p in list) p.toJson()]));
    await tmp.rename(_index.path);
  }

  /// Chiffre l'enregistrement [audio] et le met en attente ; un enregistrement plus ancien de
  /// la même cible, pas encore envoyé, est remplacé (seul le dernier compte).
  Future<PendingVoice> put({
    required String code,
    required String target,
    required String object,
    required String contentType,
    required List<int> audio,
    DateTime? now,
  }) async {
    final voice = PendingVoice(
      clientKey: newClientKey(_random),
      code: code,
      target: target,
      object: object,
      contentType: contentType,
      recordedAt: now ?? DateTime.now(),
    );
    final box = await _cipher.encrypt(audio, secretKey: await _secretKey());
    await directory.create(recursive: true);
    await _file(voice.clientKey).writeAsBytes(box.concatenation(), flush: true);
    final list = await pending();
    for (final old in list.where((p) => p.sameTarget(voice))) {
      await _delete(old.clientKey);
    }
    await _save([...list.where((p) => !p.sameTarget(voice)), voice]);
    return voice;
  }

  /// Voix déchiffrée (réécoute avant l'envoi, envoi).
  Future<List<int>> read(PendingVoice voice) async {
    final bytes = await _file(voice.clientKey).readAsBytes();
    final box = SecretBox.fromConcatenation(
      bytes,
      nonceLength: _cipher.nonceLength,
      macLength: _cipher.macAlgorithm.macLength,
    );
    return _cipher.decrypt(box, secretKey: await _secretKey());
  }

  /// Retire l'envoi et efface son fichier (reçu par le serveur, ou abandonné).
  Future<void> remove(PendingVoice voice) async {
    await _delete(voice.clientKey);
    final list = await pending();
    await _save(list.where((p) => p.clientKey != voice.clientKey).toList());
  }

  Future<void> markFailed(PendingVoice voice, String message) async {
    final list = await pending();
    await _save([
      for (final p in list)
        p.clientKey == voice.clientKey ? p.failed(message) : p,
    ]);
  }

  Future<void> _delete(String clientKey) async {
    final file = _file(clientKey);
    if (await file.exists()) await file.delete();
  }
}

extension on PendingVoice {
  bool sameTarget(PendingVoice other) =>
      code == other.code && target == other.target && object == other.object;
}
