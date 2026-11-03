// US-004 : surcoût du chiffrement SQLCipher, mesuré sur le téléphone (mode profil) :
//   flutter drive --profile --driver=test_driver/integration_test.dart \
//     --target=integration_test/chiffrement_test.dart
// Même bibliothèque partout : SQLCipher sans clé se comporte comme SQLite. Deux formes de
// clé : phrase (dérivée par PBKDF2, 256 000 itérations) et clé brute x'…' (retenue).
// Scénario d'un agent : 300 dossiers enregistrés un par un, relus, base rouverte.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:powersync/powersync.dart';
import 'package:sabou_mobile/sync/saisie_store.dart';
import 'package:sabou_mobile/sync/sync_schema.dart';

const dossiers = 300;
const rounds = 3;

// Dossier type : environ 2 Kio de texte
Map<String, dynamic> contenu(int i) => {
  'praticien': 'Praticien $i',
  'notes': 'Visite de terrain, observations détaillées. ' * 40,
};

Future<Map<String, int>> measure(String path, String? key) async {
  int elapsed(Stopwatch w) => w.elapsedMicroseconds;
  PowerSyncDatabase open() => PowerSyncDatabase(
    schema: syncSchema,
    path: path,
    encryption: key == null ? null : EncryptionOptions(key: key),
  );

  final first = Stopwatch()..start();
  var db = open();
  await db.initialize();
  first.stop();

  final store = SaisieStore(db);
  final writes = Stopwatch()..start();
  for (var i = 0; i < dossiers; i++) {
    await store.create(contenu(i));
  }
  writes.stop();

  final reads = Stopwatch()..start();
  for (var i = 0; i < 10; i++) {
    final rows = await db.getAll('SELECT * FROM $saisieTable');
    expect(rows.map(Saisie.fromRow), hasLength(dossiers));
  }
  reads.stop();
  await db.close();

  final reopen = Stopwatch()..start();
  db = open();
  await db.initialize();
  await db.get('SELECT count(*) FROM $saisieTable');
  reopen.stop();
  await db.close();

  return {
    'ouverture_neuve_us': elapsed(first),
    'ecriture_par_dossier_us': elapsed(writes) ~/ dossiers,
    'lecture_300_dossiers_us': elapsed(reads) ~/ 10,
    'reouverture_us': elapsed(reopen),
    'taille_octets': await File(path).length(),
  };
}

int median(List<int> values) => (values..sort())[values.length ~/ 2];

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('surcoût de SQLCipher sur le téléphone', (tester) async {
    await tester.runAsync(() async {
      final dir = await getTemporaryDirectory();
      final keys = <String, String?>{
        'sqlite': null,
        'sqlcipher_cle_brute': "x'${'5a' * 32}'",
        'sqlcipher_phrase': 'phrase-de-mesure',
      };
      final results = {for (final v in keys.keys) v: <String, List<int>>{}};
      for (var round = 0; round < rounds; round++) {
        // Alternance pour ne pas avantager une variante (cache, température)
        final order = keys.keys.toList();
        for (final variant in round.isEven ? order : order.reversed) {
          final path = '${dir.path}/bench_${variant}_$round.db';
          for (final f in [path, '$path-wal', '$path-shm']) {
            if (File(f).existsSync()) File(f).deleteSync();
          }
          final m = await measure(path, keys[variant]);
          m.forEach(
            (k, v) => results[variant]!.putIfAbsent(k, () => []).add(v),
          );
        }
      }
      final report = {
        for (final variant in results.keys)
          variant: {
            for (final e in results[variant]!.entries) e.key: median(e.value),
          },
      };
      binding.reportData = report;
      // ignore: avoid_print
      print('SABOU_MESURE ${jsonEncode(report)}');
    });
  });
}
