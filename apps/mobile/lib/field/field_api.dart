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

/// US-083 : ligne de l'agenda (GET /api/terrain/visites).
class AgendaItem {
  const AgendaItem({
    required this.planned,
    required this.dossier,
    required this.visit,
    required this.practitioner,
    required this.subPrefecture,
    required this.prefecture,
    required this.when,
    required this.since,
  });

  factory AgendaItem.fromJson(Map<String, dynamic> json) => AgendaItem(
    planned: json['categorie'] == 'planifiee',
    dossier: json['dossier'] as String,
    visit: json['visite'] as int?,
    practitioner: json['praticien'] as String,
    subPrefecture: json['sousPrefecture'] as String?,
    prefecture: json['prefecture'] as String,
    when: json['prevueLe'] as String?,
    since: json['entreeLe'] as String,
  );

  /// Visite planifiée ; sinon dossier à l'étape 2 encore sans visite.
  final bool planned;
  final String dossier;
  final int? visit;
  final String practitioner;
  final String? subPrefecture;
  final String prefecture;

  /// Heure de Conakry, 2026-11-23T09:30 (visite planifiée).
  final String? when;

  /// Entrée du dossier à l'étape 2, 2026-11-14.
  final String since;

  /// Localité, seule donnée passée à l'application de cartes (jamais le nom du praticien).
  String get locality => [?subPrefecture, prefecture, 'Guinée'].join(', ');
}

/// US-083 : compte rendu de visite signé sur le téléphone (attestation cochée), figé, en
/// attente d'envoi. L'heure d'attestation est celle du téléphone ; le serveur garde à côté
/// son heure de réception, qui fait foi, et calcule l'empreinte SHA3-256.
class FieldReport {
  FieldReport({
    required this.dossier,
    required this.visit,
    required this.practitioner,
    required this.date,
    required this.opinion,
    required this.notes,
    required this.attestedAt,
    this.hasPhoto = false,
    this.tried = false,
    this.reportSent = false,
    this.error,
  });

  factory FieldReport.fromJson(Map<String, dynamic> json) => FieldReport(
    dossier: json['dossier'] as String,
    visit: json['visite'] as int,
    practitioner: json['praticien'] as String,
    date: json['realiseeLe'] as String,
    opinion: json['avis'] as String,
    notes: json['constats'] as String,
    attestedAt: DateTime.parse(json['attesteLe'] as String),
    hasPhoto: json['photo'] as bool? ?? false,
    tried: json['essaye'] as bool? ?? false,
    reportSent: json['envoye'] as bool? ?? false,
    error: json['erreur'] as String?,
  );

  final String dossier;
  final int visit;
  final String practitioner;

  /// Date de la visite (heure de Conakry) : 2026-11-20.
  final String date;

  /// favorable, reserve, defavorable.
  final String opinion;
  final String notes;
  final DateTime attestedAt;
  bool hasPhoto;

  /// Un envoi a été tenté (sa réponse a pu se perdre).
  bool tried;
  bool reportSent;

  /// Refus définitif de l'API, montré à l'agent.
  String? error;

  /// Corps de POST /api/dossiers/:code/visite/compte-rendu.
  Map<String, Object?> get body => {
    'visite': visit,
    'realiseeLe': date,
    'avis': opinion,
    'constats': notes,
    'attestation': true,
    'attesteLe': attestedAt.toUtc().toIso8601String(),
  };

  Map<String, Object?> toJson() => {
    'dossier': dossier,
    'visite': visit,
    'praticien': practitioner,
    'realiseeLe': date,
    'avis': opinion,
    'constats': notes,
    'attesteLe': attestedAt.toUtc().toIso8601String(),
    'photo': hasPhoto,
    'essaye': tried,
    'envoye': reportSent,
    'erreur': error,
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

  // US-083 : comptes rendus signés en attente d'envoi, et photo de la fiche de chacun
  Future<List<FieldReport>> reports() async => [
    for (final r in (await _safe('comptes-rendus.json')) as List? ?? const [])
      FieldReport.fromJson(r as Map<String, dynamic>),
  ];

  Future<void> saveReport(FieldReport report) async {
    final all = await reports();
    final i = all.indexWhere((r) => r.visit == report.visit);
    i < 0 ? all.add(report) : all[i] = report;
    await files.writeJson('comptes-rendus.json', [
      for (final r in all) r.toJson(),
    ]);
  }

  Future<void> removeReport(FieldReport report) async {
    await files.writeJson('comptes-rendus.json', [
      for (final r in await reports())
        if (r.visit != report.visit) r.toJson(),
    ]);
    await files.delete(_reportPhotoName(report));
  }

  Future<void> saveReportPhoto(FieldReport report, Uint8List jpeg) =>
      files.write(_reportPhotoName(report), jpeg);

  Future<Uint8List?> reportPhoto(FieldReport report) async {
    final bytes = await files.read(_reportPhotoName(report));
    return bytes == null ? null : Uint8List.fromList(bytes);
  }

  static String _reportPhotoName(FieldReport report) =>
      'fiche-visite-${report.visit}.bin';

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

  /// US-083 : agenda de l'agent (visites planifiées, dossiers à planifier) ; copie gardée
  /// pour la tournée sans réseau ; null si jamais reçu et hors réseau.
  Future<Fetched<List<AgendaItem>>?> agenda() async {
    final json = await _fetch('terrain/visites', 'agenda.json');
    if (json == null) return null;
    return Fetched([
      for (final v in json.value as List)
        AgendaItem.fromJson(v as Map<String, dynamic>),
    ], fromCopy: json.fromCopy);
  }

  /// US-083 : planifie (ou replanifie) la visite d'un dossier ; [when] : heure de Conakry,
  /// telle que choisie (2026-11-23T09:30). En ligne seulement : la base contrôle la date.
  Future<void> plan(String dossier, String when) async {
    await check(
      await _http.sendJson(
        'POST',
        'dossiers/${Uri.encodeComponent(dossier)}/visite',
        {'prevueLe': when},
      ),
    );
  }

  /// US-083 : envoie un compte rendu signé sur le téléphone, puis la photo de la fiche.
  /// Chaque étape réussie est gardée ; un envoi dont la réponse s'est perdue est reconnu au
  /// nouvel essai (visite déjà enregistrée, photo déjà jointe) sans doublon.
  Future<void> sendReport(FieldReport report) async {
    final dossier = Uri.encodeComponent(report.dossier);
    if (!report.reportSent) {
      final wasTried = report.tried;
      report.tried = true;
      await store.saveReport(report);
      try {
        await check(
          await _http.sendJson(
            'POST',
            'dossiers/$dossier/visite/compte-rendu',
            report.body,
          ),
        );
      } on FieldException catch (e) {
        // Premier envoi arrivé, réponse perdue : la visite n'est plus « planifiée »
        if (!(wasTried && e.code == 'stale')) rethrow;
      }
      report.reportSent = true;
      await store.saveReport(report);
    }
    if (report.hasPhoto) {
      final jpeg = await store.reportPhoto(report);
      if (jpeg != null) {
        try {
          await check(
            await _http.send(
              'POST',
              'dossiers/$dossier/visite/${report.visit}/photo',
              body: jpeg,
              contentType: 'image/jpeg',
              timeout: const Duration(seconds: 90),
            ),
          );
        } on FieldException catch (e) {
          if (e.code != 'photo_exists') rethrow;
        }
      }
    }
    await store.removeReport(report);
  }

  /// Envoie les comptes rendus en attente ; renvoie ceux qui restent sur le téléphone.
  /// Une absence de réseau arrête l'envoi sans erreur.
  Future<List<FieldReport>> sendPendingReports() async {
    for (final report in await store.reports()) {
      try {
        await sendReport(report);
      } on SignedOutException {
        rethrow;
      } on FieldException catch (e) {
        if (!e.definitive) break;
        report.error = e.message;
        await store.saveReport(report);
      } on Exception {
        break;
      }
    }
    return store.reports();
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
        await check(
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
      await check(
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
      await check(
        await _http.send('POST', 'dossiers-terrain/$code/soumission'),
      ),
    );
    await store.removeDraft(draft);
    return receipt['code'] as String? ?? draft.code!;
  }

  Future<Fetched<Object?>?> _fetch(String path, String copy) async {
    try {
      final json = PractitionerHttp.decode(
        await check(await _http.send('GET', path)),
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

  /// Réponse 2xx, sinon [FieldException] (message de l'API, ou message générique).
  static Future<http.Response> check(http.Response response) async {
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
