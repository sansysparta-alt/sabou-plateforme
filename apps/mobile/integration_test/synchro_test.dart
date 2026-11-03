// US-004, critères 1 et 2 de bout en bout, sur le téléphone, contre les vrais services
// locaux (PowerSync, API, PostgreSQL) reliés par adb reverse :
//   adb reverse tcp:8090 tcp:8090 && adb reverse tcp:4000 tcp:4000
//   flutter drive --driver=test_driver/integration_test.dart \
//     --target=integration_test/synchro_test.dart \
//     --dart-define=SABOU_SYNC_TOKEN=$(pnpm --silent --filter @sabou/api sync:token 3 4)
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:sabou_mobile/sync/sabou_connector.dart';
import 'package:sabou_mobile/sync/saisie_store.dart';

Future<T> waitFor<T>(Stream<T> stream, bool Function(T) done) =>
    stream.firstWhere(done).timeout(const Duration(seconds: 60));

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'saisi hors réseau, le dossier arrive au serveur au retour du réseau',
    (tester) async {
      expect(
        devSyncToken,
        isNotEmpty,
        reason: 'jeton absent (--dart-define=SABOU_SYNC_TOKEN)',
      );
      await tester.runAsync(() async {
        final dir = await getTemporaryDirectory();
        final path =
            '${dir.path}/synchro_${DateTime.now().microsecondsSinceEpoch}.db';
        final db = openSaisieDatabase(path: path, key: 'c3' * 32);
        final store = SaisieStore(db);
        final connector = SabouConnector(
          powerSyncUrl: Uri.parse(defaultPowerSyncUrl),
          apiUrl: Uri.parse(defaultApiUrl),
          token: () async => devSyncToken,
        );

        // 1. Sans réseau : le dossier est gardé sur le téléphone, en attente d'envoi
        final id = await store.create({'praticien': 'Essai de bout en bout'});
        expect(await store.watchPending().first, 1);
        final stopwatch = Stopwatch()..start();

        // 2. Réseau rétabli : la file se vide et le dossier revient du serveur, numéroté
        await db.connect(connector: connector);
        await waitFor<int>(store.watchPending(), (n) => n == 0);
        final saisie = await waitFor<List<Saisie>>(
          store.watchAll(),
          (all) => all.any((s) => s.id == id && s.version != null),
        );
        stopwatch.stop();
        final arrived = saisie.firstWhere((s) => s.id == id);
        expect(arrived.version, 1);
        expect(arrived.contenu, {'praticien': 'Essai de bout en bout'});
        // ignore: avoid_print
        print('SABOU_SYNCHRO aller-retour ${stopwatch.elapsedMilliseconds} ms');

        await db.disconnectAndClear();
        await db.close();
        File(path).deleteSync();
      });
    },
  );
}
