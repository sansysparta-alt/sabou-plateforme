// Studio mobile sans réseau (US-080, UC-74, R-DON-04). Le praticien connecté retrouve ses
// traitements et les listes du formulaire même sans réseau (dernière copie reçue, chiffrée sur
// le téléphone), saisit et soumet ses brouillons : l'enregistrement est gardé sur le téléphone
// puis rejoué au retour du réseau avec une clé d'envoi (aucun doublon). La règle de conflit est
// appliquée par la base (traitement_synchroniser) : version du serveur validée = elle prime,
// la saisie est gardée en copie ; deux brouillons = le dernier arrivé l'emporte. Le praticien
// en est informé à la synchronisation (avis gardés jusqu'à leur lecture).
import 'dart:async';

import '../dossier/session.dart';
import 'sealed_files.dart';
import 'studio_api.dart';
import 'studio_texts.dart';
import 'voice_outbox.dart';
import 'voice_vault.dart';

/// Erreur de réseau (pas un refus de l'API, pas une session expirée).
bool isNetworkError(Object error) =>
    error is Exception &&
    error is! StudioException &&
    error is! SignedOutException;

/// Un brouillon (et éventuellement sa soumission) en attente d'envoi.
class PendingTreatment {
  const PendingTreatment({
    required this.clientKey,
    required this.code,
    required this.readAt,
    required this.fields,
    required this.submit,
    required this.diseaseName,
    required this.savedAt,
    this.error,
  });

  factory PendingTreatment.fromJson(Map<String, dynamic> j) => PendingTreatment(
    clientKey: j['cle'] as String,
    code: j['code'] as String,
    readAt: j['vueLe'] as String?,
    fields: TreatmentFields.fromJson(j['fields'] as Map<String, dynamic>),
    submit: j['soumettre'] as bool,
    diseaseName: j['maladieNom'] as String,
    savedAt: j['le'] as String,
    error: j['erreur'] as String?,
  );

  final String clientKey;

  /// Code du serveur, ou identifiant local (LOCAL-…) d'un traitement créé hors réseau.
  final String code;

  /// Date de modification lue avant de partir hors réseau (première lecture : les
  /// enregistrements suivants hors réseau la gardent). Null pour un traitement créé hors réseau.
  final String? readAt;
  final TreatmentFields fields;
  final bool submit;
  final String diseaseName;
  final String savedAt;

  /// Refus définitif du serveur, dit au praticien ; l'envoi n'est plus tenté.
  final String? error;

  PendingTreatment copyWith({
    TreatmentFields? fields,
    bool? submit,
    String? error,
    String? diseaseName,
    String? savedAt,
  }) => PendingTreatment(
    clientKey: clientKey,
    code: code,
    readAt: readAt,
    fields: fields ?? this.fields,
    submit: submit ?? this.submit,
    diseaseName: diseaseName ?? this.diseaseName,
    savedAt: savedAt ?? this.savedAt,
    error: error,
  );

  Map<String, Object?> toJson() => {
    'cle': clientKey,
    'code': code,
    'vueLe': readAt,
    'fields': fields.toJson(),
    'soumettre': submit,
    'maladieNom': diseaseName,
    'le': savedAt,
    if (error != null) 'erreur': error,
  };

  /// Traitement tel que le téléphone le montre en attendant l'envoi.
  TreatmentDetail toDetail(StudioReferentials? refs, TreatmentDetail? base) {
    final plantNames = {for (final p in refs?.plants ?? const []) p.code: p};
    final ciLabels = {
      for (final c in refs?.contraindications ?? const <CodeLabel>[])
        c.code: c.label,
    };
    return TreatmentDetail(
      code: code,
      title: fields.titleFr,
      disease: CodeLabel(fields.disease, diseaseName),
      status: 'brouillon',
      waitingReason: null,
      modifiedAt: readAt ?? '',
      titleEn: fields.titleEn.isEmpty ? null : fields.titleEn,
      cycleDays: fields.cycleDays,
      dosesPerDay: fields.dosesPerDay,
      pauseDays: fields.pauseDays,
      plants: [
        for (final p in fields.plants)
          TreatmentPlant(
            p.plant,
            plantNames[p.plant]?.name ?? p.plant,
            p.part.isEmpty ? null : p.part,
            plantNames[p.plant]?.validated ?? false,
          ),
      ],
      sections: [
        for (final s in fields.sections)
          TreatmentSection(s.type, s.fr, s.en.isEmpty ? null : s.en),
      ],
      voices: base?.voices ?? const [],
      contraindications: [
        for (final c in fields.contraindications)
          CodeLabel(c, ciLabels[c] ?? c),
      ],
      visibility: fields.consent ? fields.visibility : null,
      consentedAt: fields.consent ? (base?.consentedAt ?? savedAt) : null,
      gaps: const [],
      dossier: base?.dossier,
      lastMotif: base?.lastMotif,
    );
  }
}

/// Copie chiffrée du Studio sur le téléphone : listes, traitements, envois en attente, avis.
class StudioStore {
  StudioStore(this.files);

  final SealedFiles files;

  Future<Map<String, dynamic>?> referentials() async =>
      (await _safe('referentiels.json')) as Map<String, dynamic>?;
  Future<void> saveReferentials(Map<String, dynamic> json) =>
      files.writeJson('referentiels.json', json);

  /// Liste reçue et sa date ; null si jamais reçue.
  Future<({List<dynamic> items, String at})?> list() async {
    final j = (await _safe('liste.json')) as Map<String, dynamic>?;
    return j == null
        ? null
        : (items: j['items'] as List, at: j['le'] as String);
  }

  Future<void> saveList(List<dynamic> items, DateTime at) => files.writeJson(
    'liste.json',
    {'items': items, 'le': at.toUtc().toIso8601String()},
  );

  String _detailName(String code) => 'traitement-$code.json';
  Future<Map<String, dynamic>?> detail(String code) async =>
      (await _safe(_detailName(code))) as Map<String, dynamic>?;
  Future<void> saveDetail(String code, Map<String, dynamic> json) =>
      files.writeJson(_detailName(code), json);

  Future<List<PendingTreatment>> pending() async => [
    for (final p in (await _safe('envois.json')) as List? ?? const [])
      PendingTreatment.fromJson(p as Map<String, dynamic>),
  ];
  Future<void> savePending(List<PendingTreatment> list) =>
      files.writeJson('envois.json', [for (final p in list) p.toJson()]);

  Future<List<String>> notices() async => [
    for (final n in (await _safe('avis.json')) as List? ?? const [])
      n as String,
  ];
  Future<void> saveNotices(List<String> list) =>
      files.writeJson('avis.json', list);

  // Copie illisible (clé changée, fichier abîmé) : traitée comme absente, jamais bloquante
  Future<Object?> _safe(String name) async {
    try {
      return await files.readJson(name);
    } on Exception {
      return null;
    }
  }
}

/// Refus du serveur qui ne changeront pas en réessayant.
const _definitive = {
  'invalid',
  'not_found',
  'no_profile',
  'rejected',
  'locked',
};

class SyncReport {
  const SyncReport({
    required this.sent,
    required this.left,
    required this.notices,
  });
  final int sent;
  final int left;
  final List<String> notices;
}

/// Studio vu par les écrans : en ligne, l'API (et la copie est tenue à jour) ; hors réseau,
/// la copie et les envois en attente.
class OfflineStudio {
  OfflineStudio({
    required this.api,
    this.store,
    this.vault,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final StudioApi api;

  /// Null : pas de copie sur le téléphone (tests du Studio en ligne).
  final StudioStore? store;
  final VoiceVault? vault;
  final DateTime Function() _clock;
  bool _syncing = false;

  /// Date de la copie montrée quand le réseau manque ; null si les données viennent du serveur.
  String? offlineSince;

  /// Mise en copie des traitements en cours (attendue par les tests).
  Future<void> prefetching = Future.value();

  /// Copie des listes du formulaire et du détail des traitements nouveaux ou modifiés (50 au
  /// plus, un à la fois pour ménager la 3G), pour qu'ils s'ouvrent ensuite sans réseau.
  Future<void> _prefetch(List<dynamic> items) async {
    final store = this.store;
    if (store == null) return;
    // Listes du formulaire (maladies, plantes, sections) : sans elles, rien ne s'ouvre
    if (await store.referentials() == null) {
      try {
        await store.saveReferentials(await api.referentialsJson());
      } on Exception {
        return;
      }
    }
    var fetched = 0;
    for (final t in items.cast<Map<String, dynamic>>()) {
      if (fetched >= 50) break;
      final code = t['code'] as String;
      final copy = await store.detail(code);
      if (copy != null && copy['modifieLe'] == t['modifieLe']) continue;
      try {
        await store.saveDetail(code, await api.detailJson(code));
        fetched++;
      } on Exception {
        return; // réseau coupé ou refus : la prochaine liste reprendra
      }
    }
  }

  Future<StudioReferentials> referentials() async {
    try {
      final json = await api.referentialsJson();
      await store?.saveReferentials(json);
      return StudioReferentials.fromJson(json);
    } on Exception catch (error) {
      final copy = await store?.referentials();
      if (!isNetworkError(error) || copy == null) rethrow;
      return StudioReferentials.fromJson(copy);
    }
  }

  /// Traitements du serveur (ou de la copie), plus ceux créés hors réseau en tête.
  Future<List<TreatmentSummary>> list() async {
    List<dynamic> items;
    try {
      items = await api.listJson();
      await store?.saveList(items, _clock());
      offlineSince = null;
      prefetching = _prefetch(items);
    } on Exception catch (error) {
      final copy = await store?.list();
      if (!isNetworkError(error) || copy == null) rethrow;
      items = copy.items;
      offlineSince = copy.at;
    }
    final pending = await store?.pending() ?? const [];
    final byCode = {for (final p in pending) p.code: p};
    return [
      for (final p in pending.where((p) => isLocalCode(p.code)))
        TreatmentSummary(
          code: p.code,
          title: p.fields.titleFr,
          disease: CodeLabel(p.fields.disease, p.diseaseName),
          status: 'brouillon',
          waitingReason: null,
          modifiedAt: p.savedAt,
        ),
      for (final t in items)
        _overlay(TreatmentSummary.fromJson(t as Map<String, dynamic>), byCode),
    ];
  }

  TreatmentSummary _overlay(
    TreatmentSummary t,
    Map<String, PendingTreatment> byCode,
  ) {
    final p = byCode[t.code];
    if (p == null) return t;
    return TreatmentSummary(
      code: t.code,
      title: p.fields.titleFr,
      disease: CodeLabel(p.fields.disease, p.diseaseName),
      status: t.status,
      waitingReason: t.waitingReason,
      modifiedAt: t.modifiedAt,
    );
  }

  Future<PendingTreatment?> pendingFor(String code) async {
    for (final p in await store?.pending() ?? const <PendingTreatment>[]) {
      if (p.code == code) return p;
    }
    return null;
  }

  /// Traitement à afficher : saisie en attente par-dessus la dernière version connue.
  Future<TreatmentDetail> detail(String code, StudioReferentials? refs) async {
    final pending = await pendingFor(code);
    TreatmentDetail? base;
    if (!isLocalCode(code)) {
      try {
        final json = await api.detailJson(code);
        await store?.saveDetail(code, json);
        base = TreatmentDetail.fromJson(json);
      } on Exception catch (error) {
        final copy = await store?.detail(code);
        if (!isNetworkError(error) || (copy == null && pending == null)) {
          rethrow;
        }
        if (copy != null) base = TreatmentDetail.fromJson(copy);
      }
    }
    if (pending != null && (base == null || base.isDraft)) {
      return pending.toDetail(refs, base);
    }
    if (base == null) {
      throw const StudioException('not_found', 'Traitement introuvable.');
    }
    return base;
  }

  /// Enregistre le brouillon : au serveur si possible, sinon sur le téléphone. Renvoie le
  /// traitement à afficher et vrai s'il est resté sur le téléphone.
  Future<(TreatmentDetail, bool)> save(
    TreatmentDetail? current,
    TreatmentFields fields,
    StudioReferentials refs, {
    bool submit = false,
  }) async {
    final queued = current != null ? await pendingFor(current.code) : null;
    // Envoi déjà en attente pour ce traitement : on complète la file sans tenter le serveur,
    // pour que l'ordre des enregistrements soit gardé
    if (queued == null && (current == null || !isLocalCode(current.code))) {
      try {
        var saved = current == null
            ? await api.create(fields)
            : await api.update(current.code, current.modifiedAt, fields);
        if (submit && saved.gaps.isEmpty) saved = await api.submit(saved.code);
        return (saved, false);
      } on Exception catch (error) {
        if (store == null || !isNetworkError(error)) rethrow;
      }
    }
    final diseaseName = refs.diseases
        .firstWhere(
          (d) => d.code == fields.disease,
          orElse: () => CodeLabel(fields.disease, fields.disease),
        )
        .label;
    final now = _clock().toUtc().toIso8601String();
    final list = await store!.pending();
    final PendingTreatment op;
    if (queued != null) {
      op = queued.copyWith(
        fields: fields,
        submit: submit || queued.submit,
        diseaseName: diseaseName,
        savedAt: now,
      );
    } else {
      op = PendingTreatment(
        clientKey: newClientKey(),
        code: current?.code ?? '$localPrefix${newClientKey()}',
        readAt: current == null || isLocalCode(current.code)
            ? null
            : current.modifiedAt,
        fields: fields,
        submit: submit,
        diseaseName: diseaseName,
        savedAt: now,
      );
    }
    await store!.savePending([
      ...list.where((p) => p.clientKey != op.clientKey),
      op,
    ]);
    return (op.toDetail(refs, current), true);
  }

  /// Une tournée : brouillons d'abord (les voix ont besoin du code), puis voix.
  /// Lève [SignedOutException] si la session n'est plus valable.
  Future<SyncReport> sync() async {
    final store = this.store;
    if (store == null || _syncing) {
      return const SyncReport(sent: 0, left: 0, notices: []);
    }
    _syncing = true;
    var sent = 0;
    final notices = <String>[];
    try {
      for (final op in await store.pending()) {
        if (op.error != null) continue;
        try {
          final result = await api.sync(
            clientKey: op.clientKey,
            code: isLocalCode(op.code) ? null : op.code,
            readAt: op.readAt,
            fields: op.fields.toJson(),
            submit: op.submit,
          );
          final detail = result['detail'] as Map<String, dynamic>;
          final code = detail['code'] as String;
          await store.saveDetail(code, detail);
          if (isLocalCode(op.code)) await vault?.recode(op.code, code);
          await store.savePending(
            (await store.pending())
                .where((p) => p.clientKey != op.clientKey)
                .toList(),
          );
          sent++;
          final title = op.fields.titleFr;
          switch (result['conflit']) {
            case 'version_validee':
              notices.add(
                '« $title » avait déjà été soumis : la version du serveur est gardée. Votre '
                'saisie faite sans réseau est conservée en copie, rattachée au traitement $code.',
              );
            case 'remplacee':
              notices.add(
                '« $title » avait été modifié ailleurs pendant que vous étiez sans réseau : votre '
                'version, arrivée la dernière, est retenue ; l’autre est conservée.',
              );
          }
          final gaps = result['soumissionManques'] as List?;
          if (gaps != null) {
            notices.add(
              '« $title » est enregistré mais pas soumis. ${gapsSentence([for (final g in gaps) g as String])}',
            );
          }
        } on SignedOutException {
          rethrow;
        } on StudioException catch (error) {
          if (!_definitive.contains(error.code)) break;
          await store.savePending([
            for (final p in await store.pending())
              p.clientKey == op.clientKey
                  ? p.copyWith(error: error.message)
                  : p,
          ]);
          notices.add(
            '« ${op.fields.titleFr} » n’a pas pu être envoyé : ${error.message}',
          );
        } on Exception {
          break; // réseau absent ou coupé : la tournée reprendra au retour du réseau
        }
      }
      if (vault != null) await VoiceOutbox(vault: vault!, api: api).flush();
    } on SignedOutException {
      rethrow;
    } on Exception {
      // Voix : réseau coupé pendant la tournée, elles attendent la suivante
    } finally {
      _syncing = false;
    }
    if (notices.isNotEmpty) {
      await store.saveNotices([...await store.notices(), ...notices]);
    }
    final left =
        (await store.pending()).where((p) => p.error == null).length +
        ((await vault?.pending()) ?? const <PendingVoice>[])
            .where((p) => p.error == null)
            .length;
    return SyncReport(sent: sent, left: left, notices: notices);
  }

  /// Avis de synchronisation pas encore lus ; les lire les efface.
  Future<List<String>> takeNotices() async {
    final list = await store?.notices() ?? const <String>[];
    if (list.isNotEmpty) await store!.saveNotices(const []);
    return list;
  }
}
