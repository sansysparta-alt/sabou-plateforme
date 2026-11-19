// Agent préfectoral sur le terrain (US-082, UC-32 et UC-35, décisions du maître d'œuvre du
// 19 novembre 2026, §2.86) :
// - praticiens de sa préfecture, auxquels il rattache une recette numérisée ;
// - dossier de praticien constitué sans réseau : identité, spécialité, localité, pièces et
//   photo, gardés chiffrés sur le téléphone (SealedFiles) puis envoyés au retour du réseau,
//   par les routes du dossier terrain (US-040c).
// Les listes reçues sont gardées chiffrées pour servir hors réseau. L'API et la base restent
// seules juges : préfecture de l'agent, second facteur, auteur ≠ vérificateur.
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../dossier/practitioner_http.dart';
import '../dossier/session.dart';
import '../studio/sealed_files.dart';

/// Praticien de la préfecture de l'agent (GET /api/terrain/praticiens).
class FieldPractitioner {
  const FieldPractitioner({
    required this.code,
    required this.name,
    required this.language,
    required this.status,
  });

  factory FieldPractitioner.fromJson(Map<String, dynamic> json) =>
      FieldPractitioner(
        code: json['code'] as String,
        name: json['nom'] as String,
        language: json['langue'] as String,
        status: json['statut'] as String,
      );

  final String code;
  final String name;

  /// Langue principale du praticien : langue de la voix par champ.
  final String language;

  /// en_attente, certifie, suspendu.
  final String status;
}

class Labelled {
  const Labelled(this.id, this.label);
  final Object id;
  final String label;
}

/// Listes du formulaire du dossier terrain (GET /api/dossiers-terrain/referentiels).
class FieldReferentials {
  const FieldReferentials({
    required this.prefecture,
    required this.specialities,
    required this.subPrefectures,
    required this.languages,
  });

  factory FieldReferentials.fromJson(Map<String, dynamic> json) =>
      FieldReferentials(
        prefecture: json['prefecture'] as String,
        specialities: [
          for (final s in json['specialites'] as List)
            Labelled((s as Map)['id'] as int, s['libelle'] as String),
        ],
        subPrefectures: [
          for (final s in json['sousPrefectures'] as List)
            Labelled((s as Map)['id'] as int, s['nom'] as String),
        ],
        languages: [
          for (final l in json['langues'] as List)
            Labelled((l as Map)['code'] as String, l['nom'] as String),
        ],
      );

  final String prefecture;
  final List<Labelled> specialities;
  final List<Labelled> subPrefectures;
  final List<Labelled> languages;
}

/// Pièces du dossier terrain : identité et photo obligatoires (R-CER, 7 novembre 2026).
const fieldPieceLabels = {
  'identite': 'Pièce d’identité',
  'photo': 'Photo du praticien',
  'justificatif': 'Justificatif de pratique',
};
const requiredFieldPieces = ['identite', 'photo'];

/// Dossier saisi sur le terrain, gardé sur le téléphone jusqu'à son envoi complet.
class FieldDraft {
  FieldDraft({
    required this.id,
    required this.fields,
    Set<String>? pieces,
    Set<String>? sentPieces,
    this.code,
  }) : pieces = pieces ?? {},
       sentPieces = sentPieces ?? {};

  factory FieldDraft.fromJson(Map<String, dynamic> json) => FieldDraft(
    id: json['id'] as String,
    fields: (json['fields'] as Map).cast<String, Object?>(),
    pieces: {for (final p in json['pieces'] as List) p as String},
    sentPieces: {for (final p in json['envoyees'] as List) p as String},
    code: json['code'] as String?,
  );

  /// Identifiant local (jamais envoyé).
  final String id;

  /// Corps de POST /api/dossiers-terrain : telephone, prenom, nom, specialiteId,
  /// sousPrefectureId, languePrincipale, anneesExperience.
  Map<String, Object?> fields;

  /// Pièces prises (photos préparées, chiffrées sur le téléphone), par type.
  final Set<String> pieces;

  /// Pièces déjà reçues par le serveur : un nouvel essai ne les renvoie pas.
  final Set<String> sentPieces;

  /// Code du dossier créé sur le serveur ; null tant qu'il ne l'est pas.
  String? code;

  String get displayName => '${fields['prenom']} ${fields['nom']}';

  List<String> get missingPieces =>
      requiredFieldPieces.where((p) => !pieces.contains(p)).toList();

  Map<String, Object?> toJson() => {
    'id': id,
    'fields': fields,
    'pieces': pieces.toList()..sort(),
    'envoyees': sentPieces.toList()..sort(),
    'code': code,
  };
}

/// Refus de l'API, à montrer tel quel ; [definitive] : un nouvel essai n'y changera rien.
class FieldException implements Exception {
  const FieldException(this.code, this.message, {this.definitive = true});
  final String code;
  final String message;
  final bool definitive;

  @override
  String toString() => message;
}

/// Brouillons et listes de l'agent, chiffrés sur le téléphone.
class FieldStore {
  FieldStore(this.files);

  final SealedFiles files;

  Future<List<FieldDraft>> drafts() async => [
    for (final d in (await _safe('brouillons.json')) as List? ?? const [])
      FieldDraft.fromJson(d as Map<String, dynamic>),
  ];

  Future<void> saveDraft(FieldDraft draft) async {
    final all = await drafts();
    final i = all.indexWhere((d) => d.id == draft.id);
    i < 0 ? all.add(draft) : all[i] = draft;
    await _saveAll(all);
  }

  /// Retire le brouillon et ses photos (dossier envoyé, ou abandonné par l'agent).
  Future<void> removeDraft(FieldDraft draft) async {
    await _saveAll([
      for (final d in await drafts())
        if (d.id != draft.id) d,
    ]);
    for (final type in fieldPieceLabels.keys) {
      await files.delete(_pieceName(draft.id, type));
    }
  }

  Future<void> savePiece(FieldDraft draft, String type, Uint8List jpeg) =>
      files.write(_pieceName(draft.id, type), jpeg);

  Future<Uint8List?> piece(FieldDraft draft, String type) async {
    final bytes = await files.read(_pieceName(draft.id, type));
    return bytes == null ? null : Uint8List.fromList(bytes);
  }

  Future<void> deletePiece(FieldDraft draft, String type) =>
      files.delete(_pieceName(draft.id, type));

  Future<Object?> cached(String name) => _safe(name);
  Future<void> keep(String name, Object? json) => files.writeJson(name, json);

  Future<void> _saveAll(List<FieldDraft> all) =>
      files.writeJson('brouillons.json', [for (final d in all) d.toJson()]);

  static String _pieceName(String draftId, String type) =>
      'piece-$draftId-$type.bin';

  // Copie illisible (clé changée, fichier abîmé) : traitée comme absente
  Future<Object?> _safe(String name) async {
    try {
      return await files.readJson(name);
    } on Exception {
      return null;
    }
  }
}

/// Liste lue sur le serveur, ou sa copie gardée quand le réseau manque.
class Fetched<T> {
  const Fetched(this.value, {required this.fromCopy});
  final T value;
  final bool fromCopy;
}

class FieldApi {
  FieldApi({
    required Uri baseUrl,
    required PractitionerSession session,
    required this.store,
    http.Client? client,
  }) : _http = PractitionerHttp(
         baseUrl: baseUrl,
         session: session,
         client: client,
         prefix: 'api',
       );

  final PractitionerHttp _http;
  final FieldStore store;

  /// Praticiens de la préfecture de l'agent ; null si jamais reçus et hors réseau.
  Future<Fetched<List<FieldPractitioner>>?> practitioners() async {
    final json = await _fetch('terrain/praticiens', 'praticiens.json');
    if (json == null) return null;
    return Fetched([
      for (final p in json.value as List)
        FieldPractitioner.fromJson(p as Map<String, dynamic>),
    ], fromCopy: json.fromCopy);
  }

  /// Listes du formulaire ; null si jamais reçues et hors réseau.
  Future<FieldReferentials?> referentials() async {
    final json = await _fetch(
      'dossiers-terrain/referentiels',
      'referentiels.json',
    );
    return json == null
        ? null
        : FieldReferentials.fromJson(json.value as Map<String, dynamic>);
  }

  /// Envoie le dossier : création (une seule fois), pièces pas encore reçues, soumission.
  /// Chaque étape réussie est gardée : un envoi coupé reprend où il s'est arrêté. Renvoie
  /// le code du dossier soumis ; le brouillon est alors effacé du téléphone.
  Future<String> send(FieldDraft draft) async {
    if (draft.missingPieces.isNotEmpty) {
      throw const FieldException(
        'missing_pieces',
        'Ajoutez la pièce d’identité et la photo du praticien avant l’envoi.',
      );
    }
    if (draft.code == null) {
      final created = _object(
        await _check(
          await _http.sendJson('POST', 'dossiers-terrain', draft.fields),
        ),
      );
      draft.code = created['code'] as String;
      await store.saveDraft(draft);
    }
    final code = Uri.encodeComponent(draft.code!);
    for (final type in fieldPieceLabels.keys) {
      if (!draft.pieces.contains(type) || draft.sentPieces.contains(type)) {
        continue;
      }
      final bytes = await store.piece(draft, type);
      if (bytes == null) continue;
      await _check(
        await _http.send(
          'POST',
          'dossiers-terrain/$code/pieces/$type',
          body: bytes,
          contentType: 'image/jpeg',
          // 3G : 500 Ko à 400 kbit/s ≈ 10 s, marge pour un réseau chargé
          timeout: const Duration(seconds: 90),
        ),
      );
      draft.sentPieces.add(type);
      await store.saveDraft(draft);
    }
    final receipt = _object(
      await _check(
        await _http.send('POST', 'dossiers-terrain/$code/soumission'),
      ),
    );
    await store.removeDraft(draft);
    return receipt['code'] as String? ?? draft.code!;
  }

  Future<Fetched<Object?>?> _fetch(String path, String copy) async {
    try {
      final json = PractitionerHttp.decode(
        await _check(await _http.send('GET', path)),
      );
      await store.keep(copy, json);
      return Fetched(json, fromCopy: false);
    } on SignedOutException {
      rethrow;
    } on FieldException catch (e) {
      if (e.definitive) rethrow;
    } on Exception {
      // Réseau absent ou coupé : copie gardée ci-dessous
    }
    final kept = await store.cached(copy);
    return kept == null ? null : Fetched(kept, fromCopy: true);
  }

  static Map<String, dynamic> _object(http.Response response) =>
      PractitionerHttp.decode(response) as Map<String, dynamic>;

  static Future<http.Response> _check(http.Response response) async {
    if (PractitionerHttp.ok(response)) return response;
    String? code;
    String? message;
    try {
      final body = PractitionerHttp.decode(response);
      if (body is Map) {
        code = body['error'] as String?;
        message = body['message'] as String?;
      }
    } on FormatException {
      // Réponse sans corps JSON (passerelle, coupure) : message générique ci-dessous
    }
    final status = response.statusCode;
    if (status == 403) {
      throw FieldException(
        code ?? 'forbidden',
        message ??
            'Ce compte ne peut pas agir sur le terrain : connectez-vous avec un compte '
                'd’agent préfectoral et son second facteur.',
      );
    }
    if (status >= 500 || status == 408 || status == 429) {
      throw FieldException(
        code ?? 'http_$status',
        'Le serveur n’a pas pu traiter la demande. Le dossier reste sur le téléphone ; '
        'réessayez dans un moment.',
        definitive: false,
      );
    }
    throw FieldException(
      code ?? 'http_$status',
      message ?? 'La demande a été refusée par le serveur.',
    );
  }
}
