// Rubrique « Visites » de l'agent préfectoral (US-083, UC-30 ; décisions du maître d'œuvre
// du 19 novembre 2026, §2.87) :
// - agenda de la tournée, gardé pour l'usage sans réseau : par jour, puis par localité ;
// - itinéraire sans carte intégrée : « Itinéraire » passe la localité seule (jamais le nom
//   du praticien) à l'application de cartes du téléphone (adresse geo:, aucun service ajouté) ;
// - compte rendu rédigé et signé sans réseau, avec la photo de la fiche signée ; il part au
//   retour du réseau, le serveur calcule l'empreinte et garde son heure de réception.
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../dossier/photo.dart';
import '../dossier/session.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'field_api.dart';

/// Ouvre une adresse hors de l'application (application de cartes) ; remplaçable en test.
typedef OpenExternal = Future<void> Function(Uri url);

const opinionLabels = {
  'favorable': 'Favorable',
  'reserve': 'Favorable avec réserves',
  'defavorable': 'Défavorable',
};

const _days = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
];

String _two(int n) => n.toString().padLeft(2, '0');

/// « Lundi 23/11/2026 » pour 2026-11-23.
String dayLabel(String isoDate) {
  final d = DateTime.parse(isoDate.substring(0, 10));
  return '${_days[d.weekday - 1]} ${_two(d.day)}/${_two(d.month)}/${d.year}';
}

/// Adresse de l'application de cartes du téléphone pour une localité (RFC 5870, requête).
Uri mapsUri(String locality) => Uri.parse(
  'geo:0,0?q=${Uri.encodeQueryComponent(locality).replaceAll('+', '%20')}',
);

/// Date du jour à Conakry (UTC, sans heure d'été) : 2026-11-20.
String conakryToday([DateTime? now]) {
  final d = (now ?? DateTime.now()).toUtc();
  return '${d.year}-${_two(d.month)}-${_two(d.day)}';
}

class FieldVisitsPage extends StatefulWidget {
  const FieldVisitsPage({
    super.key,
    required this.api,
    required this.picker,
    required this.openExternal,
    required this.onSignedOut,
    this.prepare = preparePhotoInBackground,
    this.now,
  });

  final FieldApi api;
  final PhotoPicker picker;
  final Future<Uint8List> Function(Uint8List) prepare;
  final OpenExternal openExternal;
  final VoidCallback onSignedOut;

  /// Horloge du téléphone ; remplaçable dans les tests.
  final DateTime Function()? now;

  @override
  State<FieldVisitsPage> createState() => _FieldVisitsPageState();
}

class _FieldVisitsPageState extends State<FieldVisitsPage> {
  Fetched<List<AgendaItem>>? _agenda;
  List<FieldReport> _pending = const [];
  bool _loading = true;
  String? _error;
  String? _notice;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // Les comptes rendus signés partent d'abord : l'agenda reçu ensuite en tient compte
      _pending = await widget.api.sendPendingReports();
      _agenda = await widget.api.agenda();
      if (_agenda == null) {
        _error =
            'L’agenda n’a pas encore été reçu. Ouvrez cette rubrique une fois avec le '
            'réseau : il restera ensuite disponible sans réseau.';
      }
    } on SignedOutException {
      widget.onSignedOut();
      return;
    } on FieldException catch (e) {
      _error = e.message;
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _plan(AgendaItem item) async {
    final now = widget.now?.call() ?? DateTime.now();
    final date = await showDatePicker(
      context: context,
      firstDate: now,
      lastDate: now.add(const Duration(days: 90)),
      initialDate: now.add(const Duration(days: 1)),
      helpText: 'Date de la visite',
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 9, minute: 0),
      helpText: 'Heure de la visite',
    );
    if (time == null || !mounted) return;
    final when =
        '${date.year}-${_two(date.month)}-${_two(date.day)}T'
        '${_two(time.hour)}:${_two(time.minute)}';
    try {
      await widget.api.plan(item.dossier, when);
      _notice = 'Visite du dossier ${item.dossier} planifiée.';
      await _load();
    } on SignedOutException {
      widget.onSignedOut();
    } on FieldException catch (e) {
      setState(() => _error = e.message);
    } on Exception {
      setState(
        () => _error =
            'Pas de réseau : la planification se fait en ligne. Réessayez au retour du '
            'réseau.',
      );
    }
  }

  Future<void> _report(AgendaItem item) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => FieldReportPage(
          api: widget.api,
          item: item,
          picker: widget.picker,
          prepare: widget.prepare,
          now: widget.now,
        ),
      ),
    );
    if (saved == true) {
      _notice =
          'Compte rendu signé du dossier ${item.dossier} gardé sur le téléphone ; il part '
          'dès que le réseau le permet.';
      await _load();
    }
  }

  Future<void> _openMaps(AgendaItem item) async {
    try {
      await widget.openExternal(mapsUri(item.locality));
    } on Exception {
      setState(
        () => _error =
            'Aucune application de cartes n’a pu s’ouvrir sur ce téléphone. Localité : '
            '${item.locality}.',
      );
    }
  }

  Future<void> _discard(FieldReport report) async {
    await widget.api.store.removeReport(report);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _agenda == null) {
      return const LoadingView(label: 'Chargement de l’agenda');
    }
    final items = _agenda?.value ?? const <AgendaItem>[];
    final waiting = {for (final r in _pending) r.visit};
    final planned = [
      for (final i in items)
        if (i.planned && !waiting.contains(i.visit)) i,
    ];
    final toPlan = [
      for (final i in items)
        if (!i.planned) i,
    ];
    String? lastDay;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(SabouSpace.s4),
        children: [
          if (_notice != null)
            StatusMessage(_notice!, kind: StatusKind.success),
          if (_error != null) ...[
            StatusMessage(_error!, kind: StatusKind.error),
            OutlinedButton(onPressed: _load, child: const Text('Réessayer')),
            const SizedBox(height: SabouSpace.s4),
          ],
          if (_agenda?.fromCopy ?? false)
            const StatusMessage(
              'Sans réseau : agenda gardé sur le téléphone lors de la dernière connexion.',
            ),
          if (_pending.isNotEmpty) ...[
            const SectionTitle('Comptes rendus à envoyer'),
            for (final r in _pending) _pendingTile(r),
            const SizedBox(height: SabouSpace.s4),
          ],
          const SectionTitle('Tournée'),
          if (_agenda != null && planned.isEmpty)
            const Text('Aucune visite planifiée.'),
          for (final item in planned) ...[
            if (item.when!.substring(0, 10) != lastDay) ...[
              Padding(
                padding: const EdgeInsets.only(
                  top: SabouSpace.s3,
                  bottom: SabouSpace.s2,
                ),
                child: Semantics(
                  header: true,
                  child: Text(
                    dayLabel(lastDay = item.when!.substring(0, 10)),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ),
            ],
            _visitCard(item),
          ],
          if (toPlan.isNotEmpty) ...[
            const SizedBox(height: SabouSpace.s4),
            const SectionTitle('Dossiers à planifier'),
            for (final item in toPlan)
              Card(
                margin: const EdgeInsets.only(bottom: SabouSpace.s3),
                child: ListTile(
                  key: Key('a-planifier-${item.dossier}'),
                  minVerticalPadding: SabouSpace.s3,
                  title: Text(item.practitioner),
                  subtitle: Text(
                    '${item.dossier} · ${item.subPrefecture ?? item.prefecture} · '
                    'à l’étape 2 depuis le ${dayLabel(item.since).split(' ').last}',
                  ),
                  trailing: TextButton(
                    onPressed: () => _plan(item),
                    child: Text(
                      'Planifier',
                      semanticsLabel:
                          'Planifier la visite de ${item.practitioner}',
                    ),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _visitCard(AgendaItem item) => Card(
    key: Key('visite-${item.visit}'),
    margin: const EdgeInsets.only(bottom: SabouSpace.s3),
    child: Padding(
      padding: const EdgeInsets.all(SabouSpace.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '${item.when!.substring(11)} · ${item.subPrefecture ?? item.prefecture}',
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: SabouSpace.s1),
          Text('${item.practitioner} · ${item.dossier}'),
          const SizedBox(height: SabouSpace.s2),
          Wrap(
            spacing: SabouSpace.s2,
            runSpacing: SabouSpace.s2,
            children: [
              OutlinedButton.icon(
                onPressed: () => _openMaps(item),
                icon: const Icon(Icons.directions),
                label: Text(
                  'Itinéraire',
                  semanticsLabel:
                      'Itinéraire vers ${item.subPrefecture ?? item.prefecture}',
                ),
              ),
              FilledButton.icon(
                key: Key('compte-rendu-${item.visit}'),
                onPressed: () => _report(item),
                icon: const Icon(Icons.edit_document),
                label: Text(
                  'Compte rendu',
                  semanticsLabel:
                      'Compte rendu de la visite de ${item.practitioner}',
                ),
              ),
            ],
          ),
        ],
      ),
    ),
  );

  Widget _pendingTile(FieldReport r) => Card(
    margin: const EdgeInsets.only(bottom: SabouSpace.s3),
    child: Padding(
      padding: const EdgeInsets.all(SabouSpace.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '${r.practitioner} · ${r.dossier}',
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: SabouSpace.s1),
          Text(
            r.reportSent
                ? 'Compte rendu reçu ; photo de la fiche à envoyer.'
                : 'Signé le ${_signed(r.attestedAt)} · envoi au retour du réseau.',
          ),
          if (r.error != null) ...[
            const SizedBox(height: SabouSpace.s2),
            StatusMessage(r.error!, kind: StatusKind.error),
            TextButton(
              onPressed: () => _discard(r),
              child: const Text('Retirer du téléphone'),
            ),
          ],
        ],
      ),
    ),
  );

  static String _signed(DateTime at) {
    final d = at.toLocal();
    return '${_two(d.day)}/${_two(d.month)}/${d.year} à ${_two(d.hour)} h ${_two(d.minute)}';
  }
}

/// Compte rendu de visite : rédigé et signé sur place, même sans réseau. Signé, il est figé
/// et gardé chiffré sur le téléphone ; la page se ferme avec true.
class FieldReportPage extends StatefulWidget {
  const FieldReportPage({
    super.key,
    required this.api,
    required this.item,
    required this.picker,
    required this.prepare,
    this.now,
  });

  final FieldApi api;
  final AgendaItem item;
  final PhotoPicker picker;
  final Future<Uint8List> Function(Uint8List) prepare;
  final DateTime Function()? now;

  @override
  State<FieldReportPage> createState() => _FieldReportPageState();
}

class _FieldReportPageState extends State<FieldReportPage> {
  final _formKey = GlobalKey<FormState>();
  final _notes = TextEditingController();
  String? _opinion;
  String? _opinionError;
  bool _attested = false;
  Uint8List? _photo;
  String? _message;
  bool _busy = false;

  DateTime get _now => widget.now?.call() ?? DateTime.now();

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  Future<void> _addPhoto(PhotoOrigin origin) async {
    final original = await widget.picker.pick(origin);
    if (original == null) return;
    setState(() => _busy = true);
    try {
      _photo = await widget.prepare(original);
      _message = null;
    } on PhotoException catch (e) {
      _message = e.message;
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _sign() async {
    final valid = _formKey.currentState!.validate() && _opinion != null;
    setState(
      () => _opinionError = _opinion == null ? 'Choisissez un avis.' : null,
    );
    if (!_attested) {
      setState(
        () => _message = 'Cochez l’attestation pour signer le compte rendu.',
      );
    }
    if (!valid || !_attested) return;
    setState(() => _busy = true);
    final report = FieldReport(
      dossier: widget.item.dossier,
      visit: widget.item.visit!,
      practitioner: widget.item.practitioner,
      date: conakryToday(_now),
      opinion: _opinion!,
      notes: _notes.text.trim(),
      attestedAt: _now,
      hasPhoto: _photo != null,
    );
    if (_photo != null) await widget.api.store.saveReportPhoto(report, _photo!);
    await widget.api.store.saveReport(report);
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    return Scaffold(
      appBar: AppBar(title: const Text('Compte rendu de visite')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(SabouSpace.s4),
            children: [
              Text(
                '${item.practitioner} · ${item.dossier}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              Text(
                'Visite du ${dayLabel(conakryToday(_now))} · '
                '${item.subPrefecture ?? item.prefecture}',
              ),
              const SizedBox(height: SabouSpace.s4),
              if (_message != null)
                StatusMessage(_message!, kind: StatusKind.error),
              const SectionTitle('Avis'),
              RadioGroup<String>(
                groupValue: _opinion,
                onChanged: (v) => setState(() {
                  _opinion = v;
                  _opinionError = null;
                }),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final o in opinionLabels.entries)
                      RadioListTile<String>(
                        key: Key('avis-${o.key}'),
                        contentPadding: EdgeInsets.zero,
                        value: o.key,
                        title: Text(o.value),
                      ),
                  ],
                ),
              ),
              if (_opinionError != null)
                Semantics(
                  liveRegion: true,
                  child: Text(
                    _opinionError!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              const SizedBox(height: SabouSpace.s3),
              TextFormField(
                key: const Key('constats'),
                controller: _notes,
                minLines: 5,
                maxLines: 12,
                maxLength: 5000,
                decoration: const InputDecoration(
                  labelText: 'Constats',
                  helperText: 'Lieu d’exercice, conservation des plantes, registre… Ce qui a été vu.',
                  helperMaxLines: 3,
                  alignLabelWithHint: true,
                ),
                validator: (v) => (v ?? '').trim().isEmpty
                    ? 'Décrivez ce que vous avez constaté.'
                    : null,
              ),
              const SizedBox(height: SabouSpace.s3),
              const SectionTitle('Photo de la fiche signée (facultatif)'),
              if (_photo != null)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(
                    Icons.check_circle,
                    semanticLabel: 'Prise',
                  ),
                  title: const Text('Photo gardée sur le téléphone'),
                  trailing: TextButton(
                    onPressed: _busy
                        ? null
                        : () => setState(() => _photo = null),
                    child: const Text(
                      'Retirer',
                      semanticsLabel: 'Retirer la photo de la fiche',
                    ),
                  ),
                )
              else ...[
                OutlinedButton.icon(
                  key: const Key('photo-fiche'),
                  onPressed: _busy ? null : () => _addPhoto(PhotoOrigin.camera),
                  icon: const Icon(Icons.photo_camera),
                  label: const Text(
                    'Prendre une photo',
                    semanticsLabel: 'Prendre une photo de la fiche signée',
                  ),
                ),
                const SizedBox(height: SabouSpace.s2),
                OutlinedButton.icon(
                  onPressed: _busy
                      ? null
                      : () => _addPhoto(PhotoOrigin.gallery),
                  icon: const Icon(Icons.photo_library),
                  label: const Text(
                    'Choisir dans la galerie',
                    semanticsLabel:
                        'Choisir la photo de la fiche dans la galerie',
                  ),
                ),
              ],
              const SizedBox(height: SabouSpace.s4),
              CheckboxListTile(
                key: const Key('attestation'),
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: _attested,
                onChanged: (v) => setState(() => _attested = v ?? false),
                title: const Text(
                  'J’atteste avoir réalisé cette visite et que ce compte rendu est exact. '
                  'Signé, il ne se modifie plus.',
                ),
              ),
              const SizedBox(height: SabouSpace.s3),
              FilledButton(
                key: const Key('signer'),
                onPressed: _busy ? null : _sign,
                child: const Text('Signer le compte rendu'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
