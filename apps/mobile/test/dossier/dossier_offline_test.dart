// US-080, critère 1 : le dossier du praticien se consulte sans réseau (copie chiffrée du
// téléphone) ; ses modifications demandent le réseau (05 §2.85).
import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/dossier/dossier_api.dart';
import 'package:sabou_mobile/dossier/session.dart';

import '../studio/studio_offline_pages_test.dart' show MemorySealedFiles;
import 'fakes.dart';

void main() {
  late FakeServer server;
  late MemorySealedFiles copy;
  late DossierApi api;

  setUp(() async {
    server = FakeServer();
    copy = MemorySealedFiles();
    final session = PractitionerSession(
      store: MemorySecretStore(),
      launcher: FakeLauncher(),
      client: server.client,
      issuer: issuer,
    );
    await session.signIn();
    api = DossierApi(
      baseUrl: Uri.parse('http://api.test'),
      session: session,
      client: server.client,
      copy: copy,
      clock: () => DateTime.utc(2026, 11, 19, 9, 30),
    );
  });

  test('fiche et listes reçues en ligne, relues sans réseau avec la date de la copie', () async {
    server.profile = {
      'specialiteId': 1,
      'prefectureId': 4,
      'sousPrefectureId': null,
      'languePrincipale': 'pul',
      'anneesExperience': 12,
    };
    await api.referentials();
    await api.view();
    expect(api.offlineSince, isNull);
    server.offline = true;
    final view = await api.view();
    expect(view!.profile.language, 'pul');
    expect(api.offlineSince, '2026-11-19T09:30:00.000Z');
    expect((await api.referentials()), isNotNull);
  });

  test(
    'fiche pas encore remplie : « aucune fiche » relu aussi sans réseau',
    () async {
      expect(await api.view(), isNull);
      server.offline = true;
      expect(await api.view(), isNull);
    },
  );

  test('sans réseau ni copie : l’erreur de réseau remonte', () async {
    server.offline = true;
    expect(api.view, throwsA(isA<Exception>()));
  });

  test(
    'les modifications demandent le réseau (pas de copie pour l’écriture)',
    () async {
      server.offline = true;
      expect(() => api.removePiece(1), throwsA(isA<Exception>()));
    },
  );
}
