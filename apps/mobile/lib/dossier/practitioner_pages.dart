// Écrans du praticien (US-040b, UC-20) : connexion, puis fiche, pièces et soumission du
// dossier. Textes en français ; cibles tactiles de 48 px ; messages d'état annoncés aux
// lecteurs d'écran (WCAG 2.2 AA, CdC §8).
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'dossier_api.dart';
import 'photo.dart';
import 'session.dart';

/// Ouvre une adresse dans le navigateur du téléphone ; remplaçable dans les tests.
typedef OpenUrl = Future<void> Function(Uri url);

/// Porte d'entrée : la connexion, ou le dossier si une session est gardée sur le téléphone.
class PractitionerHome extends StatefulWidget {
  const PractitionerHome({
    super.key,
    required this.session,
    required this.api,
    required this.picker,
    required this.openUrl,
    required this.signupUrl,
    this.prepare = preparePhotoInBackground,
  });

  final PractitionerSession session;
  final DossierApi api;
  final PhotoPicker picker;
  final OpenUrl openUrl;
  final Uri signupUrl;
  final Future<Uint8List> Function(Uint8List) prepare;

  @override
  State<PractitionerHome> createState() => _PractitionerHomeState();
}

class _PractitionerHomeState extends State<PractitionerHome> {
  bool? _signedIn;

  @override
  void initState() {
    super.initState();
    widget.session.hasSession().then((value) {
      if (mounted) setState(() => _signedIn = value);
    });
  }

  void _set(bool value) => setState(() => _signedIn = value);

  @override
  Widget build(BuildContext context) {
    return switch (_signedIn) {
      null => const _Loading(label: 'Ouverture…'),
      false => LoginPage(
        session: widget.session,
        openUrl: widget.openUrl,
        signupUrl: widget.signupUrl,
        onSignedIn: () => _set(true),
      ),
      true => DossierPage(
        api: widget.api,
        picker: widget.picker,
        prepare: widget.prepare,
        onSignOut: () async {
          await widget.session.signOut();
          _set(false);
        },
        onSignedOut: () => _set(false),
      ),
    };
  }
}

class _Loading extends StatelessWidget {
  const _Loading({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Mon dossier')),
    body: Center(
      child: Semantics(label: label, child: const CircularProgressIndicator()),
    ),
  );
}

/// Message d'état annoncé par les lecteurs d'écran dès qu'il change.
class _Status extends StatelessWidget {
  const _Status(this.text, {this.error = false});
  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        margin: const EdgeInsets.only(bottom: 16),
        decoration: BoxDecoration(
          color: error ? colors.errorContainer : colors.secondaryContainer,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          text,
          style: TextStyle(
            color: error
                ? colors.onErrorContainer
                : colors.onSecondaryContainer,
          ),
        ),
      ),
    );
  }
}

class LoginPage extends StatefulWidget {
  const LoginPage({
    super.key,
    required this.session,
    required this.openUrl,
    required this.signupUrl,
    required this.onSignedIn,
  });

  final PractitionerSession session;
  final OpenUrl openUrl;
  final Uri signupUrl;
  final VoidCallback onSignedIn;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  bool _busy = false;
  String? _error;

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (await widget.session.signIn()) {
        widget.onSignedIn();
        return;
      }
    } on Exception {
      _error =
          'La connexion n’a pas abouti. Vérifiez le réseau, puis réessayez.';
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mon dossier')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Dossier de certification',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            const Text(
              'Connectez-vous avec votre numéro de téléphone et votre mot de passe '
              'pour remplir et envoyer votre dossier.',
            ),
            const SizedBox(height: 24),
            if (_error != null) _Status(_error!, error: true),
            FilledButton(
              onPressed: _busy ? null : _signIn,
              child: Text(_busy ? 'Connexion en cours…' : 'Se connecter'),
            ),
            const SizedBox(height: 24),
            const Text('Pas encore de compte ?'),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: () => widget.openUrl(widget.signupUrl),
              child: const Text('Créer un compte sur le site SABOU'),
            ),
          ],
        ),
      ),
    );
  }
}

class DossierPage extends StatefulWidget {
  const DossierPage({
    super.key,
    required this.api,
    required this.picker,
    required this.prepare,
    required this.onSignOut,
    required this.onSignedOut,
  });

  final DossierApi api;
  final PhotoPicker picker;
  final Future<Uint8List> Function(Uint8List) prepare;
  final Future<void> Function() onSignOut;

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
              ? Center(
                  child: Semantics(
                    label: 'Chargement du dossier',
                    child: const CircularProgressIndicator(),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _Status(_loadError!, error: true),
                    FilledButton(
                      onPressed: _load,
                      child: const Text('Réessayer'),
                    ),
                  ],
                ))
        : _content(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mon dossier'),
        actions: [
          TextButton(
            onPressed: _busy == null ? widget.onSignOut : null,
            child: const Text('Se déconnecter'),
          ),
        ],
      ),
      body: SafeArea(child: body),
    );
  }

  Widget _content(BuildContext context) {
    final receipt = _receipt;
    final dossier = _view?.dossier;
    final title = Theme.of(context).textTheme.titleLarge;
    // Page courte : construite en entier (pas de liste paresseuse), défilement simple
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (receipt != null)
            _Status(
              'Dossier ${receipt.code} bien reçu le ${_date(receipt.submittedAt)}. '
              'Il passe à l’étape 2 : la vérification sur le terrain. '
              'Un SMS de confirmation vous est envoyé.',
            )
          else if (dossier != null && !dossier.editable)
            _Status(
              'Dossier ${dossier.code} en cours d’examen (étape ${dossier.step}). '
              'Il ne peut plus être modifié.',
            ),
          if (_busy != null) ...[
            const LinearProgressIndicator(),
            const SizedBox(height: 8),
            _Status(_busy!),
          ] else if (_message != null)
            _Status(_message!, error: _messageIsError),
          Text('Ma fiche', style: title),
          const SizedBox(height: 8),
          _profileForm(),
          if (_view != null) ...[
            const SizedBox(height: 32),
            Text('Mes pièces', style: title),
            const SizedBox(height: 8),
            if (_editable && _missing.isNotEmpty)
              _Status(
                'Pièces obligatoires manquantes : '
                '${_missing.map((m) => pieceLabels[m]?.toLowerCase() ?? m).join(', ')}.',
                error: true,
              ),
            for (final type in pieceLabels.keys) _pieceSection(type),
            if (_editable && receipt == null) ...[
              const SizedBox(height: 24),
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
    String? required(Object? value) =>
        value == null ? 'Choisissez une valeur.' : null;
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
            validator: required,
          ),
          const SizedBox(height: 12),
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
            validator: required,
          ),
          const SizedBox(height: 12),
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
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _language,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Langue principale'),
            items: [
              for (final l in lists.languages)
                DropdownMenuItem(value: l.code, child: Text(l.name)),
            ],
            onChanged: enabled ? (v) => setState(() => _language = v) : null,
            validator: required,
          ),
          const SizedBox(height: 12),
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
                  ? 'L’expérience se compte en années, de 0 à 80.'
                  : null;
            },
          ),
          if (_editable) ...[
            const SizedBox(height: 16),
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
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
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
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () => _addPhoto(type, PhotoOrigin.camera),
                icon: const Icon(Icons.photo_camera),
                label: Text(
                  'Prendre une photo',
                  semanticsLabel: 'Prendre une photo : $label',
                ),
              ),
              const SizedBox(height: 8),
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
