// Doubles des tests du dossier du praticien (US-040b) : Keycloak et API simulés derrière un
// MockClient, magasin sécurisé en mémoire. Les règles réelles de l'API et de Keycloak sont
// prouvées par apps/api (tests) et apps/site/e2e-compte/mobile.spec.ts.
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sabou_mobile/dossier/session.dart';
import 'package:sabou_mobile/sync/database_key.dart';

const issuer = 'http://kc.test/realms/sabou-public';
const oidc = '$issuer/protocol/openid-connect';

class MemorySecretStore implements SecretStore {
  final values = <String, String>{};

  @override
  Future<String?> read(String name) async => values[name];

  @override
  Future<void> write(String name, String value) async => values[name] = value;
}

class FakeLauncher implements LoginLauncher {
  Tokens? next = Tokens(
    accessToken: 'acces-1',
    refreshToken: 'rafraichissement-1',
    expiresAt: DateTime.now().add(const Duration(minutes: 5)),
  );
  int calls = 0;

  @override
  Future<Tokens?> login() async {
    calls++;
    return next;
  }
}

/// Serveur simulé : Keycloak (jeton, révocation) et API du praticien.
class FakeServer {
  final requests = <http.Request>[];
  int refreshCount = 0;
  bool keycloakRejectsRefresh = false;
  bool offline = false;

  /// Jetons d'accès que l'API accepte (les autres reçoivent 401).
  final validAccess = <String>{'acces-1'};

  // État du dossier
  Map<String, Object?>? profile;
  final pieces = <Map<String, Object?>>[];
  final uploads = <String, Uint8List>{};
  bool submitted = false;

  late final client = MockClient(handle);

  List<String> get missing => [
    'identite',
    'photo',
  ].where((t) => !pieces.any((p) => p['type'] == t)).toList();

  Future<http.Response> handle(http.Request request) async {
    if (offline) throw http.ClientException('Réseau injoignable');
    requests.add(request);
    final url = request.url.toString();
    if (url == '$oidc/token') {
      if (keycloakRejectsRefresh) return _json(400, {'error': 'invalid_grant'});
      refreshCount++;
      final access = 'acces-${refreshCount + 1}';
      validAccess.add(access);
      return _json(200, {
        'access_token': access,
        'refresh_token': 'rafraichissement-${refreshCount + 1}',
        'expires_in': 300,
      });
    }
    if (url == '$oidc/revoke') return http.Response('', 200);

    final auth = request.headers['authorization'] ?? '';
    if (!validAccess.contains(auth.replaceFirst('Bearer ', ''))) {
      return http.Response('', 401);
    }
    final path = request.url.path.replaceFirst('/api/praticien/', '');
    switch ((request.method, path)) {
      case ('GET', 'referentiels'):
        return _json(200, {
          'specialites': [
            {'id': 1, 'libelle': 'Herboristerie'},
            {'id': 2, 'libelle': 'Rebouteux'},
          ],
          'prefectures': [
            {'id': 4, 'nom': 'Labé'},
            {'id': 5, 'nom': 'Mamou'},
          ],
          'sousPrefectures': [
            {'id': 40, 'nom': 'Garambé', 'prefectureId': 4},
            {'id': 50, 'nom': 'Dounet', 'prefectureId': 5},
          ],
          'langues': [
            {'code': 'pul', 'nom': 'Pular'},
            {'code': 'sus', 'nom': 'Soussou'},
          ],
        });
      case ('GET', 'dossier'):
        if (profile == null) return http.Response('', 404);
        return _json(200, {
          'praticien': {'code': 'PR-2001', 'statut': 'en_attente', ...profile!},
          'dossier': pieces.isEmpty && !submitted
              ? null
              : {
                  'code': 'DS-2001',
                  'etape': submitted ? 2 : 1,
                  'statut': 'en_cours',
                  'ouvertLe': '2026-11-08T10:00:00.000Z',
                  'pieces': pieces,
                  'piecesManquantes': missing,
                },
        });
      case ('PUT', 'fiche'):
        profile = jsonDecode(request.body) as Map<String, Object?>;
        return http.Response('', 204);
      case ('POST', 'dossier/soumission'):
        if (missing.isNotEmpty) {
          return _json(422, {
            'error': 'missing_pieces',
            'message': 'Pièces obligatoires manquantes : photo du praticien.',
            'piecesManquantes': missing,
          });
        }
        submitted = true;
        return _json(200, {
          'code': 'DS-2001',
          'etape': 2,
          'soumisLe': '2026-11-08T10:30:00.000Z',
        });
    }
    if (request.method == 'POST' && path.startsWith('dossier/pieces/')) {
      final type = path.split('/').last;
      uploads[type] = request.bodyBytes;
      pieces.add({
        'id': pieces.length + 1,
        'type': type,
        'typeMime': 'image/jpeg',
        'tailleOctets': request.bodyBytes.length,
        'deposeLe': '2026-11-08T10:10:00.000Z',
      });
      return _json(201, {'id': pieces.length});
    }
    if (request.method == 'DELETE' && path.startsWith('dossier/pieces/')) {
      final id = int.parse(path.split('/').last);
      pieces.removeWhere((p) => p['id'] == id);
      return http.Response('', 204);
    }
    return http.Response('', 404);
  }

  static http.Response _json(int status, Object body) => http.Response.bytes(
    utf8.encode(jsonEncode(body)),
    status,
    headers: {'content-type': 'application/json; charset=utf-8'},
  );
}
