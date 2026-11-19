// API d'inscription simulée (US-066) : réponses au format de l'API réelle (signup.controller,
// SignupErrorCode). Les règles elles-mêmes sont prouvées par les tests de l'API.
import 'dart:convert';
import 'dart:io' show SocketException;

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sabou_mobile/signup/signup_api.dart';

class FakeSignupServer {
  static const code = '123456';
  static const ticket = 'tttttttttttttttttttttttttttttttttttttttttt1';

  /// Numéros qui ont déjà un compte.
  final Set<String> existing = {};

  /// Requêtes reçues : chemin, corps, en-tête Origin.
  final List<({String path, Map<String, dynamic> body, String? origin})>
  requests = [];

  bool offline = false;
  int remainingAttempts = 4;

  late final client = MockClient(_handle);

  SignupApi api() =>
      SignupApi(baseUrl: Uri.parse('http://api.test'), client: client);

  Future<http.Response> _handle(http.Request request) async {
    if (offline) throw const SocketException('pas de réseau');
    final path = request.url.path.replaceFirst('/api/inscription/', '');
    final body = jsonDecode(request.body) as Map<String, dynamic>;
    requests.add((path: path, body: body, origin: request.headers['origin']));
    switch (path) {
      case 'code':
        return http.Response('', 202);
      case 'verification':
        if (body['code'] != code) {
          remainingAttempts--;
          return _json({
            'error': 'code_invalid',
            'message': 'Code incorrect.',
            'remainingAttempts': remainingAttempts,
          }, 400);
        }
        return existing.contains(body['phone'])
            ? _json({'status': 'existing'})
            : _json({'status': 'new', 'ticket': ticket});
      case 'compte':
        return _json({'status': 'created'});
    }
    return http.Response('', 404);
  }

  static http.Response _json(Object body, [int status = 200]) => http.Response(
    jsonEncode(body),
    status,
    headers: {'content-type': 'application/json; charset=utf-8'},
  );
}
