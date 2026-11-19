// Fichiers chiffrés de l'espace privé de l'application (US-080, US-081) : AES-256-GCM, clé de
// 256 bits tirée au premier usage et gardée dans le magasin sécurisé du système (Keystore),
// comme la clé de la base (US-004). Chaque écriture passe par un fichier voisin puis un
// renommage : un fichier n'est jamais à moitié écrit, même si le téléphone s'éteint.
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:cryptography/cryptography.dart';

import '../sync/database_key.dart';

class SealedFiles {
  SealedFiles({
    required this.directory,
    required this.secrets,
    required this.keyName,
    Random? random,
  }) : _random = random ?? Random.secure();

  final Directory directory;
  final SecretStore secrets;

  /// Nom de la clé dans le magasin sécurisé (une clé par usage).
  final String keyName;
  final Random _random;
  final _cipher = AesGcm.with256bits();
  SecretKey? _key;

  File file(String name) => File('${directory.path}/$name');

  Future<SecretKey> _secretKey() async {
    if (_key != null) return _key!;
    var hex = await secrets.read(keyName);
    if (hex == null || hex.length != 64) {
      hex = List.generate(
        32,
        (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0'),
      ).join();
      await secrets.write(keyName, hex);
    }
    final bytes = [
      for (var i = 0; i < 64; i += 2)
        int.parse(hex.substring(i, i + 2), radix: 16),
    ];
    return _key = SecretKey(bytes);
  }

  Future<void> write(String name, List<int> clear) async {
    final box = await _cipher.encrypt(clear, secretKey: await _secretKey());
    await directory.create(recursive: true);
    final tmp = file('$name.tmp');
    await tmp.writeAsBytes(box.concatenation(), flush: true);
    await tmp.rename(file(name).path);
  }

  /// Contenu déchiffré ; null si le fichier n'existe pas. Lève une exception s'il a été
  /// altéré ou chiffré avec une autre clé (étiquette GCM invalide).
  Future<List<int>?> read(String name) async {
    final f = file(name);
    if (!await f.exists()) return null;
    final box = SecretBox.fromConcatenation(
      await f.readAsBytes(),
      nonceLength: _cipher.nonceLength,
      macLength: _cipher.macAlgorithm.macLength,
    );
    return _cipher.decrypt(box, secretKey: await _secretKey());
  }

  Future<void> writeJson(String name, Object? value) =>
      write(name, utf8.encode(jsonEncode(value)));

  Future<Object?> readJson(String name) async {
    final bytes = await read(name);
    return bytes == null ? null : jsonDecode(utf8.decode(bytes));
  }

  Future<void> delete(String name) async {
    final f = file(name);
    if (await f.exists()) await f.delete();
  }
}
