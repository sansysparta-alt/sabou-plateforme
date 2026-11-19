// Rubrique « Mon dossier » du praticien (US-040b, UC-20) : fiche, pièces et soumission du
// dossier. La connexion et la barre du haut sont fournies par la coquille (US-018). Textes en français ; cibles tactiles de 48 px ; messages d'état annoncés aux
// lecteurs d'écran (WCAG 2.2 AA, CdC §8).
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../studio/studio_texts.dart' show shortDateTime;
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'dossier_api.dart';
import 'photo.dart';
import 'session.dart';

class DossierPage extends StatefulWidget {
  const DossierPage({
    super.key,
    required this.api,
    required this.picker,
    required this.prepare,
    required this.onSignedOut,
  });

  final DossierApi api;
  final PhotoPicker picker;
  final Future<Uint8List> Function(Uint8List) prepare;

  /// La session a expiré (30 jours sans ouvrir l'application) ou a été révoquée.
  final VoidCallback onSignedOut;

  @override
  State<DossierPage> createState() => _DossierPageState();
}

class _DossierPageState extends State<DossierPage> {
  Referentials? _lists;
  PractitionerView? _view;
  bool _loaded = false;
  String? _loadError;

  // Fiche en cours de saisie
  int? _specialty;
  int? _prefecture;
  int? _subPrefecture;
  String? _language;
  final _years = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  String? _busy;
  String? _message;
  bool _messageIsError = false;
  List<String> _missing = const [];
  Receipt? _receipt;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _years.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loadError = null);
    try {
      final results = await Future.wait([
        widget.api.referentials(),
        widget.api.view(),
      ]);
      final view = results[1] as PractitionerView?;
      // Déconnexion possible pendant le chargement (bouton de la coquille)
      if (!mounted) return;
      setState(() {
        _lists = results[0] as Referentials;
        _view = view;
        _loaded = true;
        _missing = view?.dossier?.missing ?? requiredPieces;
        if (view != null) {
          final p = view.profile;
          _specialty = p.specialtyId;
          _prefecture = p.prefectureId;
          _subPrefecture = p.subPrefectureId;
          _language = p.language;
          _years.text = '${p.yearsOfExperience}';
        }
      });
    } on SignedOutException {
      widget.onSignedOut();
    } on Exception {
      if (mounted) {
        setState(
          () => _loadError =
              'Le dossier n’a pas pu être chargé. Vérifiez le réseau.',
        );
      }
    }
  }

  /// Exécute une action ; affiche son résultat ou son refus, puis relit le dossier.
  Future<void> _run(String busy, Future<String?> Function() action) async {
    setState(() {
      _busy = busy;
      _message = null;
    });
    try {
      final done = await action();
      _message = done;
      _messageIsError = false;
      final view = await widget.api.view();
      _view = view;
      _missing = view?.dossier?.missing ?? requiredPieces;
    } on SignedOutException {
      widget.onSignedOut();
      return;
    } on DossierException catch (error) {
      _message = error.message;
      _messageIsError = true;
      if (error.missing.isNotEmpty) _missing = error.missing;
    } on PhotoException catch (error) {
      _message = error.message;
      _messageIsError = true;
    } on Exception {
      _message =
          'La demande n’a pas abouti. Vérifiez le réseau, puis réessayez.';
      _messageIsError = true;
    }
    if (mounted) setState(() => _busy = null);
  }

  bool get _editable => _view?.dossier?.editable ?? true;

  Future<void> _saveProfile() async {
    if (!_formKey.currentState!.validate()) return;
    final profile = Profile(
      specialtyId: _specialty!,
      prefectureId: _prefecture!,
      subPrefectureId: _subPrefecture,
      language: _language!,
      yearsOfExperience: int.parse(_years.text),
    );
    await _run('Enregistrement de la fiche…', () async {
      await widget.api.saveProfile(profile);
      return 'Fiche enregistrée.';
    });
  }

  Future<void> _addPhoto(String type, PhotoOrigin origin) async {
    final original = await widget.picker.pick(origin);
    if (original == null) return;
    await _run('Préparation et envoi de la photo…', () async {
      final jpeg = await widget.prepare(original);
      await widget.api.addPiece(type, jpeg);
      return '${pieceLabels[type]} ajoutée.';
    });
  }

  Future<void> _remove(Piece piece) => _run('Retrait de la pièce…', () async {
    await widget.api.removePiece(piece.id);
    return '${pieceLabels[piece.type]} retirée.';
  });

  Future<void> _submit() => _run('Envoi du dossier…', () async {
    final receipt = await widget.api.submit();
    _receipt = receipt;
    return null;
  });

  @override
  Widget build(BuildContext context) {
    final body = !_loaded
        ? (_loadError == null
              ? const LoadingView(label: 'Chargement du dossier')
              : ListView(
                  padding: const EdgeInsets.all(SabouSpace.s4),
                  children: [
                    StatusMessage(_loadError!, kind: StatusKind.error),
                    FilledButton(
                      onPressed: _load,
                      child: const Text('Réessayer'),
                    ),
                  ],
                ))
        : _content(context);
    return body;
  }

  Widget _content(BuildContext context) {
    final receipt = _receipt;
    final dossier = _view?.dossier;
    // Page courte : construite en entier (pas de liste paresseuse), défilement simple
    return SingleChildScrollView(
      padding: const EdgeInsets.all(SabouSpace.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // US-080 : consultation sans réseau, à partir de la copie du téléphone
          if (widget.api.offlineSince != null)
            StatusMessage(
              'Sans réseau : votre dossier tel qu’au '
              '${shortDateTime(widget.api.offlineSince!)}. Pour le modifier ou déposer '
              'une pièce, attendez le retour du réseau.',
            ),
          if (receipt != null)
            StatusMessage(
              kind: StatusKind.success,
              'Dossier ${receipt.code} bien reçu le ${_date(receipt.submittedAt)}. '
              'Il passe à l’étape 2 : la vérification sur le terrain. '
              'Un SMS de confirmation vous est envoyé.',
            )
          else if (dossier != null && !dossier.editable)
            StatusMessage(
              'Dossier ${dossier.code} en cours d’examen (étape ${dossier.step}). '
              'Il ne peut plus être modifié.',
            ),
          if (_busy != null) ...[
            const LinearProgressIndicator(),
            const SizedBox(height: SabouSpace.s2),
            StatusMessage(_busy!),
          ] else if (_message != null)
            StatusMessage(
              _message!,
              kind: _messageIsError ? StatusKind.error : StatusKind.success,
            ),
          const SectionTitle('Ma fiche'),
          _profileForm(),
          if (_view != null) ...[
            const SizedBox(height: SabouSpace.s6),
            const SectionTitle('Mes pièces'),
            // Ce qui reste à déposer : simple rappel, pas une erreur ; le refus du serveur, lui,
            // s'affiche en erreur si le praticien soumet un dossier incomplet
            if (_editable && _missing.isNotEmpty)
              StatusMessage(
                'Pièces à déposer : '
                '${_missing.map((m) => pieceLabels[m]?.toLowerCase() ?? m).join(', ')}.',
              ),
            for (final type in pieceLabels.keys) _pieceSection(type),
            if (_editable && receipt == null) ...[
              const SizedBox(height: SabouSpace.s5),
              FilledButton(
                onPressed: _busy == null ? _submit : null,
                child: const Text('Soumettre mon dossier'),
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _profileForm() {
    final lists = _lists!;
    final enabled = _editable && _busy == null;
    final subPrefectures = lists.subPrefectures
        .where((s) => s.prefectureId == _prefecture)
        .toList();
    // Message court sous la liste concernée, qui dit quoi choisir
    String? Function(Object?) required(String what) =>
        (value) => value == null ? 'Choisissez $what.' : null;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DropdownButtonFormField<int>(
            initialValue: _specialty,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Spécialité'),
            items: [
              for (final s in lists.specialties)
                DropdownMenuItem(value: s.id, child: Text(s.label)),
            ],
            onChanged: enabled ? (v) => setState(() => _specialty = v) : null,
            validator: required('la spécialité'),
          ),
          const SizedBox(height: SabouSpace.s3),
          DropdownButtonFormField<int>(
            initialValue: _prefecture,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Préfecture'),
            items: [
              for (final p in lists.prefectures)
                DropdownMenuItem(value: p.id, child: Text(p.label)),
            ],
            onChanged: enabled
                ? (v) => setState(() {
                    _prefecture = v;
                    _subPrefecture = null;
                  })
                : null,
            validator: required('la préfecture'),
          ),
          const SizedBox(height: SabouSpace.s3),
          DropdownButtonFormField<int?>(
            // Clé liée à la préfecture : la liste change avec elle
            key: ValueKey('sous-prefecture-$_prefecture'),
            initialValue: _subPrefecture,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'Sous-préfecture (facultatif)',
            ),
            items: [
              const DropdownMenuItem<int?>(
                value: null,
                child: Text('Non précisée'),
              ),
              for (final s in subPrefectures)
                DropdownMenuItem<int?>(value: s.id, child: Text(s.label)),
            ],
            onChanged: enabled
                ? (v) => setState(() => _subPrefecture = v)
                : null,
          ),
          const SizedBox(height: SabouSpace.s3),
          DropdownButtonFormField<String>(
            initialValue: _language,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Langue principale'),
            items: [
              for (final l in lists.languages)
                DropdownMenuItem(value: l.code, child: Text(l.name)),
            ],
            onChanged: enabled ? (v) => setState(() => _language = v) : null,
            validator: required('la langue principale'),
          ),
          const SizedBox(height: SabouSpace.s3),
          TextFormField(
            controller: _years,
            enabled: enabled,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(
              labelText: 'Années d’expérience',
              helperText: 'De 0 à 80',
            ),
            validator: (value) {
              final years = int.tryParse(value ?? '');
              return years == null || years > 80
                  ? 'Saisissez un nombre de 0 à 80.'
                  : null;
            },
          ),
          if (_editable) ...[
            const SizedBox(height: SabouSpace.s4),
            OutlinedButton(
              onPressed: enabled ? _saveProfile : null,
              child: const Text('Enregistrer la fiche'),
            ),
          ],
        ],
      ),
    );
  }

  Widget _pieceSection(String type) {
    final label = pieceLabels[type]!;
    final pieces = (_view?.dossier?.pieces ?? const <Piece>[])
        .where((p) => p.type == type)
        .toList();
    final enabled = _editable && _busy == null && _receipt == null;
    return Card(
      margin: const EdgeInsets.only(bottom: SabouSpace.s3),
      child: Padding(
        padding: const EdgeInsets.all(SabouSpace.s3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              requiredPieces.contains(type)
                  ? '$label (obligatoire)'
                  : '$label (facultatif)',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            for (final piece in pieces)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(
                  Icons.check_circle,
                  semanticLabel: 'Déposée',
                ),
                title: Text(_size(piece.size)),
                trailing: enabled
                    ? TextButton(
                        onPressed: () => _remove(piece),
                        child: Text(
                          'Retirer',
                          semanticsLabel: 'Retirer : $label',
                        ),
                      )
                    : null,
              ),
            if (enabled) ...[
              const SizedBox(height: SabouSpace.s2),
              OutlinedButton.icon(
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

  static String _size(int? bytes) => bytes == null
      ? 'Pièce déposée'
      : 'Pièce déposée (${(bytes / 1024).ceil()} Ko)';

  static String _date(DateTime date) {
    final d = date.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.day)}/${two(d.month)}/${d.year} à ${two(d.hour)} h ${two(d.minute)}';
  }
}
