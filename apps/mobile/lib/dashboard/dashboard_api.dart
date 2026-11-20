// Tableau de bord du praticien (US-090, CdC §6.6 ; décisions du maître d'œuvre du
// 20 novembre 2026, §2.90) : ses traitements par état, la frise de certification de son
// dernier dossier et son certificat. Route /api/praticien/tableau-de-bord, jeton de
// l'application ; la base calcule tout (fonction tableau_de_bord(), règles RLS).
// Vues, écoutes, réputation et revenus de la boutique viendront avec les récits qui créent
// ces données (site public, témoignages, boutique).
import 'package:http/http.dart' as http;

import '../dossier/practitioner_http.dart';
import '../dossier/session.dart';

/// État d'une étape de la frise.
enum CertificationStepState { passed, current, stopped, upcoming }

CertificationStepState _state(String value) => switch (value) {
  'franchie' => CertificationStepState.passed,
  'en_cours' => CertificationStepState.current,
  'arretee' => CertificationStepState.stopped,
  _ => CertificationStepState.upcoming,
};

class CertificationStep {
  const CertificationStep(this.number, this.state, this.at);

  /// 1 à 6 (R-CER-01).
  final int number;
  final CertificationStepState state;

  /// Dernière arrivée dans l'étape ; null pour une étape à venir.
  final DateTime? at;
}

class DashboardDossier {
  const DashboardDossier(this.code, this.status, this.step, this.steps);

  final String code;

  /// en_cours, approuve, rejete_definitif, abandonne.
  final String status;
  final int step;
  final List<CertificationStep> steps;
}

class DashboardCertificate {
  const DashboardCertificate(this.number, this.issuedOn, this.expiresOn);
  final String number;

  /// Dates du calendrier, AAAA-MM-JJ.
  final String issuedOn;
  final String expiresOn;
}

class PractitionerDashboard {
  const PractitionerDashboard({
    required this.certified,
    required this.inReview,
    required this.drafts,
    required this.suspended,
    required this.dossier,
    required this.certificate,
  });

  factory PractitionerDashboard.fromJson(Map<String, dynamic> json) {
    final t = json['traitements'] as Map<String, dynamic>;
    final d = json['dossier'] as Map<String, dynamic>?;
    final c = json['certificat'] as Map<String, dynamic>?;
    return PractitionerDashboard(
      certified: t['certifies'] as int,
      inReview: t['enExamen'] as int,
      drafts: t['brouillons'] as int,
      suspended: t['suspendus'] as int,
      dossier: d == null
          ? null
          : DashboardDossier(
              d['code'] as String,
              d['statut'] as String,
              d['etape'] as int,
              [
                for (final s in d['etapes'] as List)
                  CertificationStep(
                    (s as Map)['etape'] as int,
                    _state(s['etat'] as String),
                    s['le'] == null ? null : DateTime.parse(s['le'] as String),
                  ),
              ],
            ),
      certificate: c == null
          ? null
          : DashboardCertificate(
              c['numero'] as String,
              c['emisLe'] as String,
              c['expireLe'] as String,
            ),
    );
  }

  /// Traitements par état.
  final int certified;
  final int inReview;
  final int drafts;
  final int suspended;
  final DashboardDossier? dossier;
  final DashboardCertificate? certificate;
}

class DashboardException implements Exception {
  const DashboardException(this.message);
  final String message;

  @override
  String toString() => message;
}

class DashboardApi {
  DashboardApi({
    required Uri baseUrl,
    required PractitionerSession session,
    http.Client? client,
  }) : _http = PractitionerHttp(
         baseUrl: baseUrl,
         session: session,
         client: client,
       );

  final PractitionerHttp _http;

  Future<PractitionerDashboard> load() async {
    final response = await _http.send('GET', 'tableau-de-bord');
    if (!PractitionerHttp.ok(response)) {
      throw const DashboardException(
        'Votre tableau de bord n’a pas pu être chargé. Réessayez dans un moment.',
      );
    }
    return PractitionerDashboard.fromJson(
      PractitionerHttp.decode(response) as Map<String, dynamic>,
    );
  }
}
