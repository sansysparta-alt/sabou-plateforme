// Envoi des requêtes du praticien à l'API (/api/praticien/…) avec le jeton de l'application
// (US-040b, §2.29). Partagé par le dossier (US-040b) et le Studio (US-067) : un seul endroit
// pour le jeton, le nouvel essai après un refus et la déconnexion.
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'session.dart';

class PractitionerHttp {
  PractitionerHttp({
    required this.baseUrl,
    required this.session,
    http.Client? client,
    this.prefix = 'api/praticien',
  }) : _client = client ?? http.Client();

  final Uri baseUrl;

  /// Début du chemin : `api/praticien` pour le praticien ; pour l'agent préfectoral (US-082),
  /// `api/terrain/praticiens/PR-…` (Studio du praticien visé) ou `api/dossiers-terrain`.
  final String prefix;
  final PractitionerSession session;
  final http.Client _client;

  /// Envoie la requête ; renvoie la réponse telle quelle (2xx ou refus de l'API).
  /// Lève [SignedOutException] si la session n'est plus valable.
  Future<http.Response> send(
    String method,
    String path, {
    List<int>? body,
    String? contentType,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    Future<http.Response> attempt({required bool force}) async {
      final request =
          http.Request(
              method,
              baseUrl.resolve(path.isEmpty ? '/$prefix' : '/$prefix/$path'),
            )
            ..headers['authorization'] =
                'Bearer ${await session.accessToken(force: force)}'
            ..headers['accept'] = 'application/json';
      if (body != null) {
        request.bodyBytes = body;
        request.headers['content-type'] = contentType!;
      }
      return http.Response.fromStream(
        await _client.send(request).timeout(timeout),
      );
    }

    var response = await attempt(force: false);
    // Jeton refusé (horloge du téléphone décalée, clés changées) : un seul nouvel essai
    // avec un jeton tout neuf ; si Keycloak refuse aussi, SignedOutException
    if (response.statusCode == 401) response = await attempt(force: true);
    if (response.statusCode == 401) throw const SignedOutException();
    return response;
  }

  /// Corps JSON envoyé en UTF-8.
  Future<http.Response> sendJson(String method, String path, Object body) =>
      send(
        method,
        path,
        body: utf8.encode(jsonEncode(body)),
        contentType: 'application/json',
      );

  static Object? decode(http.Response response) =>
      jsonDecode(utf8.decode(response.bodyBytes));

  static bool ok(http.Response response) =>
      response.statusCode >= 200 && response.statusCode < 300;
}
