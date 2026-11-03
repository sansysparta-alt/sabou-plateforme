// Clé de chiffrement de la base du téléphone (US-004) : tirée au hasard au premier
// lancement, gardée dans le magasin sécurisé du système (Keystore Android), jamais dans
// le code ni dans un fichier de l'application.
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Lecture et écriture d'un secret ; remplaçable dans les tests.
abstract interface class SecretStore {
  Future<String?> read(String name);
  Future<void> write(String name, String value);
}

/// Magasin sécurisé du téléphone : sous Android, chiffré par une clé du Keystore.
class DeviceSecretStore implements SecretStore {
  DeviceSecretStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String name) => _storage.read(key: name);

  @override
  Future<void> write(String name, String value) =>
      _storage.write(key: name, value: value);
}

const _keyName = 'sabou.database_key';

/// Renvoie la clé de la base, créée au premier appel : 256 bits tirés au hasard, en
/// hexadécimal (64 caractères).
Future<String> databaseKey(SecretStore store, {Random? random}) async {
  final existing = await store.read(_keyName);
  if (existing != null && existing.isNotEmpty) return existing;
  final rng = random ?? Random.secure();
  final key = List.generate(
    32,
    (_) => rng.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
  await store.write(_keyName, key);
  return key;
}
