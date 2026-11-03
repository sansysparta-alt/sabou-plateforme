// Ouverture de la base de saisie sur le téléphone (US-004) : clé lue dans le Keystore,
// base chiffrée dans le dossier privé de l'application, synchronisation si un jeton existe.
import 'package:path_provider/path_provider.dart';

import 'database_key.dart';
import 'sabou_connector.dart';
import 'saisie_store.dart';

Future<SaisieStore>? _store;

/// Une seule base par lancement de l'application, ouverte au premier appel.
Future<SaisieStore> deviceSaisieStore() => _store ??= _open();

Future<SaisieStore> _open() async {
  final key = await databaseKey(DeviceSecretStore());
  final dir = await getApplicationSupportDirectory();
  final db = openSaisieDatabase(path: '${dir.path}/saisie.db', key: key);
  await db.initialize();
  if (devSyncToken.isNotEmpty) {
    // PowerSync se reconnecte seul au retour du réseau et vide la file d'envoi
    await db.connect(
      connector: SabouConnector(
        powerSyncUrl: Uri.parse(defaultPowerSyncUrl),
        apiUrl: Uri.parse(defaultApiUrl),
        token: () async => devSyncToken,
      ),
    );
  }
  return SaisieStore(db);
}
