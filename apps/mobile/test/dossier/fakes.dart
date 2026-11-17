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

/// Jeton d'accès simulé, au format JWT, portant les rôles du compte (claim `roles`, comme
/// le client Keycloak `sabou-mobile`) ; [id] le distingue des autres jetons.
String fakeAccess(String id, [List<String> roles = const ['praticien']]) {
  String part(Object value) =>
      base64Url.encode(utf8.encode(jsonEncode(value))).replaceAll('=', '');
  return '${part({'alg': 'RS256'})}.${part({'jti': id, 'roles': roles})}.signature';
}

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
    accessToken: fakeAccess('acces-1'),
    refreshToken: 'rafraichissement-1',
    expiresAt: DateTime.now().add(const Duration(minutes: 5)),
  );
  int calls = 0;
  String? lastLoginHint;

  @override
  Future<Tokens?> login({String? loginHint}) async {
    calls++;
    lastLoginHint = loginHint;
    return next;
  }
}

/// Serveur simulé : Keycloak (jeton, révocation) et API du praticien.
class FakeServer {
  final requests = <http.Request>[];
  int refreshCount = 0;
  bool keycloakRejectsRefresh = false;
  bool offline = false;

  /// Lenteur simulée des réponses de l'API (3G) ; Keycloak répond sans attendre.
  Duration delay = Duration.zero;

  /// Jetons d'accès que l'API accepte (les autres reçoivent 401).
  final validAccess = <String>{fakeAccess('acces-1')};

  /// Rôles portés par les jetons rafraîchis.
  List<String> roles = const ['praticien'];

  // État du dossier
  Map<String, Object?>? profile;
  final pieces = <Map<String, Object?>>[];
  final uploads = <String, Uint8List>{};
  bool submitted = false;

  // État du Studio (US-067) : traitements du praticien, par code
  final treatments = <String, Map<String, Object?>>{};
  int _treatmentSeq = 1000;
  int _clock = 0;

  /// Prochaine réponse du Studio refusée avec ce statut et ce corps (règles de la base).
  (int, Map<String, Object?>)? nextStudioRefusal;

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
      final access = fakeAccess('acces-${refreshCount + 1}', roles);
      validAccess.add(access);
      return _json(200, {
        'access_token': access,
        'refresh_token': 'rafraichissement-${refreshCount + 1}',
        'expires_in': 300,
      });
    }
    if (url == '$oidc/revoke') return http.Response('', 200);
    if (delay > Duration.zero) await Future<void>.delayed(delay);

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
    final studio = studioRoute(request, path);
    if (studio != null) return studio;
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

  static const studioReferentials = {
    'maladies': [
      {'code': 'MAL-0001', 'nomFr': 'Paludisme'},
      {'code': 'MAL-0002', 'nomFr': 'Diarrhée'},
    ],
    'plantes': [
      {
        'code': 'PLA-0001',
        'nomFr': 'Kinkéliba',
        'nomScientifique': 'Combretum micranthum',
        'validee': true,
      },
      {
        'code': 'PLA-0002',
        'nomFr': 'Neem',
        'nomScientifique': 'Azadirachta indica',
        'validee': true,
      },
      {
        'code': 'PLA-0003',
        'nomFr': 'Quinquéliba rouge',
        'nomScientifique': 'Combretum glutinosum',
        'validee': false,
      },
    ],
    'sections': [
      {'code': 'preparation', 'libelleFr': 'Préparation', 'obligatoire': true},
      {
        'code': 'consommation',
        'libelleFr': 'Consommation',
        'obligatoire': true,
      },
      {'code': 'cycle', 'libelleFr': 'Cycle', 'obligatoire': true},
      {
        'code': 'effets_indesirables',
        'libelleFr': 'Effets indésirables',
        'obligatoire': true,
      },
      {
        'code': 'conservation',
        'libelleFr': 'Conservation',
        'obligatoire': false,
      },
    ],
    'contreIndications': [
      {'code': 'grossesse', 'libelleFr': 'Femmes enceintes'},
      {'code': 'enfant_moins_5', 'libelleFr': 'Enfants de moins de 5 ans'},
    ],
  };

  static const _requiredSections = [
    'preparation',
    'consommation',
    'cycle',
    'effets_indesirables',
  ];

  static String? _blank(Object? value) =>
      value is String && value.isNotEmpty ? value : null;

  static List<Map<String, Object?>> _ref(String key) =>
      (studioReferentials[key]! as List).cast<Map<String, Object?>>();

  /// Traitement tel que l'API le renvoie, à partir de la saisie reçue.
  Map<String, Object?> _detail(
    String code,
    Map<String, Object?> fields, {
    String statut = 'brouillon',
    String? motif,
    String? attente,
  }) {
    final plants = (fields['plantes']! as List).cast<Map<String, Object?>>();
    final sections = (fields['sections']! as List).cast<Map<String, Object?>>();
    Map<String, Object?> plant(Object? code) =>
        _ref('plantes').firstWhere((r) => r['code'] == code);
    final consent = fields['consentement'] == true;
    return {
      'code': code,
      'titreFr': fields['titreFr'],
      'titreEn': _blank(fields['titreEn']),
      'maladie': _ref('maladies')
          .firstWhere((m) => m['code'] == fields['maladie']),
      'statut': statut,
      'attenteRaison': attente,
      'modifieLe':
          '2026-11-18T10:00:00.${(_clock++).toString().padLeft(3, '0')}Z',
      'cycleDureeJours': fields['cycleDureeJours'],
      'cyclePrisesParJour': fields['cyclePrisesParJour'],
      'cyclePauseJours': fields['cyclePauseJours'],
      'plantes': [
        for (final p in plants)
          {
            'plante': p['plante'],
            'nomFr': plant(p['plante'])['nomFr'],
            'partie': _blank(p['partie']),
            'validee': plant(p['plante'])['validee'],
          },
      ],
      'sections': [
        for (final s in sections)
          {
            'type': s['type'],
            'texteFr': s['texteFr'],
            'texteEn': _blank(s['texteEn']),
          },
      ],
      'contreIndications': [
        for (final c in (fields['contreIndications'] as List? ?? const []))
          _ref('contreIndications').firstWhere((r) => r['code'] == c),
      ],
      'visibilite': consent ? fields['visibilite'] : null,
      'consentementLe': consent ? '2026-11-18T10:00:00.000Z' : null,
      'manques': [
        if (!consent) 'consentement',
        if (plants.isEmpty) 'plante',
        if (fields['cycleDureeJours'] == null ||
            fields['cyclePrisesParJour'] == null)
          'cycle',
        if (!_requiredSections.every(
          (r) => sections.any((s) => s['type'] == r),
        ))
          'sections',
      ],
      'dossier': null,
      'dernierMotif': motif,
    };
  }

  /// Ajoute un traitement existant (avec sa saisie) ; renvoie son code.
  String seedTreatment(
    Map<String, Object?> fields, {
    String statut = 'brouillon',
    String? motif,
    String? attente,
  }) {
    final code = 'REC-${_treatmentSeq++}';
    treatments[code] = _detail(
      code,
      fields,
      statut: statut,
      motif: motif,
      attente: attente,
    );
    return code;
  }

  http.Response? studioRoute(http.Request request, String path) {
    final refusal = nextStudioRefusal;
    if (refusal != null &&
        (path == 'traitements' || path.startsWith('traitements/'))) {
      nextStudioRefusal = null;
      return _json(refusal.$1, refusal.$2);
    }
    if (request.method == 'GET' && path == 'studio/referentiels') {
      return _json(200, studioReferentials);
    }
    if (request.method == 'GET' && path == 'traitements') {
      const summary = [
        'code',
        'titreFr',
        'maladie',
        'statut',
        'attenteRaison',
        'modifieLe',
      ];
      return _json(200, [
        for (final t in treatments.values) {for (final k in summary) k: t[k]},
      ]);
    }
    if (request.method == 'POST' && path == 'traitements') {
      final code = seedTreatment(
        jsonDecode(request.body) as Map<String, Object?>,
      );
      return _json(200, treatments[code]!);
    }
    final match = RegExp(r'^traitements/(REC-\d+)(/soumission)?$')
        .firstMatch(path);
    if (match == null) return null;
    final code = match.group(1)!;
    final current = treatments[code];
    if (current == null) {
      return _json(404, {
        'error': 'not_found',
        'message': 'Traitement introuvable.',
      });
    }
    if (request.method == 'GET' && match.group(2) == null) {
      return _json(200, current);
    }
    if (current['statut'] != 'brouillon') {
      return _json(409, {
        'error': 'locked',
        'message': 'Ce traitement a été soumis : il ne se modifie plus.',
      });
    }
    if (request.method == 'PUT') {
      final body = jsonDecode(request.body) as Map<String, Object?>;
      if (body['vueLe'] != current['modifieLe']) {
        return _json(409, {
          'error': 'stale',
          'message': 'Ce traitement a été modifié entre-temps. Rechargez-le avant de l’enregistrer.',
        });
      }
      treatments[code] = _detail(
        code,
        body['fields']! as Map<String, Object?>,
        motif: current['dernierMotif'] as String?,
      );
      return _json(200, treatments[code]!);
    }
    if (request.method == 'POST' && match.group(2) != null) {
      final gaps = current['manques']! as List;
      if (gaps.isNotEmpty) {
        return _json(422, {
          'error': 'incomplete',
          'message': 'Traitement incomplet.',
          'gaps': gaps,
        });
      }
      treatments[code] = {
        ...current,
        'statut': 'soumise',
        'dossier': 'DS-2001',
      };
      return _json(200, treatments[code]!);
    }
    return null;
  }
}
