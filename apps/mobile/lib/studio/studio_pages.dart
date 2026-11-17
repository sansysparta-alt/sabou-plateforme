// Rubrique « Studio » du praticien (US-067, UC-21) : liste « Mes traitements », création,
// modification et soumission d'un traitement, en texte. Mêmes règles et même API que le
// Studio web (US-060 à US-064). La voix et le brouillon hors réseau viennent avec US-080 et
// US-081. Cibles tactiles de 48 px, erreurs sous le champ, messages annoncés aux lecteurs
// d'écran (WCAG 2.2 AA, CdC §8).
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../dossier/session.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'studio_api.dart';
import 'studio_texts.dart';

// ---------------------------------------------------------------------------------------
// Liste « Mes traitements »
// ---------------------------------------------------------------------------------------

class TreatmentsPage extends StatefulWidget {
  const TreatmentsPage({
    super.key,
    required this.api,
    required this.onSignedOut,
  });

  final StudioApi api;

  /// La session a expiré ou a été révoquée : retour à la connexion.
  final VoidCallback onSignedOut;

  @override
  State<TreatmentsPage> createState() => _TreatmentsPageState();
}

class _TreatmentsPageState extends State<TreatmentsPage> {
  List<TreatmentSummary>? _items;
  String? _error;
  bool _signedOut = false;

  // Une seule fois, que la session expire dans la liste ou dans l'écran d'édition
  void _signOut() {
    if (_signedOut) return;
    _signedOut = true;
    widget.onSignedOut();
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final items = await widget.api.list();
      if (mounted) setState(() => _items = items);
    } on SignedOutException {
      _signOut();
    } on StudioException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } on Exception {
      if (mounted) {
        setState(
          () => _error =
              'Vos traitements n’ont pas pu être chargés. Vérifiez le réseau.',
        );
      }
    }
  }

  Future<void> _open(String? code) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => TreatmentEditorPage(
          api: widget.api,
          code: code,
          onSignedOut: _signOut,
        ),
      ),
    );
    // Retour à la liste : états et titres à jour
    if (mounted && !_signedOut) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    if (items == null && _error == null) {
      return const LoadingView(label: 'Chargement de vos traitements');
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(SabouSpace.s4),
        children: [
          if (_error != null) ...[
            StatusMessage(_error!, kind: StatusKind.error),
            OutlinedButton(onPressed: _load, child: const Text('Réessayer')),
            const SizedBox(height: SabouSpace.s4),
          ],
          FilledButton.icon(
            onPressed: () => _open(null),
            icon: const Icon(Icons.add),
            label: const Text('Nouveau traitement'),
          ),
          const SizedBox(height: SabouSpace.s5),
          const SectionTitle('Mes traitements'),
          if (items != null && items.isEmpty)
            const Text(
              'Aucun traitement pour le moment. Créez le premier : il reste en brouillon '
              'tant que vous ne le soumettez pas.',
            ),
          for (final item in items ?? const <TreatmentSummary>[])
            _TreatmentTile(item: item, onTap: () => _open(item.code)),
        ],
      ),
    );
  }
}

class _TreatmentTile extends StatelessWidget {
  const _TreatmentTile({required this.item, required this.onTap});

  final TreatmentSummary item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final waiting = item.waitingReason == null
        ? null
        : waitingLabels[item.waitingReason];
    return Card(
      margin: const EdgeInsets.only(bottom: SabouSpace.s3),
      child: ListTile(
        key: Key('traitement-${item.code}'),
        minVerticalPadding: SabouSpace.s3,
        title: Text(item.title),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${item.disease.label} · ${item.code}'),
            const SizedBox(height: SabouSpace.s1),
            Text(
              statusLabel(item.status),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            if (waiting != null) ...[
              const SizedBox(height: SabouSpace.s1),
              Text(waiting),
            ],
          ],
        ),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------
// Création, modification et soumission
// ---------------------------------------------------------------------------------------

class _PlantRow {
  _PlantRow(this.key, {this.plant, String part = ''})
    : part = TextEditingController(text: part);
  final int key;
  String? plant;
  final TextEditingController part;
}

class TreatmentEditorPage extends StatefulWidget {
  const TreatmentEditorPage({
    super.key,
    required this.api,
    required this.code,
    required this.onSignedOut,
  });

  final StudioApi api;

  /// Traitement à ouvrir ; null pour en créer un.
  final String? code;
  final VoidCallback onSignedOut;

  @override
  State<TreatmentEditorPage> createState() => _TreatmentEditorPageState();
}

class _TreatmentEditorPageState extends State<TreatmentEditorPage> {
  StudioReferentials? _refs;
  TreatmentDetail? _treatment;
  String? _loadError;
  bool _loaded = false;

  // Saisie
  String? _disease;
  final _titleFr = TextEditingController();
  final _titleEn = TextEditingController();
  final _cycleDays = TextEditingController();
  final _doses = TextEditingController();
  final _pause = TextEditingController();
  var _plants = <_PlantRow>[];
  final _sectionsFr = <String, TextEditingController>{};
  final _sectionsEn = <String, TextEditingController>{};
  var _contraindications = <String>{};
  bool _consent = false;
  String? _visibility;
  int _nextKey = 1;

  // Erreurs sous le champ (WCAG 3.3.1) ; le message en tête reste aux refus du serveur
  final _fieldErrors = <String, String>{};
  bool _busy = false;
  String? _message;
  StatusKind _messageKind = StatusKind.info;
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in [
      _titleFr,
      _titleEn,
      _cycleDays,
      _doses,
      _pause,
      ..._sectionsFr.values,
      ..._sectionsEn.values,
      for (final p in _plants) p.part,
    ]) {
      c.dispose();
    }
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loadError = null);
    try {
      final code = widget.code;
      final results = await Future.wait<Object?>([
        widget.api.referentials(),
        if (code != null) widget.api.detail(code),
      ]);
      if (!mounted) return;
      final refs = results[0] as StudioReferentials;
      setState(() {
        _refs = refs;
        for (final s in refs.sections) {
          _sectionsFr.putIfAbsent(s.code, TextEditingController.new);
          _sectionsEn.putIfAbsent(s.code, TextEditingController.new);
        }
        _fill(results.length > 1 ? results[1] as TreatmentDetail : null);
        _loaded = true;
      });
    } on SignedOutException {
      _signedOut();
    } on StudioException catch (error) {
      if (mounted) setState(() => _loadError = error.message);
    } on Exception {
      if (mounted) {
        setState(
          () => _loadError =
              'Le traitement n’a pas pu être chargé. Vérifiez le réseau.',
        );
      }
    }
  }

  // Session expirée : l'écran d'édition, poussé par-dessus la coquille, est fermé pour que la
  // connexion ne reste pas cachée dessous
  void _signedOut() {
    if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    widget.onSignedOut();
  }

  /// Remplit la saisie avec le traitement (ou la vide pour un nouveau).
  void _fill(TreatmentDetail? t) {
    _treatment = t;
    String number(int? n) => n == null ? '' : '$n';
    _disease = t?.disease.code;
    _titleFr.text = t?.title ?? '';
    _titleEn.text = t?.titleEn ?? '';
    _cycleDays.text = number(t?.cycleDays);
    _doses.text = number(t?.dosesPerDay);
    _pause.text = number(t?.pauseDays);
    for (final p in _plants) {
      p.part.dispose();
    }
    _plants = [
      for (final p in t?.plants ?? const <TreatmentPlant>[])
        _PlantRow(_nextKey++, plant: p.code, part: p.part ?? ''),
    ];
    if (_plants.isEmpty) _plants = [_PlantRow(_nextKey++)];
    for (final c in [..._sectionsFr.values, ..._sectionsEn.values]) {
      c.clear();
    }
    for (final s in t?.sections ?? const <TreatmentSection>[]) {
      _sectionsFr[s.type]?.text = s.textFr;
      _sectionsEn[s.type]?.text = s.textEn ?? '';
    }
    _contraindications = {
      for (final c in t?.contraindications ?? const <CodeLabel>[]) c.code,
    };
    _consent = t?.consentedAt != null;
    _visibility = t?.visibility;
  }

  int? _integer(TextEditingController c) {
    final text = c.text.trim();
    return text.isEmpty ? null : int.tryParse(text);
  }

  TreatmentFields _fields() => TreatmentFields(
    disease: _disease!,
    titleFr: _titleFr.text.trim(),
    titleEn: _titleEn.text.trim(),
    cycleDays: _integer(_cycleDays),
    dosesPerDay: _integer(_doses),
    pauseDays: _integer(_pause),
    plants: [
      for (final p in _plants)
        if (p.plant != null) (plant: p.plant!, part: p.part.text.trim()),
    ],
    sections: [
      for (final s in _refs!.sections)
        if (_sectionsFr[s.code]!.text.trim().isNotEmpty)
          (
            type: s.code,
            fr: _sectionsFr[s.code]!.text.trim(),
            en: _sectionsEn[s.code]!.text.trim(),
          ),
    ],
    contraindications: _contraindications.toList(),
    consent: _consent,
    visibility: _visibility,
  );

  void _say(String text, StatusKind kind) {
    _message = text;
    _messageKind = kind;
    // Message en tête : on y remonte pour qu'il soit vu
    if (_scroll.hasClients) {
      _scroll.animateTo(
        0,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    }
  }

  /// Enregistre le brouillon ; renvoie le traitement à jour, ou null en cas d'échec.
  Future<TreatmentDetail?> _save() async {
    final found = <String, String>{};
    if (_disease == null) found['maladie'] = 'Choisissez la maladie soignée.';
    if (_titleFr.text.trim().isEmpty) {
      found['titreFr'] = 'Donnez un titre au traitement.';
    }
    if (_consent && _visibility == null) {
      found['visibilite'] = 'Choisissez le niveau de visibilité.';
    }
    setState(() {
      _fieldErrors
        ..clear()
        ..addAll(found);
      _message = null;
    });
    if (found.isNotEmpty) {
      _say(
        'Corrigez les champs signalés en rouge, puis réessayez.',
        StatusKind.error,
      );
      return null;
    }
    final t = _treatment;
    final saved = t == null
        ? await widget.api.create(_fields())
        : await widget.api.update(t.code, t.modifiedAt, _fields());
    _fill(saved);
    return saved;
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
    } on SignedOutException {
      _signedOut();
      return;
    } on StudioException catch (error) {
      _say(
        error.gaps.isNotEmpty ? gapsSentence(error.gaps) : error.message,
        StatusKind.error,
      );
    } on Exception {
      _say(networkError, StatusKind.error);
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _onSave() => _run(() async {
    final saved = await _save();
    if (saved != null) {
      _say('Brouillon ${saved.code} enregistré.', StatusKind.success);
    }
  });

  Future<void> _onSubmit() => _run(() async {
    final saved = await _save();
    if (saved == null) return;
    if (saved.gaps.isNotEmpty) {
      _say(gapsSentence(saved.gaps), StatusKind.error);
      return;
    }
    final submitted = await widget.api.submit(saved.code);
    _fill(submitted);
    _say('Traitement ${submitted.code} soumis.', StatusKind.success);
  });

  void _edit(String field, VoidCallback change) => setState(() {
    change();
    // Une saisie efface l'erreur du champ corrigé
    _fieldErrors.remove(field);
  });

  @override
  Widget build(BuildContext context) {
    final t = _treatment;
    final title = t?.title ?? 'Nouveau traitement';
    Widget body;
    if (!_loaded) {
      body = _loadError == null
          ? const LoadingView(label: 'Chargement du traitement')
          : ListView(
              padding: const EdgeInsets.all(SabouSpace.s4),
              children: [
                StatusMessage(_loadError!, kind: StatusKind.error),
                FilledButton(onPressed: _load, child: const Text('Réessayer')),
              ],
            );
    } else if (t != null && !t.isDraft) {
      body = _readOnly(t);
    } else {
      body = _form();
    }
    return Scaffold(
      appBar: AppBar(title: Text(_loaded ? title : 'Studio')),
      body: SafeArea(child: body),
    );
  }

  List<Widget> _header(TreatmentDetail? t) => [
    if (t != null)
      Padding(
        padding: const EdgeInsets.only(bottom: SabouSpace.s3),
        child: Text('${t.code} · ${statusLabel(t.status)}'),
      ),
    if (t?.lastMotif != null)
      StatusMessage(
        'Renvoyé pour correction : ${t!.lastMotif}',
        kind: StatusKind.warning,
      ),
    if (_busy) ...[
      const LinearProgressIndicator(),
      const SizedBox(height: SabouSpace.s2),
    ],
    if (_message != null) StatusMessage(_message!, kind: _messageKind),
  ];

  Widget _form() {
    final refs = _refs!;
    final t = _treatment;
    final enabled = !_busy;
    final plantByCode = {for (final p in refs.plants) p.code: p};
    final chosen = {for (final p in _plants) p.plant};
    // Liste active, plus celles que le traitement a déjà et qui ont été désactivées depuis
    final contraindications = [
      ...refs.contraindications,
      ...?t?.contraindications.where(
        (c) => !refs.contraindications.any((r) => r.code == c.code),
      ),
    ];
    return SingleChildScrollView(
      controller: _scroll,
      padding: const EdgeInsets.all(SabouSpace.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ..._header(t),
          DropdownButtonFormField<String>(
            key: const Key('studio-maladie'),
            initialValue: _disease,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: 'Maladie soignée',
              errorText: _fieldErrors['maladie'],
            ),
            items: [
              for (final m in refs.diseases)
                DropdownMenuItem(value: m.code, child: Text(m.label)),
            ],
            onChanged: enabled
                ? (v) => _edit('maladie', () => _disease = v)
                : null,
          ),
          const SizedBox(height: SabouSpace.s3),
          _text(
            id: 'titreFr',
            controller: _titleFr,
            label: 'Titre du traitement',
            max: treatmentTitleMax,
            enabled: enabled,
          ),
          _text(
            id: 'titreEn',
            controller: _titleEn,
            label: 'Titre en anglais (facultatif)',
            max: treatmentTitleMax,
            enabled: enabled,
          ),
          const SizedBox(height: SabouSpace.s3),
          const SectionTitle('Plantes, dans l’ordre de la préparation'),
          for (final (index, row) in _plants.indexed)
            _plantCard(index, row, plantByCode, chosen, enabled),
          if (_plants.length < treatmentPlantsMax)
            OutlinedButton.icon(
              onPressed: enabled
                  ? () => setState(() => _plants.add(_PlantRow(_nextKey++)))
                  : null,
              icon: const Icon(Icons.add),
              label: const Text('Ajouter une plante'),
            ),
          const SizedBox(height: SabouSpace.s5),
          const SectionTitle('Cycle de traitement'),
          _number('cycleDureeJours', _cycleDays, 'Durée (jours)', enabled),
          _number('cyclePrisesParJour', _doses, 'Prises par jour', enabled),
          _number(
            'cyclePauseJours',
            _pause,
            'Pause (jours, facultatif)',
            enabled,
          ),
          const SizedBox(height: SabouSpace.s3),
          for (final s in refs.sections) ...[
            SectionTitle(s.required ? s.label : '${s.label} (facultatif)'),
            _text(
              id: 'section-${s.code}',
              controller: _sectionsFr[s.code]!,
              label: 'Texte en français',
              semanticsLabel: 'Texte en français : ${s.label}',
              max: treatmentSectionMax,
              lines: 4,
              enabled: enabled,
            ),
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: const Text('Texte en anglais (facultatif)'),
              initiallyExpanded: _sectionsEn[s.code]!.text.isNotEmpty,
              children: [
                _text(
                  id: 'section-${s.code}-en',
                  controller: _sectionsEn[s.code]!,
                  label: 'Texte en anglais',
                  semanticsLabel: 'Texte en anglais : ${s.label}',
                  max: treatmentSectionMax,
                  lines: 4,
                  enabled: enabled,
                ),
              ],
            ),
            const SizedBox(height: SabouSpace.s3),
          ],
          const SectionTitle('Contre-indications'),
          const Text(
            'Cochez les personnes à qui ce traitement est déconseillé : elles seront '
            'affichées en alerte sur la page du traitement.',
          ),
          for (final c in contraindications)
            CheckboxListTile(
              key: Key('studio-ci-${c.code}'),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _contraindications.contains(c.code),
              title: Text(c.label),
              onChanged: enabled
                  ? (v) => setState(
                      () => v == true
                          ? _contraindications.add(c.code)
                          : _contraindications.remove(c.code),
                    )
                  : null,
            ),
          const SizedBox(height: SabouSpace.s3),
          const SectionTitle('Consentement et visibilité'),
          CheckboxListTile(
            key: const Key('studio-consentement'),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _consent,
            title: const Text(
              'J’accepte que ce traitement soit examiné par SABOU puis, une fois certifié, '
              'publié selon le niveau de visibilité choisi.',
            ),
            onChanged: enabled
                ? (v) => _edit('visibilite', () => _consent = v ?? false)
                : null,
          ),
          Semantics(
            label: 'Niveau de visibilité',
            container: true,
            child: RadioGroup<String>(
              groupValue: _visibility,
              onChanged: (v) => _edit('visibilite', () => _visibility = v),
              child: Column(
                children: [
                  for (final v in visibilities)
                    RadioListTile<String>(
                      key: Key('studio-visibilite-$v'),
                      contentPadding: EdgeInsets.zero,
                      value: v,
                      enabled: enabled && _consent,
                      title: Text(visibilityLabels[v]!.label),
                      subtitle: Text(visibilityLabels[v]!.help),
                    ),
                ],
              ),
            ),
          ),
          if (_fieldErrors['visibilite'] != null)
            Padding(
              padding: const EdgeInsets.only(bottom: SabouSpace.s3),
              child: Text(
                _fieldErrors['visibilite']!,
                key: const Key('studio-visibilite-erreur'),
                style: const TextStyle(color: SabouColors.error),
              ),
            ),
          if (t != null && t.gaps.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: SabouSpace.s3),
              child: Text(
                'Avant de soumettre : ${t.gaps.map((g) => gapLabels[g] ?? g).join(' ; ')}.',
              ),
            ),
          const SizedBox(height: SabouSpace.s4),
          OutlinedButton(
            onPressed: enabled ? _onSave : null,
            child: const Text('Enregistrer le brouillon'),
          ),
          const SizedBox(height: SabouSpace.s3),
          FilledButton(
            onPressed: enabled ? _onSubmit : null,
            child: const Text('Soumettre pour certification'),
          ),
        ],
      ),
    );
  }

  Widget _plantCard(
    int index,
    _PlantRow row,
    Map<String, StudioPlant> plantByCode,
    Set<String?> chosen,
    bool enabled,
  ) {
    final plant = row.plant == null ? null : plantByCode[row.plant];
    final name = plant?.name ?? 'plante ${index + 1}';
    final pending = plant != null && !plant.validated;
    return Card(
      margin: const EdgeInsets.only(bottom: SabouSpace.s3),
      child: Padding(
        padding: const EdgeInsets.all(SabouSpace.s3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DropdownButtonFormField<String>(
              key: Key('studio-plante-$index'),
              initialValue: row.plant,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: 'Plante ${index + 1}',
                helperText: pending
                    ? 'En revue par le Comité : le traitement ne sera certifié qu’après sa validation.'
                    : null,
                helperMaxLines: 3,
              ),
              items: [
                for (final p in plantByCode.values)
                  if (p.code == row.plant || !chosen.contains(p.code))
                    DropdownMenuItem(
                      value: p.code,
                      child: Text('${p.name} (${p.scientificName})'),
                    ),
              ],
              onChanged: enabled ? (v) => setState(() => row.plant = v) : null,
            ),
            const SizedBox(height: SabouSpace.s3),
            TextField(
              key: Key('studio-partie-$index'),
              controller: row.part,
              enabled: enabled,
              inputFormatters: [
                LengthLimitingTextInputFormatter(treatmentPartMax),
              ],
              decoration: const InputDecoration(
                labelText: 'Partie utilisée',
                hintText: 'feuilles, écorce, racine…',
              ),
            ),
            const SizedBox(height: SabouSpace.s2),
            Wrap(
              spacing: SabouSpace.s2,
              children: [
                TextButton(
                  onPressed: enabled && index > 0
                      ? () => setState(() => _move(index, -1))
                      : null,
                  child: Text('Monter', semanticsLabel: 'Monter $name'),
                ),
                TextButton(
                  onPressed: enabled && index < _plants.length - 1
                      ? () => setState(() => _move(index, 1))
                      : null,
                  child: Text('Descendre', semanticsLabel: 'Descendre $name'),
                ),
                TextButton(
                  onPressed: enabled && _plants.length > 1
                      ? () => setState(
                          () => _plants.removeAt(index).part.dispose(),
                        )
                      : null,
                  child: Text('Retirer', semanticsLabel: 'Retirer $name'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  void _move(int index, int step) {
    final row = _plants.removeAt(index);
    _plants.insert(index + step, row);
  }

  Widget _text({
    required String id,
    required TextEditingController controller,
    required String label,
    required int max,
    required bool enabled,
    String? semanticsLabel,
    int lines = 1,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: SabouSpace.s3),
    child: Semantics(
      label: semanticsLabel,
      child: TextField(
        key: Key('studio-$id'),
        controller: controller,
        enabled: enabled,
        minLines: lines,
        maxLines: lines == 1 ? 1 : null,
        inputFormatters: [LengthLimitingTextInputFormatter(max)],
        onChanged: (_) {
          if (_fieldErrors.containsKey(id)) _edit(id, () {});
        },
        decoration: InputDecoration(
          labelText: label,
          errorText: _fieldErrors[id],
          errorMaxLines: 3,
          alignLabelWithHint: lines > 1,
        ),
      ),
    ),
  );

  Widget _number(
    String id,
    TextEditingController controller,
    String label,
    bool enabled,
  ) => Padding(
    padding: const EdgeInsets.only(bottom: SabouSpace.s3),
    child: TextField(
      key: Key('studio-$id'),
      controller: controller,
      enabled: enabled,
      keyboardType: TextInputType.number,
      inputFormatters: [
        FilteringTextInputFormatter.digitsOnly,
        LengthLimitingTextInputFormatter(3),
      ],
      decoration: InputDecoration(labelText: label),
    ),
  );

  // Traitement soumis : il ne se modifie plus, son avancement s'affiche
  Widget _readOnly(TreatmentDetail t) {
    final waiting = t.waitingReason == null
        ? null
        : waitingLabels[t.waitingReason];
    final cycle = [
      '${t.cycleDays ?? '—'} jours',
      '${t.dosesPerDay ?? '—'} prise(s) par jour',
      if (t.pauseDays != null && t.pauseDays! > 0)
        'pause de ${t.pauseDays} jours',
    ].join(', ');
    return ListView(
      controller: _scroll,
      padding: const EdgeInsets.all(SabouSpace.s4),
      children: [
        if (_message != null) StatusMessage(_message!, kind: _messageKind),
        Semantics(
          header: true,
          child: Text(
            statusLabel(t.status),
            style: Theme.of(context).textTheme.titleLarge,
          ),
        ),
        const SizedBox(height: SabouSpace.s3),
        if (t.status == 'soumise')
          StatusMessage(
            'Votre traitement est soumis à l’administration régionale.'
            '${t.dossier == null ? '' : ' Il est joint à votre dossier de certification ${t.dossier} et sera certifié avec lui.'}',
          ),
        if (t.lastMotif != null)
          StatusMessage(
            'Dernier renvoi : ${t.lastMotif}',
            kind: StatusKind.warning,
          ),
        if (waiting != null) StatusMessage(waiting, kind: StatusKind.warning),
        if (t.contraindications.isNotEmpty)
          StatusMessage(
            'Déconseillé : ${t.contraindications.map((c) => c.label).join(', ')}.',
            kind: StatusKind.warning,
          ),
        _summary('Code', t.code),
        _summary('Maladie', t.disease.label),
        _summary(
          'Plantes',
          [
            for (final (i, p) in t.plants.indexed)
              '${i + 1}. ${p.name}${p.part == null ? '' : ' — ${p.part}'}',
          ].join('\n'),
        ),
        _summary('Cycle', cycle),
        _summary(
          'Visibilité',
          t.visibility == null ? '—' : visibilityLabels[t.visibility]!.label,
        ),
      ],
    );
  }

  Widget _summary(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: SabouSpace.s3),
    child: MergeSemantics(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              color: SabouColors.textMuted,
            ),
          ),
          Text(value),
        ],
      ),
    ),
  );
}
