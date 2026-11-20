// Litiges du praticien (US-101, UC-43 ; décisions du maître d'œuvre du 19 novembre 2026,
// §2.88) : il ouvre un litige, ou son recours dans les 30 jours d'un rejet définitif, échange
// avec l'administration, joint des pièces et lit la décision motivée. Routes
// /api/praticien/litiges, jeton de l'application ; la base contrôle tout.
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../dossier/practitioner_http.dart';
import '../dossier/session.dart';

class DisputeSummary {
  const DisputeSummary({
    required this.code,
    required this.recourse,
    required this.subject,
    required this.status,
    required this.issue,
    required this.openedAt,
  });

  factory DisputeSummary.fromJson(Map<String, dynamic> json) => DisputeSummary(
    code: json['code'] as String,
    recourse: json['type'] == 'recours',
    subject: json['objet'] as String,
    status: json['statut'] as String,
    issue: json['issue'] as String?,
    openedAt: DateTime.parse(json['ouvertLe'] as String),
  );

  final String code;

  /// Recours après un rejet définitif ; sinon litige ordinaire.
  final bool recourse;
  final String subject;

  /// ouvert, en_arbitrage, avis_rendu, resolu.
  final String status;

  /// accepte, refuse ; null tant que le litige n'est pas résolu.
  final String? issue;
  final DateTime openedAt;
}

class DisputeMessage {
  const DisputeMessage(this.fromPractitioner, this.author, this.text, this.at);
  final bool fromPractitioner;
  final String author;
  final String text;
  final DateTime at;
}

class DisputeDetail {
  const DisputeDetail({
    required this.summary,
    required this.messages,
    required this.pieces,
    required this.decision,
    required this.certificate,
    required this.rejectionReason,
  });

  factory DisputeDetail.fromJson(Map<String, dynamic> json) => DisputeDetail(
    summary: DisputeSummary.fromJson(json),
    messages: [
      for (final m in json['messages'] as List)
        DisputeMessage(
          (m as Map)['auteur'] == 'praticien',
          m['auteurNom'] as String,
          m['contenu'] as String,
          DateTime.parse(m['le'] as String),
        ),
    ],
    pieces: (json['pieces'] as List).length,
    decision: json['decision'] as String?,
    certificate: json['certificat'] as String?,
    rejectionReason: json['rejetMotif'] as String?,
  );

  final DisputeSummary summary;
  final List<DisputeMessage> messages;

  /// Nombre de pièces jointes (des deux parties).
  final int pieces;

  /// Motif de la décision, une fois le litige résolu.
  final String? decision;

  /// Recours accepté d'un praticien certifié : numéro du nouveau certificat.
  final String? certificate;
  final String? rejectionReason;
}

class PractitionerDisputes {
  const PractitionerDisputes({
    required this.canAppeal,
    required this.appealUntil,
    required this.disputes,
  });

  /// Recours encore possible (rejet définitif de moins de 30 jours, sans recours ouvert).
  final bool canAppeal;

  /// Dernier jour du recours, 2026-12-14.
  final String? appealUntil;
  final List<DisputeSummary> disputes;
}

/// Refus de l'API, montré tel quel.
class DisputeException implements Exception {
  const DisputeException(this.code, this.message);
  final String code;
  final String message;

  @override
  String toString() => message;
}

class DisputesApi {
  DisputesApi({
    required Uri baseUrl,
    required PractitionerSession session,
    http.Client? client,
  }) : _http = PractitionerHttp(
         baseUrl: baseUrl,
         session: session,
         client: client,
       );

  final PractitionerHttp _http;

  Future<PractitionerDisputes> list() async {
    final body = _map(await _check(await _http.send('GET', 'litiges')));
    return PractitionerDisputes(
      canAppeal: body['recoursPossible'] as bool,
      appealUntil: body['recoursJusquau'] as String?,
      disputes: [
        for (final d in body['litiges'] as List)
          DisputeSummary.fromJson(d as Map<String, dynamic>),
      ],
    );
  }

  /// Ouvre un litige (« recours » ou « autre ») ; renvoie son code.
  Future<String> open({
    required bool recourse,
    required String subject,
    required String message,
  }) async {
    final body = _map(
      await _check(
        await _http.sendJson('POST', 'litiges', {
          'type': recourse ? 'recours' : 'autre',
          'objet': subject,
          'message': message,
        }),
      ),
    );
    return body['code'] as String;
  }

  Future<DisputeDetail> detail(String code) async => DisputeDetail.fromJson(
    _map(await _check(await _http.send('GET', 'litiges/${_enc(code)}'))),
  );

  Future<void> message(String code, String text) async {
    await _check(
      await _http.sendJson('POST', 'litiges/${_enc(code)}/messages', {
        'contenu': text,
      }),
    );
  }

  /// Pièce : photo préparée (JPEG compressé, sans métadonnées).
  Future<void> addPiece(String code, Uint8List jpeg) async {
    await _check(
      await _http.send(
        'POST',
        'litiges/${_enc(code)}/pieces',
        body: jpeg,
        contentType: 'image/jpeg',
        timeout: const Duration(seconds: 90),
      ),
    );
  }

  static String _enc(String code) => Uri.encodeComponent(code);

  static Map<String, dynamic> _map(http.Response response) =>
      PractitionerHttp.decode(response) as Map<String, dynamic>;

  static Future<http.Response> _check(http.Response response) async {
    if (PractitionerHttp.ok(response)) return response;
    try {
      final body = PractitionerHttp.decode(response);
      if (body is Map && body['message'] is String) {
        final message = body['message'];
        throw DisputeException(
          body['error'] as String? ?? 'error',
          message is String ? message : 'Demande refusée.',
        );
      }
    } on FormatException {
      // Réponse sans corps JSON : message générique ci-dessous
    }
    throw DisputeException(
      'http_${response.statusCode}',
      'Le serveur n’a pas pu traiter la demande. Réessayez dans un moment.',
    );
  }
}
