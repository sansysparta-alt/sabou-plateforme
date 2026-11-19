// Studio SABOU mobile (US-067, UC-21) : mêmes routes et mêmes règles que le Studio web
// (US-060 à US-063, apps/api/src/treatments/studio.controller.ts). Les contrôles faits ici ne
// servent qu'à dire l'erreur tout de suite ; l'API et la base restent seules juges.
import 'package:http/http.dart' as http;

import '../dossier/practitioner_http.dart';
import '../dossier/session.dart';

/// Bornes de packages/types/src/treatments.ts.
const treatmentTitleMax = 150;
const treatmentSectionMax = 4000;
const treatmentPartMax = 100;
const treatmentPlantsMax = 15;
const cycleDaysMax = 365;
const cycleDosesMax = 10;

/// Niveaux de visibilité (R-REC-10), dans l'ordre d'affichage.
const visibilities = ['publique', 'restreinte', 'privee'];

class CodeLabel {
  const CodeLabel(this.code, this.label);
  final String code;
  final String label;
}

class StudioPlant {
  const StudioPlant(this.code, this.name, this.scientificName, this.validated);

  factory StudioPlant.fromJson(Map<String, dynamic> p) => StudioPlant(
    p['code'] as String,
    p['nomFr'] as String,
    p['nomScientifique'] as String?,
    p['validee'] as bool,
  );

  final String code;
  final String name;

  /// Absent tant qu'une plante proposée par un praticien n'est pas complétée (US-054).
  final String? scientificName;

  /// Fiche validée par le Comité ; sinon le traitement attend sa validation.
  final bool validated;
}

class StudioSection {
  const StudioSection(this.code, this.label, this.required);
  final String code;
  final String label;
  final bool required;
}

/// Listes du formulaire (GET /api/praticien/studio/referentiels).
class StudioReferentials {
  const StudioReferentials({
    required this.diseases,
    required this.plants,
    required this.sections,
    required this.contraindications,
  });

  factory StudioReferentials.fromJson(Map<String, dynamic> json) =>
      StudioReferentials(
        diseases: [
          for (final m in json['maladies'] as List)
            CodeLabel(m['code'] as String, m['nomFr'] as String),
        ],
        plants: [
          for (final p in json['plantes'] as List)
            StudioPlant.fromJson(p as Map<String, dynamic>),
        ],
        sections: [
          for (final s in json['sections'] as List)
            StudioSection(
              s['code'] as String,
              s['libelleFr'] as String,
              s['obligatoire'] as bool,
            ),
        ],
        contraindications: [
          for (final c in json['contreIndications'] as List)
            CodeLabel(c['code'] as String, c['libelleFr'] as String),
        ],
      );

  /// Mêmes listes, avec une plante de plus (proposée à l'instant, US-054).
  StudioReferentials withPlant(StudioPlant plant) => StudioReferentials(
    diseases: diseases,
    plants: [...plants, plant],
    sections: sections,
    contraindications: contraindications,
  );

  final List<CodeLabel> diseases;
  final List<StudioPlant> plants;
  final List<StudioSection> sections;
  final List<CodeLabel> contraindications;
}

/// Un traitement de la liste « Mes traitements ».
class TreatmentSummary {
  const TreatmentSummary({
    required this.code,
    required this.title,
    required this.disease,
    required this.status,
    required this.waitingReason,
    required this.modifiedAt,
  });

  factory TreatmentSummary.fromJson(Map<String, dynamic> json) =>
      TreatmentSummary(
        code: json['code'] as String,
        title: json['titreFr'] as String,
        disease: CodeLabel(
          (json['maladie'] as Map)['code'] as String,
          (json['maladie'] as Map)['nomFr'] as String,
        ),
        status: json['statut'] as String,
        waitingReason: json['attenteRaison'] as String?,
        modifiedAt: json['modifieLe'] as String,
      );

  final String code;
  final String title;
  final CodeLabel disease;

  /// brouillon, soumise, transmise, expertisee, certifiee, suspendue, retiree (R-REC-07).
  final String status;

  /// Raison d'un traitement resté « expertisé » (US-046) : quota ou contenu.
  final String? waitingReason;

  /// Date de lecture, renvoyée à l'enregistrement (contrôle des modifications concurrentes).
  final String modifiedAt;

  bool get isDraft => status == 'brouillon';
}

class TreatmentPlant {
  const TreatmentPlant(this.code, this.name, this.part, this.validated);
  final String code;
  final String name;
  final String? part;
  final bool validated;
}

class TreatmentSection {
  const TreatmentSection(this.type, this.textFr, this.textEn);
  final String type;

  /// Vide (null) tant que seule la voix du praticien dit la section (US-081).
  final String? textFr;
  final String? textEn;
}

/// US-081 : voix en vigueur du praticien pour une section ou le nom d'une plante.
class PractitionerVoice {
  const PractitionerVoice({
    required this.target,
    required this.object,
    required this.state,
    required this.durationSec,
  });

  factory PractitionerVoice.fromJson(Map<String, dynamic> v) =>
      PractitionerVoice(
        target: v['cible'] as String,
        object: v['objet'] as String,
        state: v['etat'] as String,
        durationSec: (v['dureeSec'] as num?)?.toDouble(),
      );

  /// « section » ou « plante ».
  final String target;
  final String object;

  /// en_attente, en_cours, traitee ou echec (traitement du son par le serveur).
  final String state;
  final double? durationSec;
}

/// Un traitement complet (GET /api/praticien/traitements/:code).
class TreatmentDetail extends TreatmentSummary {
  const TreatmentDetail({
    required super.code,
    required super.title,
    required super.disease,
    required super.status,
    required super.waitingReason,
    required super.modifiedAt,
    required this.titleEn,
    required this.cycleDays,
    required this.dosesPerDay,
    required this.pauseDays,
    required this.plants,
    required this.sections,
    this.voices = const [],
    required this.contraindications,
    required this.visibility,
    required this.consentedAt,
    required this.gaps,
    required this.dossier,
    required this.lastMotif,
  });

  factory TreatmentDetail.fromJson(Map<String, dynamic> json) {
    final summary = TreatmentSummary.fromJson(json);
    return TreatmentDetail(
      code: summary.code,
      title: summary.title,
      disease: summary.disease,
      status: summary.status,
      waitingReason: summary.waitingReason,
      modifiedAt: summary.modifiedAt,
      titleEn: json['titreEn'] as String?,
      cycleDays: json['cycleDureeJours'] as int?,
      dosesPerDay: json['cyclePrisesParJour'] as int?,
      pauseDays: json['cyclePauseJours'] as int?,
      plants: [
        for (final p in json['plantes'] as List)
          TreatmentPlant(
            p['plante'] as String,
            p['nomFr'] as String,
            p['partie'] as String?,
            p['validee'] as bool,
          ),
      ],
      voices: [
        for (final v in (json['voix'] as List?) ?? const [])
          PractitionerVoice.fromJson(v as Map<String, dynamic>),
      ],
      sections: [
        for (final s in json['sections'] as List)
          TreatmentSection(
            s['type'] as String,
            s['texteFr'] as String?,
            s['texteEn'] as String?,
          ),
      ],
      contraindications: [
        for (final c in json['contreIndications'] as List)
          CodeLabel(c['code'] as String, c['libelleFr'] as String),
      ],
      visibility: json['visibilite'] as String?,
      consentedAt: json['consentementLe'] as String?,
      gaps: [for (final g in json['manques'] as List) g as String],
      dossier: json['dossier'] as String?,
      lastMotif: json['dernierMotif'] as String?,
    );
  }

  final String? titleEn;
  final int? cycleDays;
  final int? dosesPerDay;
  final int? pauseDays;
  final List<TreatmentPlant> plants;
  final List<TreatmentSection> sections;

  /// US-081 : voix en vigueur du praticien (section ou nom de plante).
  final List<PractitionerVoice> voices;
  final List<CodeLabel> contraindications;
  final String? visibility;
  final String? consentedAt;

  /// Ce qui manque pour soumettre : consentement, plante, cycle, sections.
  final List<String> gaps;

  /// Dossier de certification auquel le traitement est joint (R-REC-08).
  final String? dossier;

  /// Dernier motif de renvoi (R-REC-07). Les annotations du Comité restent internes
  /// (§2.54, décision du maître d'œuvre du 18 novembre 2026).
  final String? lastMotif;
}

/// Saisie envoyée à l'API (treatmentFieldsSchema).
class TreatmentFields {
  const TreatmentFields({
    required this.disease,
    required this.titleFr,
    this.titleEn = '',
    this.cycleDays,
    this.dosesPerDay,
    this.pauseDays,
    this.plants = const [],
    this.sections = const [],
    this.contraindications = const [],
    this.consent = false,
    this.visibility,
  });

  final String disease;
  final String titleFr;
  final String titleEn;
  final int? cycleDays;
  final int? dosesPerDay;
  final int? pauseDays;

  /// Plantes dans l'ordre de la préparation : code et partie utilisée.
  final List<({String plant, String part})> plants;

  /// Sections rédigées seulement (texte français non vide).
  final List<({String type, String fr, String en})> sections;
  final List<String> contraindications;
  final bool consent;
  final String? visibility;

  Map<String, Object?> toJson() => {
    'maladie': disease,
    'titreFr': titleFr,
    'titreEn': titleEn,
    'cycleDureeJours': cycleDays,
    'cyclePrisesParJour': dosesPerDay,
    'cyclePauseJours': pauseDays,
    'plantes': [
      for (final p in plants) {'plante': p.plant, 'partie': p.part},
    ],
    'sections': [
      for (final s in sections)
        {'type': s.type, 'texteFr': s.fr, 'texteEn': s.en},
    ],
    'contreIndications': contraindications,
    'consentement': consent,
    'visibilite': consent ? visibility : null,
  };
}

/// Refus expliqué par l'API (message en français, à afficher tel quel).
class StudioException implements Exception {
  const StudioException(this.code, this.message, {this.gaps = const []});
  final String code;
  final String message;

  /// Ce qui manque pour soumettre (code « incomplete »).
  final List<String> gaps;

  @override
  String toString() => message;
}

class StudioApi {
  StudioApi({
    required Uri baseUrl,
    required PractitionerSession session,
    http.Client? client,
  }) : _http = PractitionerHttp(
         baseUrl: baseUrl,
         session: session,
         client: client,
       );

  final PractitionerHttp _http;

  Future<StudioReferentials> referentials() async =>
      StudioReferentials.fromJson(
        _object(await _check(await _http.send('GET', 'studio/referentiels'))),
      );

  Future<List<TreatmentSummary>> list() async {
    final body = PractitionerHttp.decode(
      await _check(await _http.send('GET', 'traitements')),
    );
    return [
      for (final t in body as List)
        TreatmentSummary.fromJson(t as Map<String, dynamic>),
    ];
  }

  Future<TreatmentDetail> detail(String code) async => _detail(
    await _http.send('GET', 'traitements/${Uri.encodeComponent(code)}'),
  );

  Future<TreatmentDetail> create(TreatmentFields fields) async =>
      _detail(await _http.sendJson('POST', 'traitements', fields.toJson()));

  /// [readAt] : date de modification lue ; l'API refuse si le traitement a changé depuis.
  Future<TreatmentDetail> update(
    String code,
    String readAt,
    TreatmentFields fields,
  ) async => _detail(
    await _http.sendJson('PUT', 'traitements/${Uri.encodeComponent(code)}', {
      'vueLe': readAt,
      'fields': fields.toJson(),
    }),
  );

  /// US-054 : propose une plante qui manque au Dictionnaire ; créée « en revue ».
  Future<StudioPlant> proposePlant({
    required String nameFr,
    String scientificName = '',
    String family = '',
    String description = '',
  }) async => StudioPlant.fromJson(
    _object(
      await _check(
        await _http.sendJson('POST', 'plantes', {
          'nomFr': nameFr,
          'nomScientifique': scientificName,
          'famille': family,
          'description': description,
        }),
      ),
    ),
  );

  Future<TreatmentDetail> submit(String code) async => _detail(
    await _http.send(
      'POST',
      'traitements/${Uri.encodeComponent(code)}/soumission',
    ),
  );

  String _voicePath(String code, String target, String object) =>
      'traitements/${Uri.encodeComponent(code)}/voix/'
      '${Uri.encodeComponent(target)}/${Uri.encodeComponent(object)}';

  /// US-081 : envoie une voix ; [clientKey] rend l'envoi rejouable sans doublon. Délai large :
  /// jusqu'à 3 Mo sur un réseau faible.
  Future<List<PractitionerVoice>> uploadVoice({
    required String code,
    required String target,
    required String object,
    required String clientKey,
    required List<int> audio,
    required String contentType,
  }) async => _voices(
    await _check(
      await _http.send(
        'PUT',
        '${_voicePath(code, target, object)}?cle=${Uri.encodeQueryComponent(clientKey)}',
        body: audio,
        contentType: contentType,
        timeout: const Duration(minutes: 3),
      ),
    ),
  );

  Future<List<PractitionerVoice>> removeVoice(
    String code,
    String target,
    String object,
  ) async => _voices(
    await _check(await _http.send('DELETE', _voicePath(code, target, object))),
  );

  /// Voix traitée par le serveur (réécoute après l'envoi).
  Future<List<int>> voiceAudio(
    String code,
    String target,
    String object,
  ) async => (await _check(
    await _http.send('GET', '${_voicePath(code, target, object)}/audio'),
  )).bodyBytes;

  static List<PractitionerVoice> _voices(http.Response response) => [
    for (final v in PractitionerHttp.decode(response) as List)
      PractitionerVoice.fromJson(v as Map<String, dynamic>),
  ];

  Future<TreatmentDetail> _detail(http.Response response) async =>
      TreatmentDetail.fromJson(_object(await _check(response)));

  static Map<String, dynamic> _object(http.Response response) =>
      PractitionerHttp.decode(response) as Map<String, dynamic>;

  static Future<http.Response> _check(http.Response response) async {
    if (PractitionerHttp.ok(response)) return response;
    throw _error(response);
  }

  static StudioException _error(http.Response response) {
    try {
      final body = PractitionerHttp.decode(response);
      if (body is Map) {
        final raw = body['message'];
        final message = raw is List && raw.isNotEmpty ? raw.first : raw;
        if (message is String && message.isNotEmpty) {
          return StudioException(
            body['error'] as String? ?? 'error',
            message,
            gaps: [
              for (final g in (body['gaps'] as List?) ?? const []) g as String,
            ],
          );
        }
      }
    } on FormatException {
      // Réponse sans corps JSON (passerelle, coupure) : message générique ci-dessous
    }
    return StudioException(
      'http_${response.statusCode}',
      response.statusCode == 403 ? 'Le Studio est réservé aux praticiens.' : 'Le serveur n’a pas pu traiter la demande. Réessayez dans un moment.',
    );
  }
}
