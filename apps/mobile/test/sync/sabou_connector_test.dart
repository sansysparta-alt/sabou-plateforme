// US-004, critère 2 : synchronisation coupée puis rétablie, le dossier arrive au serveur
// sans perte. Base locale réelle (chiffrée) ; serveur simulé.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:powersync/powersync.dart';
import 'package:sabou_mobile/sync/sabou_connector.dart';
import 'package:sabou_mobile/sync/saisie_store.dart';

void main() {
  late Directory dir;
  late PowerSyncDatabase db;
  late SaisieStore store;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('sabou_connector_');
    db = openSaisieDatabase(path: '${dir.path}/saisie.db', key: 'ab' * 32);
    store = SaisieStore(db);
  });

  tearDown(() async {
    await db.close();
    await dir.delete(recursive: true);
  });

  SabouConnector connector(MockClientHandler handler) => SabouConnector(
    powerSyncUrl: Uri.parse('http://localhost:8090'),
    apiUrl: Uri.parse('http://localhost:4000'),
    token: () async => 'jeton',
    client: MockClient(handler),
  );

  Future<int> pending() => store.watchPending().first;

  test('coupure pendant l’envoi : rien n’est perdu, le dossier part au rétablissement', () async {
    final id = await store.create({'praticien': 'Sékou Kourouma'});
    await store.update(id, {
      'praticien': 'Sékou Kourouma',
      'notes': 'visite faite',
    });

    // Réseau coupé : l'envoi échoue, la file reste intacte
    final offline = connector(
      (_) async => throw const SocketException('réseau coupé'),
    );
    await expectLater(offline.uploadData(db), throwsA(isA<SocketException>()));
    expect(await pending(), 2);

    // Serveur qui répond 503 : même chose
    final unavailable = connector((_) async => http.Response('', 503));
    await expectLater(
      unavailable.uploadData(db),
      throwsA(isA<http.ClientException>()),
    );
    expect(await pending(), 2);

    // Réseau rétabli : PowerSync vide la file, une transaction à la fois ; chaque envoi
    // porte le dossier entier dans son état final (le serveur répond « identique » au second)
    final sent = <Map<String, dynamic>>[];
    final online = connector((request) async {
      expect(request.url.toString(), 'http://localhost:4000/sync/upload');
      expect(request.headers['Authorization'], 'Bearer jeton');
      sent.add(jsonDecode(request.body) as Map<String, dynamic>);
      return http.Response('{"results":[]}', 200);
    });
    while (await pending() > 0) {
      await online.uploadData(db);
    }
    final operations = [for (final body in sent) ...body['operations'] as List];
    expect(operations.map((op) => op['op']), ['PUT', 'PATCH']);
    for (final op in operations) {
      expect(op, {
        'op': op['op'],
        'table': 'saisie_terrain',
        'id': id,
        'type': 'dossier',
        'contenu': {'praticien': 'Sékou Kourouma', 'notes': 'visite faite'},
        'version_base': null,
      });
    }
    expect(await pending(), 0);
  });

  test(
    'jeton expiré (401) : la file est gardée pour un nouvel essai',
    () async {
      await store.create({'praticien': 'A'});
      await expectLater(
        connector((_) async => http.Response('', 401)).uploadData(db),
        throwsA(isA<http.ClientException>()),
      );
      expect(await pending(), 1);
    },
  );

  test('lot refusé durablement (403) : il est abandonné pour ne pas bloquer la file', () async {
    await store.create({'praticien': 'A'});
    await connector((_) async => http.Response('', 403)).uploadData(db);
    expect(await pending(), 0);
  });

  test('envoie la version du serveur dont l’agent est parti (base du conflit R-DON-04)', () async {
    // Dossier reçu du serveur en version 4, puis modifié hors réseau
    await db.execute(
      "INSERT INTO ps_data__saisie_terrain (id, data) VALUES ('d1', json_object('type', 'dossier', 'contenu', '{\"praticien\":\"A\"}', 'statut', 'brouillon', 'version', 4))",
    );
    await store.update('d1', {'praticien': 'A modifié'});
    Map<String, dynamic>? body;
    await connector((request) async {
      body = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response('{"results":[]}', 200);
    }).uploadData(db);
    expect(
      (body!['operations'] as List).single,
      containsPair('version_base', 4),
    );
  });
}
