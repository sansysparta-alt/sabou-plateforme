// US-004, critère 1 et critère SQLCipher : un dossier saisi sans réseau est conservé
// dans la base du téléphone, chiffrée ; sans la clé, le fichier est illisible.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/sync/database_key.dart';
import 'package:sabou_mobile/sync/saisie_store.dart';
import 'package:sqlite3/sqlite3.dart';

class MemorySecretStore implements SecretStore {
  final values = <String, String>{};

  @override
  Future<String?> read(String name) async => values[name];

  @override
  Future<void> write(String name, String value) async => values[name] = value;
}

void main() {
  late Directory dir;
  late String path;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('sabou_sync_');
    path = '${dir.path}/saisie.db';
  });

  tearDown(() async {
    await dir.delete(recursive: true);
  });

  test(
    'un dossier saisi sans réseau survit à la fermeture de l’application',
    () async {
      final key = await databaseKey(MemorySecretStore());
      // Jamais connectée : aucun serveur n'est joignable
      final db = openSaisieDatabase(path: path, key: key);
      final store = SaisieStore(db);
      final id = await store.create({
        'praticien': 'Sékou Kourouma',
        'notes': 'visite',
      });
      await db.close();

      final reopened = openSaisieDatabase(path: path, key: key);
      final saisies = await SaisieStore(reopened).watchAll().first;
      expect(saisies.single.id, id);
      expect(saisies.single.contenu, {
        'praticien': 'Sékou Kourouma',
        'notes': 'visite',
      });
      expect(saisies.single.statut, 'brouillon');
      expect(saisies.single.version, isNull);
      // Et il attend dans la file d'envoi
      expect(await SaisieStore(reopened).watchPending().first, 1);
      await reopened.close();
    },
  );

  test(
    'sans la clé, le fichier de la base est illisible (SQLCipher)',
    () async {
      final key = await databaseKey(MemorySecretStore());
      final db = openSaisieDatabase(path: path, key: key);
      await SaisieStore(db).create({'praticien': 'Sékou Kourouma'});
      await db.close();

      // Le texte saisi n'apparaît pas en clair dans le fichier
      final bytes = await File(path).readAsBytes();
      expect(String.fromCharCodes(bytes).contains('Kourouma'), isFalse);
      expect(String.fromCharCodes(bytes.take(15)), isNot('SQLite format 3'));

      // Ouverte sans clé, ou avec une autre clé, la base refuse toute lecture
      for (final pragma in ['', "PRAGMA key = 'mauvaise-cle';"]) {
        final raw = sqlite3.open(path);
        try {
          expect(
            () => raw.execute('${pragma}SELECT count(*) FROM sqlite_master'),
            throwsA(isA<SqliteException>()),
          );
        } finally {
          raw.close();
        }
      }
    },
  );

  test('la clé est créée une fois, gardée dans le magasin sécurisé, puis réutilisée', () async {
    final secrets = MemorySecretStore();
    final first = await databaseKey(secrets);
    expect(first, matches(RegExp(r'^[0-9a-f]{64}$')));
    expect(secrets.values.values, [first]);
    expect(await databaseKey(secrets), first);
    // Deux téléphones n'ont jamais la même clé
    expect(await databaseKey(MemorySecretStore()), isNot(first));
  });
}
