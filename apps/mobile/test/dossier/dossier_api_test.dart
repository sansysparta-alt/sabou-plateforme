// US-040b : client de l'API du dossier (jeton, nouvel essai, refus expliqués).
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sabou_mobile/dossier/dossier_api.dart';
import 'package:sabou_mobile/dossier/session.dart';

import 'fakes.dart';

void main() {
  late FakeServer server;
  late PractitionerSession session;
  late DossierApi api;

  setUp(() async {
    server = FakeServer();
    session = PractitionerSession(
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
    );
  });

  test('jeton refusé par l’API (horloge décalée) : un seul nouvel essai, jeton tout neuf', () async {
    server.validAccess.remove(fakeAccess('acces-1'));
    expect(await api.view(), isNull);
    final calls = server.requests
        .map((r) => '${r.method} ${r.url.path}')
        .toList();
    expect(calls, [
      'GET /api/praticien/dossier',
      'POST /realms/sabou-public/protocol/openid-connect/token',
      'GET /api/praticien/dossier',
    ]);
    expect(
      server.requests.last.headers['authorization'],
      'Bearer ${fakeAccess('acces-2')}',
    );
  });

  test('jeton toujours refusé : reconnexion demandée', () async {
    server.validAccess.clear();
    server.keycloakRejectsRefresh = true;
    await expectLater(api.view(), throwsA(isA<SignedOutException>()));
  });

  test(
    'soumission incomplète : message et pièces manquantes de l’API',
    () async {
      await expectLater(
        api.submit(),
        throwsA(
          isA<DossierException>()
              .having((e) => e.code, 'code', 'missing_pieces')
              .having((e) => e.missing, 'missing', ['identite', 'photo'])
              .having(
                (e) => e.message,
                'message',
                startsWith('Pièces obligatoires manquantes'),
              ),
        ),
      );
    },
  );

  test('réponse sans message (passerelle, compte non praticien) : message générique en français', () async {
    for (final (status, expected) in [
      (
        502,
        'Le serveur n’a pas pu traiter la demande. Réessayez dans un moment.',
      ),
      (403, 'Ce compte ne peut pas agir sur un dossier de praticien.'),
    ]) {
      final failing = DossierApi(
        baseUrl: Uri.parse('http://api.test'),
        session: session,
        client: MockClient((_) async => http.Response('<html>', status)),
      );
      await expectLater(
        failing.submit(),
        throwsA(
          isA<DossierException>().having((e) => e.message, 'message', expected),
        ),
      );
    }
  });
}
