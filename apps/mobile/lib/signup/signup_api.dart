// Inscription du praticien depuis l'application (US-066) : même API que le site public
// (US-014, US-040a), en trois étapes. Sans session ; l'application n'envoie pas d'en-tête
// Origin, ce que l'API accepte (05_Choix_Techniques.md §2.62).
import 'dart:async';
import 'dart:convert';
import 'dart:io' show SocketException;

import 'package:http/http.dart' as http;

/// Refus de l'API : code stable (traduit par l'écran) et message français de l'API.
class SignupException implements Exception {
  const SignupException(
    this.code,
    this.message, {
    this.remainingAttempts,
    this.retryAfter,
  });

  /// invalid, code_invalid, code_expired, ticket_invalid, too_many (SignupErrorCode).
  final String code;
  final String message;
  final int? remainingAttempts;

  /// Délai d'attente annoncé par l'API (en-tête Retry-After), en secondes.
  final int? retryAfter;

  @override
  String toString() => message;
}

/// Le serveur n'a pas pu être joint (pas de réseau, délai dépassé).
class SignupOfflineException implements Exception {
  const SignupOfflineException();
}

/// Résultat de la vérification du code : ticket d'inscription, ou numéro déjà inscrit.
sealed class VerifyResult {
  const VerifyResult();
}

class NewNumber extends VerifyResult {
  const NewNumber(this.ticket);
  final String ticket;
}

class ExistingAccount extends VerifyResult {
  const ExistingAccount();
}

class SignupApi {
  SignupApi({
    required this.baseUrl,
    http.Client? client,
    this.timeout = const Duration(seconds: 30),
  }) : _client = client ?? http.Client();

  final Uri baseUrl;
  final Duration timeout;
  final http.Client _client;

  /// Étape 1 : un code est envoyé par SMS au numéro (forme nationale, 9 chiffres).
  Future<void> requestCode(String phone) async {
    await _post('code', {'phone': phone});
  }

  /// Étape 2 : le code reçu par SMS contre un ticket d'inscription.
  Future<VerifyResult> verify(String phone, String code) async {
    final body = await _post('verification', {'phone': phone, 'code': code});
    final ticket = body['ticket'];
    return body['status'] == 'new' && ticket is String
        ? NewNumber(ticket)
        : const ExistingAccount();
  }

  /// Étape 3 : le compte praticien. Faux si le numéro a été inscrit entre-temps.
  Future<bool> complete({
    required String ticket,
    required String firstName,
    required String lastName,
    required String password,
  }) async {
    final body = await _post('compte', {
      'ticket': ticket,
      'profile': 'praticien',
      'firstName': firstName,
      'lastName': lastName,
      'password': password,
    });
    return body['status'] == 'created';
  }

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, String> payload,
  ) async {
    final http.Response response;
    try {
      response = await _client
          .post(
            baseUrl.resolve('/api/inscription/$path'),
            headers: const {
              'content-type': 'application/json',
              'accept': 'application/json',
            },
            body: jsonEncode(payload),
          )
          .timeout(timeout);
    } on SocketException {
      throw const SignupOfflineException();
    } on http.ClientException {
      throw const SignupOfflineException();
    } on TimeoutException {
      throw const SignupOfflineException();
    }
    final body = _json(response);
    if (response.statusCode >= 200 && response.statusCode < 300) return body;
    final message = body['message'];
    throw SignupException(
      body['error'] is String ? body['error'] as String : 'error',
      message is String && message.isNotEmpty
          ? message
          : 'L’inscription n’a pas abouti.',
      remainingAttempts: body['remainingAttempts'] is int
          ? body['remainingAttempts'] as int
          : null,
      retryAfter: int.tryParse(response.headers['retry-after'] ?? ''),
    );
  }

  static Map<String, dynamic> _json(http.Response response) {
    if (response.bodyBytes.isEmpty) return const {};
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      return decoded is Map<String, dynamic> ? decoded : const {};
    } on FormatException {
      return const {};
    }
  }
}
