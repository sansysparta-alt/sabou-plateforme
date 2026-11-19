// Dossier de certification du praticien, par l'API (US-040a, §2.26) avec le jeton de
// l'application (US-040b, §2.29). Mêmes routes et mêmes règles que depuis le site.
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'practitioner_http.dart';
import 'session.dart';

/// Types de pièces (packages/types/src/dossiers.ts) et leurs libellés.
const pieceLabels = <String, String>{
  'identite': 'Pièce d’identité',
  'photo': 'Photo du praticien',
  'justificatif': 'Justificatif',
  'autre': 'Autre pièce',
};
const requiredPieces = ['identite', 'photo'];

class Option {
  const Option(this.id, this.label);
  final int id;
  final String label;
}

class SubPrefecture extends Option {
  const SubPrefecture(super.id, super.label, this.prefectureId);
  final int prefectureId;
}

class Language {
  const Language(this.code, this.name);
  final String code;
  final String name;
}

/// Listes de la fiche (GET /api/praticien/referentiels).
class Referentials {
  const Referentials({
    required this.specialties,
    required this.prefectures,
    required this.subPrefectures,
    required this.languages,
  });

  factory Referentials.fromJson(Map<String, dynamic> json) => Referentials(
    specialties: [
      for (final s in json['specialites'] as List)
        Option(s['id'] as int, s['libelle'] as String),
    ],
    prefectures: [
      for (final p in json['prefectures'] as List)
        Option(p['id'] as int, p['nom'] as String),
    ],
    subPrefectures: [
      for (final p in json['sousPrefectures'] as List)
        SubPrefecture(
          p['id'] as int,
          p['nom'] as String,
          p['prefectureId'] as int,
        ),
    ],
    languages: [
      for (final l in json['langues'] as List)
        Language(l['code'] as String, l['nom'] as String),
    ],
  );

  final List<Option> specialties;
  final List<Option> prefectures;
  final List<SubPrefecture> subPrefectures;
  final List<Language> languages;
}

/// Fiche du praticien (PUT /api/praticien/fiche).
class Profile {
  const Profile({
    required this.specialtyId,
    required this.prefectureId,
    required this.subPrefectureId,
    required this.language,
    required this.yearsOfExperience,
  });

  factory Profile.fromJson(Map<String, dynamic> json) => Profile(
    specialtyId: json['specialiteId'] as int,
    prefectureId: json['prefectureId'] as int,
    subPrefectureId: json['sousPrefectureId'] as int?,
    language: json['languePrincipale'] as String,
    yearsOfExperience: json['anneesExperience'] as int,
  );

  final int specialtyId;
  final int prefectureId;
  final int? subPrefectureId;
  final String language;
  final int yearsOfExperience;

  Map<String, Object?> toJson() => {
    'specialiteId': specialtyId,
    'prefectureId': prefectureId,
    'sousPrefectureId': subPrefectureId,
    'languePrincipale': language,
    'anneesExperience': yearsOfExperience,
  };
}

class Piece {
  const Piece(this.id, this.type, this.size);
  final int id;
  final String type;
  final int? size;
}

class Dossier {
  const Dossier({
    required this.code,
    required this.step,
    required this.status,
    required this.pieces,
    required this.missing,
  });

  final String code;
  final int step;
  final String status;
  final List<Piece> pieces;
  final List<String> missing;

  /// Le praticien ne modifie son dossier qu'à l'étape 1 (règle tenue par la base).
  bool get editable => step == 1;
}

/// Ce que le praticien voit de son dossier (GET /api/praticien/dossier).
class PractitionerView {
  const PractitionerView({
    required this.code,
    required this.status,
    required this.profile,
    required this.dossier,
  });

  factory PractitionerView.fromJson(Map<String, dynamic> json) {
    final p = json['praticien'] as Map<String, dynamic>;
    final d = json['dossier'] as Map<String, dynamic>?;
    return PractitionerView(
      code: p['code'] as String,
      status: p['statut'] as String,
      profile: Profile.fromJson(p),
      dossier: d == null
          ? null
          : Dossier(
              code: d['code'] as String,
              step: d['etape'] as int,
              status: d['statut'] as String,
              pieces: [
                for (final piece in d['pieces'] as List)
                  Piece(
                    piece['id'] as int,
                    piece['type'] as String,
                    piece['tailleOctets'] as int?,
                  ),
              ],
              missing: [
                for (final m in d['piecesManquantes'] as List) m as String,
              ],
            ),
    );
  }

  final String code;
  final String status;
  final Profile profile;
  final Dossier? dossier;
}

/// Accusé de réception de la soumission (critère 1 de US-040).
class Receipt {
  const Receipt(this.code, this.submittedAt);
  final String code;
  final DateTime submittedAt;
}

/// Refus expliqué par l'API (message en français, à afficher tel quel).
class DossierException implements Exception {
  const DossierException(this.code, this.message, {this.missing = const []});
  final String code;
  final String message;

  /// Pièces obligatoires manquantes (code « missing_pieces », critère 2 de US-040).
  final List<String> missing;

  @override
  String toString() => message;
}

class DossierApi {
  DossierApi({
    required Uri baseUrl,
    required PractitionerSession session,
    http.Client? client,
  }) : _http = PractitionerHttp(
         baseUrl: baseUrl,
         session: session,
         client: client,
       );

  final PractitionerHttp _http;

  Future<Referentials> referentials() async {
    final response = await _send('GET', 'referentiels');
    return Referentials.fromJson(_json(response));
  }

  /// Fiche et dossier ; null tant que la fiche n'est pas remplie.
  Future<PractitionerView?> view() async {
    final response = await _send('GET', 'dossier', allowNotFound: true);
    if (response.statusCode == 404) return null;
    return PractitionerView.fromJson(_json(response));
  }

  Future<void> saveProfile(Profile profile) async {
    await _send(
      'PUT',
      'fiche',
      body: utf8.encode(jsonEncode(profile.toJson())),
      contentType: 'application/json',
    );
  }

  /// Dépose une pièce : le fichier lui-même dans le corps (§2.26), JPEG préparé par
  /// preparePhoto (compressé, sans métadonnées).
  Future<void> addPiece(String type, Uint8List jpeg) async {
    await _send(
      'POST',
      'dossier/pieces/$type',
      body: jpeg,
      contentType: 'image/jpeg',
      // 3G : 500 Ko à 400 kbit/s ≈ 10 s, marge pour un réseau chargé
      timeout: const Duration(seconds: 90),
    );
  }

  Future<void> removePiece(int id) async {
    await _send('DELETE', 'dossier/pieces/$id');
  }

  Future<Receipt> submit() async {
    final body = _json(await _send('POST', 'dossier/soumission'));
    return Receipt(
      body['code'] as String,
      DateTime.parse(body['soumisLe'] as String),
    );
  }

  Future<http.Response> _send(
    String method,
    String path, {
    List<int>? body,
    String? contentType,
    bool allowNotFound = false,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    final response = await _http.send(
      method,
      path,
      body: body,
      contentType: contentType,
      timeout: timeout,
    );
    if (PractitionerHttp.ok(response)) return response;
    if (response.statusCode == 404 && allowNotFound) return response;
    throw _error(response);
  }

  static Map<String, dynamic> _json(http.Response response) =>
      jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;

  static DossierException _error(http.Response response) {
    try {
      final body = _json(response);
      final message = body['message'];
      if (message is String && message.isNotEmpty) {
        return DossierException(
          body['error'] as String? ?? 'error',
          message,
          missing: [
            for (final m in (body['piecesManquantes'] as List?) ?? const [])
              m as String,
          ],
        );
      }
    } on FormatException {
      // Réponse sans corps JSON (passerelle, coupure) : message générique ci-dessous
    }
    return DossierException(
      'http_${response.statusCode}',
      response.statusCode == 403
          ? 'Ce compte ne peut pas agir sur un dossier de praticien.'
          : 'Le serveur n’a pas pu traiter la demande. Réessayez dans un moment.',
    );
  }
}
