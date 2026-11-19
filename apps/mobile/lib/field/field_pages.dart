// Rubriques de l'agent préfectoral sur le terrain (US-082, §2.86) :
// - « Numériser » : praticiens de sa préfecture ; le Studio du praticien choisi s'ouvre avec
//   les mêmes écrans que le sien. La voix par champ n'est proposée qu'après la case « accord
//   du praticien » ; chaque praticien a sur le téléphone sa propre copie chiffrée et son
//   propre coffre de voix (une voix ne part jamais au nom d'un autre praticien).
// - « Dossiers » : dossier de praticien constitué sans réseau (identité, spécialité,
//   localité, pièces et photo), envoyé au retour du réseau.
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../dossier/photo.dart';
import '../dossier/session.dart';
import '../signup/signup_rules.dart';
import '../studio/studio_api.dart';
import '../studio/studio_offline.dart';
import '../studio/studio_pages.dart';
import '../studio/voice_field.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'field_api.dart';

/// Outils du Studio propres à un praticien : API sous /api/terrain/praticiens/PR-…, copie
/// chiffrée et coffre de voix à part.
class FieldStudioTools {
  const FieldStudioTools({required this.api, this.store, this.voiceTools});
  final StudioApi api;
  final StudioStore? store;
  final VoiceTools? voiceTools;
}

typedef FieldStudioFactory = Future<FieldStudioTools> Function(
  String practitionerCode,
);

const _statusLabels = {
  'en_attente': 'Certification en cours',
  'certifie': 'Certifié',
  'suspendu': 'Suspendu',
};

class FieldPractitionersPage extends StatefulWidget {
  const FieldPractitionersPage({
    super.key,
    required this.api,
    required this.studioFor,
    required this.onSignedOut,
  });

  final FieldApi api;
  final FieldStudioFactory studioFor;
  final VoidCallback onSignedOut;

  @override
  State<FieldPractitionersPage> createState() => _FieldPractitionersPageState();
}

class _FieldPractitionersPageState extends State<FieldPractitionersPage> {
  Fetched<List<FieldPractitioner>>? _list;
  bool _loading = true;
  String? _error;

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
      _list = await widget.api.practitioners();
      if (_list == null) {
        _error =
            'La liste des praticiens n’a pas encore été reçue. Ouvrez cette rubrique une '
            'fois avec le réseau : elle restera ensuite disponible sans réseau.';
      }
    } on SignedOutException {
      widget.onSignedOut();
      return;
    } on FieldException catch (e) {
      _error = e.message;
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _open(FieldPractitioner practitioner) async {
    final consent = await showDialog<bool>(
      context: context,
      builder: (_) => _VoiceConsentDialog(practitioner: practitioner),
    );
    if (consent == null || !mounted) return;
    final tools = await widget.studioFor(practitioner.code);
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          appBar: AppBar(title: Text(practitioner.name)),
          body: SafeArea(
            child: TreatmentsPage(
              api: tools.api,
              onSignedOut: widget.onSignedOut,
              // Voix seulement avec l'accord du praticien (décision du 19 novembre 2026)
              voiceTools: consent ? tools.voiceTools : null,
              store: tools.store,
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _list == null) {
      return const LoadingView(label: 'Chargement des praticiens');
    }
    final list = _list;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(SabouSpace.s4),
        children: [
          const Text(
            'Choisissez le praticien dont vous numérisez la recette. Elle est enregistrée à '
            'son nom, avec la mention de votre saisie ; un autre agent la vérifiera.',
          ),
          const SizedBox(height: SabouSpace.s4),
          if (_error != null) ...[
            StatusMessage(_error!, kind: StatusKind.error),
            OutlinedButton(onPressed: _load, child: const Text('Réessayer')),
          ],
          if (list != null && list.fromCopy)
            const StatusMessage(
              'Sans réseau : liste gardée sur le téléphone lors de la dernière connexion.',
            ),
          if (list != null && list.value.isEmpty)
            const Text('Aucun praticien dans votre préfecture pour le moment.'),
          for (final p in list?.value ?? const <FieldPractitioner>[])
            Card(
              margin: const EdgeInsets.only(bottom: SabouSpace.s3),
              child: ListTile(
                key: Key('praticien-${p.code}'),
                minVerticalPadding: SabouSpace.s3,
                title: Text(p.name),
                subtitle: Text(
                  '${p.code} · ${_statusLabels[p.status] ?? p.status}',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _open(p),
              ),
            ),
        ],
      ),
    );
  }
}

/// Case « accord du praticien » : cochée, la voix par champ est proposée ; sinon, saisie du
/// texte seulement. Fermer la fenêtre n'ouvre rien.
class _VoiceConsentDialog extends StatefulWidget {
  const _VoiceConsentDialog({required this.practitioner});
  final FieldPractitioner practitioner;

  @override
  State<_VoiceConsentDialog> createState() => _VoiceConsentDialogState();
}

class _VoiceConsentDialogState extends State<_VoiceConsentDialog> {
  bool _agreed = false;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text('Recette de ${widget.practitioner.name}'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'La voix du praticien peut être enregistrée pour chaque champ, dans sa langue. '
          'Demandez-lui son accord avant d’enregistrer.',
        ),
        const SizedBox(height: SabouSpace.s3),
        CheckboxListTile(
          key: const Key('accord-praticien'),
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          value: _agreed,
          onChanged: (v) => setState(() => _agreed = v ?? false),
          title: const Text('Le praticien accepte l’enregistrement de sa voix'),
        ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Annuler'),
      ),
      FilledButton(
        key: const Key('ouvrir-studio'),
        onPressed: () => Navigator.of(context).pop(_agreed),
        child: Text(_agreed ? 'Ouvrir, avec la voix' : 'Ouvrir, texte seul'),
      ),
    ],
  );
}

/// Dossiers constitués sur le terrain, gardés sur le téléphone jusqu'à leur envoi.
class FieldDossiersPage extends StatefulWidget {
  const FieldDossiersPage({
    super.key,
    required this.api,
    required this.picker,
    required this.onSignedOut,
    this.prepare = preparePhotoInBackground,
    this.newId,
  });

  final FieldApi api;
  final PhotoPicker picker;
  final Future<Uint8List> Function(Uint8List) prepare;
  final VoidCallback onSignedOut;

  /// Identifiant local d'un nouveau brouillon ; remplaçable dans les tests.
  final String Function()? newId;

  @override
  State<FieldDossiersPage> createState() => _FieldDossiersPageState();
}

class _FieldDossiersPageState extends State<FieldDossiersPage> {
  List<FieldDraft>? _drafts;
  final _sent = <String>[];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final drafts = await widget.api.store.drafts();
    if (mounted) setState(() => _drafts = drafts);
  }

  Future<void> _open(FieldDraft? draft) async {
    final sent = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => FieldDossierFormPage(
          api: widget.api,
          picker: widget.picker,
          prepare: widget.prepare,
          onSignedOut: widget.onSignedOut,
          draft:
              draft ??
              FieldDraft(
                id:
                    widget.newId?.call() ??
                    DateTime.now().microsecondsSinceEpoch.toString(),
                fields: {},
              ),
        ),
      ),
    );
    if (sent != null) _sent.add(sent);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final drafts = _drafts;
    if (drafts == null) return const LoadingView(label: 'Chargement');
    return ListView(
      padding: const EdgeInsets.all(SabouSpace.s4),
      children: [
        const Text(
          'Constituez le dossier d’un praticien sur place, même sans réseau : il reste '
          'chiffré sur le téléphone jusqu’à son envoi.',
        ),
        const SizedBox(height: SabouSpace.s4),
        for (final code in _sent)
          StatusMessage(
            'Dossier $code envoyé : il passe à la vérification par un autre agent.',
            kind: StatusKind.success,
          ),
        FilledButton.icon(
          key: const Key('nouveau-dossier'),
          onPressed: () => _open(null),
          icon: const Icon(Icons.add),
          label: const Text('Nouveau dossier'),
        ),
        const SizedBox(height: SabouSpace.s5),
        const SectionTitle('Sur le téléphone'),
        if (drafts.isEmpty) const Text('Aucun dossier en attente d’envoi.'),
        for (final d in drafts)
          Card(
            margin: const EdgeInsets.only(bottom: SabouSpace.s3),
            child: ListTile(
              key: Key('brouillon-${d.id}'),
              minVerticalPadding: SabouSpace.s3,
              title: Text(d.displayName),
              subtitle: Text(
                d.code == null
                    ? 'Pas encore envoyé'
                    : 'Envoi commencé (${d.code}) : à terminer',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _open(d),
            ),
          ),
      ],
    );
  }
}

/// Formulaire du dossier terrain : gardé sur le téléphone à chaque enregistrement, envoyé
/// quand l'agent le décide ; ferme la page avec le code du dossier soumis.
class FieldDossierFormPage extends StatefulWidget {
  const FieldDossierFormPage({
    super.key,
    required this.api,
    required this.picker,
    required this.prepare,
    required this.onSignedOut,
    required this.draft,
  });

  final FieldApi api;
  final PhotoPicker picker;
  final Future<Uint8List> Function(Uint8List) prepare;
  final VoidCallback onSignedOut;
  final FieldDraft draft;

  @override
  State<FieldDossierFormPage> createState() => _FieldDossierFormPageState();
}

class _FieldDossierFormPageState extends State<FieldDossierFormPage> {
  final _formKey = GlobalKey<FormState>();
  late final _firstName = TextEditingController(
    text: widget.draft.fields['prenom'] as String?,
  );
  late final _lastName = TextEditingController(
    text: widget.draft.fields['nom'] as String?,
  );
  late final _phone = TextEditingController(
    text: widget.draft.fields['telephone'] as String?,
  );
  late final _years = TextEditingController(
    text: widget.draft.fields['anneesExperience']?.toString(),
  );
  late int? _speciality = widget.draft.fields['specialiteId'] as int?;
  late int? _subPrefecture = widget.draft.fields['sousPrefectureId'] as int?;
  late String? _language = widget.draft.fields['languePrincipale'] as String?;

  FieldReferentials? _refs;
  bool _refsLoaded = false;
  String? _busy;
  String? _message;
  StatusKind _messageKind = StatusKind.info;

  // Le serveur a créé le dossier : l'identité ne se modifie plus depuis le téléphone
  bool get _identityLocked => widget.draft.code != null;

  @override
  void initState() {
    super.initState();
    _loadReferentials();
  }

  @override
  void dispose() {
    _firstName.dispose();
    _lastName.dispose();
    _phone.dispose();
    _years.dispose();
    super.dispose();
  }

  Future<void> _loadReferentials() async {
    try {
      _refs = await widget.api.referentials();
    } on SignedOutException {
      widget.onSignedOut();
      return;
    } on FieldException catch (e) {
      _say(e.message, StatusKind.error);
    }
    if (mounted) setState(() => _refsLoaded = true);
  }

  void _say(String text, StatusKind kind) {
    _message = text;
    _messageKind = kind;
  }

  bool _collect() {
    if (!_formKey.currentState!.validate()) return false;
    widget.draft.fields = {
      'telephone': toNationalMobile(_phone.text),
      'prenom': _firstName.text.trim(),
      'nom': _lastName.text.trim(),
      'specialiteId': _speciality,
      'sousPrefectureId': _subPrefecture,
      'languePrincipale': _language,
      'anneesExperience': int.parse(_years.text.trim()),
    };
    return true;
  }

  Future<void> _keep() async {
    if (!_identityLocked && !_collect()) return;
    await widget.api.store.saveDraft(widget.draft);
    setState(() => _say('Dossier gardé sur le téléphone.', StatusKind.success));
  }

  Future<void> _addPhoto(String type, PhotoOrigin origin) async {
    final original = await widget.picker.pick(origin);
    if (original == null) return;
    setState(() => _busy = 'Préparation de la photo…');
    try {
      final jpeg = await widget.prepare(original);
      await widget.api.store.savePiece(widget.draft, type, jpeg);
      widget.draft.pieces.add(type);
      widget.draft.sentPieces.remove(type);
      await widget.api.store.saveDraft(widget.draft);
      _say('${fieldPieceLabels[type]} ajoutée.', StatusKind.success);
    } on PhotoException catch (e) {
      _say(e.message, StatusKind.error);
    }
    if (mounted) setState(() => _busy = null);
  }

  Future<void> _removePhoto(String type) async {
    await widget.api.store.deletePiece(widget.draft, type);
    widget.draft.pieces.remove(type);
    await widget.api.store.saveDraft(widget.draft);
    setState(() => _say('${fieldPieceLabels[type]} retirée.', StatusKind.info));
  }

  Future<void> _send() async {
    if (!_identityLocked && !_collect()) return;
    await widget.api.store.saveDraft(widget.draft);
    setState(() {
      _busy = 'Envoi du dossier…';
      _message = null;
    });
    try {
      final code = await widget.api.send(widget.draft);
      if (mounted) Navigator.of(context).pop(code);
      return;
    } on SignedOutException {
      widget.onSignedOut();
      return;
    } on FieldException catch (e) {
      _say(e.message, e.definitive ? StatusKind.error : StatusKind.warning);
    } on Exception {
      _say(
        'Pas de réseau : le dossier reste chiffré sur le téléphone. Envoyez-le au retour '
        'du réseau.',
        StatusKind.warning,
      );
    }
    if (mounted) setState(() => _busy = null);
  }

  Future<void> _discard() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Abandonner ce dossier ?'),
        content: const Text(
          'Les informations et les photos gardées sur le téléphone seront effacées.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Garder'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Abandonner'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await widget.api.store.removeDraft(widget.draft);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final refs = _refs;
    final enabled = _busy == null;
    return Scaffold(
      appBar: AppBar(title: const Text('Dossier terrain')),
      body: SafeArea(
        child: !_refsLoaded
            ? const LoadingView(label: 'Chargement du formulaire')
            : refs == null
            ? ListView(
                padding: const EdgeInsets.all(SabouSpace.s4),
                children: [
                  StatusMessage(
                    _message ??
                        'Le formulaire n’a pas encore été reçu. Ouvrez-le une fois avec '
                            'le réseau : il restera ensuite disponible sans réseau.',
                    kind: StatusKind.error,
                  ),
                ],
              )
            : Form(
                key: _formKey,
                child: ListView(
                  padding: const EdgeInsets.all(SabouSpace.s4),
                  children: [
                    if (_message != null)
                      StatusMessage(_message!, kind: _messageKind),
                    if (_busy != null) LoadingView(label: _busy!),
                    SectionTitle('Identité · préfecture de ${refs.prefecture}'),
                    if (_identityLocked)
                      Text(
                        '${widget.draft.displayName} · dossier ${widget.draft.code} '
                        'créé sur le serveur.',
                      )
                    else ...[
                      _text(
                        _firstName,
                        'Prénom',
                        'prenom',
                        (v) => _name(v, firstNameMax),
                      ),
                      _text(
                        _lastName,
                        'Nom',
                        'nom',
                        (v) => _name(v, lastNameMax),
                      ),
                      _text(
                        _phone,
                        'Téléphone du praticien',
                        'telephone',
                        (v) => toNationalMobile(v ?? '') == null
                            ? 'Numéro mobile guinéen attendu (9 chiffres commençant par 6).'
                            : null,
                        keyboard: TextInputType.phone,
                        helper: 'Le praticien reçoit un SMS pour définir son mot de passe.',
                      ),
                      _dropdown<int>(
                        'Spécialité',
                        'specialite',
                        _speciality,
                        refs.specialities,
                        (v) => _speciality = v,
                        required: true,
                      ),
                      _dropdown<int>(
                        'Sous-préfecture (localité, facultatif)',
                        'sous-prefecture',
                        _subPrefecture,
                        refs.subPrefectures,
                        (v) => _subPrefecture = v,
                      ),
                      _dropdown<String>(
                        'Langue principale',
                        'langue',
                        _language,
                        refs.languages,
                        (v) => _language = v,
                        required: true,
                      ),
                      _text(_years, 'Années d’expérience', 'annees', (v) {
                        final n = int.tryParse((v ?? '').trim());
                        return n == null || n < 0 || n > 80
                            ? 'L’expérience se compte en années, de 0 à 80.'
                            : null;
                      }, keyboard: TextInputType.number),
                    ],
                    const SizedBox(height: SabouSpace.s3),
                    const SectionTitle('Pièces'),
                    for (final type in fieldPieceLabels.keys)
                      _pieceCard(type, enabled),
                    const SizedBox(height: SabouSpace.s4),
                    FilledButton(
                      key: const Key('envoyer-dossier'),
                      onPressed: enabled ? _send : null,
                      child: const Text('Envoyer le dossier'),
                    ),
                    const SizedBox(height: SabouSpace.s2),
                    OutlinedButton(
                      key: const Key('garder-dossier'),
                      onPressed: enabled ? _keep : null,
                      child: const Text('Garder sur le téléphone'),
                    ),
                    if (!_identityLocked) ...[
                      const SizedBox(height: SabouSpace.s2),
                      TextButton(
                        onPressed: enabled ? _discard : null,
                        child: const Text('Abandonner ce dossier'),
                      ),
                    ],
                  ],
                ),
              ),
      ),
    );
  }

  static String? _name(String? value, int max) =>
      switch (nameIssue(value ?? '', max)) {
        null => null,
        NameIssue.empty => 'Champ obligatoire.',
        NameIssue.tooLong => '$max caractères au plus.',
        NameIssue.notLetters =>
          'Lettres, espaces, apostrophes et tirets seulement.',
      };

  Widget _text(
    TextEditingController controller,
    String label,
    String id,
    String? Function(String?) validator, {
    TextInputType? keyboard,
    String? helper,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: SabouSpace.s4),
    child: TextFormField(
      key: Key('terrain-$id'),
      controller: controller,
      enabled: _busy == null,
      keyboardType: keyboard,
      autocorrect: false,
      validator: validator,
      decoration: InputDecoration(
        labelText: label,
        helperText: helper,
        helperMaxLines: 3,
        errorMaxLines: 3,
      ),
    ),
  );

  Widget _dropdown<T>(
    String label,
    String id,
    T? value,
    List<Labelled> options,
    void Function(T?) onChanged, {
    bool required = false,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: SabouSpace.s4),
    child: DropdownButtonFormField<T>(
      key: Key('terrain-$id'),
      initialValue: options.any((o) => o.id == value) ? value : null,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [
        if (!required) DropdownMenuItem<T>(child: const Text('Non précisée')),
        for (final o in options)
          DropdownMenuItem<T>(value: o.id as T, child: Text(o.label)),
      ],
      validator: required
          ? (v) => v == null ? 'Champ obligatoire.' : null
          : null,
      onChanged: _busy == null ? (v) => setState(() => onChanged(v)) : null,
    ),
  );

  Widget _pieceCard(String type, bool enabled) {
    final label = fieldPieceLabels[type]!;
    final taken = widget.draft.pieces.contains(type);
    final editable = enabled && !widget.draft.sentPieces.contains(type);
    return Card(
      margin: const EdgeInsets.only(bottom: SabouSpace.s3),
      child: Padding(
        padding: const EdgeInsets.all(SabouSpace.s3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              requiredFieldPieces.contains(type)
                  ? '$label (obligatoire)'
                  : '$label (facultatif)',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (taken)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.check_circle, semanticLabel: 'Prise'),
                title: Text(
                  widget.draft.sentPieces.contains(type)
                      ? 'Photo envoyée'
                      : 'Photo gardée sur le téléphone',
                ),
                trailing: editable
                    ? TextButton(
                        onPressed: () => _removePhoto(type),
                        child: Text(
                          'Retirer',
                          semanticsLabel: 'Retirer : $label',
                        ),
                      )
                    : null,
              )
            else if (editable) ...[
              const SizedBox(height: SabouSpace.s2),
              OutlinedButton.icon(
                key: Key('photo-$type'),
                onPressed: () => _addPhoto(type, PhotoOrigin.camera),
                icon: const Icon(Icons.photo_camera),
                label: Text(
                  'Prendre une photo',
                  semanticsLabel: 'Prendre une photo : $label',
                ),
              ),
              const SizedBox(height: SabouSpace.s2),
              OutlinedButton.icon(
                onPressed: () => _addPhoto(type, PhotoOrigin.gallery),
                icon: const Icon(Icons.photo_library),
                label: Text(
                  'Choisir dans la galerie',
                  semanticsLabel: 'Choisir dans la galerie : $label',
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
