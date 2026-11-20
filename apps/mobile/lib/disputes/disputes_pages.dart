// Rubrique « Litiges » du praticien (US-101, §2.88) : recours dans les 30 jours d'un rejet
// définitif, litige ordinaire, échanges avec l'administration, pièces en photo, décision
// motivée. Textes en français ; les langues nationales restent en voix.
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../dossier/photo.dart';
import '../dossier/session.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'disputes_api.dart';

const _statusLabels = {
  'ouvert': 'Ouvert, en attente de l’administration',
  'en_arbitrage': 'En cours d’examen',
  'avis_rendu': 'Avis rendu, décision de la Direction Générale à venir',
  'resolu': 'Décidé',
};

String _two(int n) => n.toString().padLeft(2, '0');
String _date(DateTime d) {
  final l = d.toLocal();
  return '${_two(l.day)}/${_two(l.month)}/${l.year}';
}

String _dateTime(DateTime d) {
  final l = d.toLocal();
  return '${_date(l)} à ${_two(l.hour)} h ${_two(l.minute)}';
}

/// « 2026-12-14 » → « 14/12/2026 ».
String calendarDay(String iso) =>
    '${iso.substring(8, 10)}/${iso.substring(5, 7)}/${iso.substring(0, 4)}';

String _outcome(DisputeSummary d) => switch (d.issue) {
  'accepte' => d.recourse ? 'Recours accepté' : 'Demande acceptée',
  'refuse' => d.recourse ? 'Recours refusé' : 'Demande rejetée',
  _ => _statusLabels[d.status] ?? d.status,
};

class DisputesPage extends StatefulWidget {
  const DisputesPage({
    super.key,
    required this.api,
    required this.picker,
    required this.onSignedOut,
    this.prepare = preparePhotoInBackground,
  });

  final DisputesApi api;
  final PhotoPicker picker;
  final Future<Uint8List> Function(Uint8List) prepare;
  final VoidCallback onSignedOut;

  @override
  State<DisputesPage> createState() => _DisputesPageState();
}

class _DisputesPageState extends State<DisputesPage> {
  PractitionerDisputes? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.list();
      if (mounted) setState(() => (_data = data, _error = null));
    } on SignedOutException {
      widget.onSignedOut();
    } on DisputeException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } on Exception {
      if (mounted) {
        setState(
          () => _error = 'Vos litiges n’ont pas pu être chargés. Vérifiez le réseau, puis réessayez.',
        );
      }
    }
  }

  Future<void> _open({required bool recourse}) async {
    final code = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => DisputeOpenPage(api: widget.api, recourse: recourse),
      ),
    );
    if (code == null) return;
    await _load();
    if (mounted) await _show(code);
  }

  Future<void> _show(String code) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => DisputeDetailPage(
          api: widget.api,
          code: code,
          picker: widget.picker,
          prepare: widget.prepare,
          onSignedOut: widget.onSignedOut,
        ),
      ),
    );
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    if (data == null && _error == null) {
      return const LoadingView(label: 'Chargement de vos litiges');
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
          if (data != null && data.canAppeal) ...[
            StatusMessage(
              'Vous pouvez contester le rejet définitif de votre dossier jusqu’au '
              '${calendarDay(data.appealUntil!)}. Votre recours est examiné par '
              'l’administration régionale, puis décidé par la Direction Générale.',
              kind: StatusKind.warning,
            ),
            FilledButton(
              key: const Key('deposer-recours'),
              onPressed: () => _open(recourse: true),
              child: const Text('Déposer un recours'),
            ),
            const SizedBox(height: SabouSpace.s4),
          ],
          OutlinedButton(
            key: const Key('ouvrir-litige'),
            onPressed: () => _open(recourse: false),
            child: const Text('Ouvrir un litige'),
          ),
          const SizedBox(height: SabouSpace.s5),
          const SectionTitle('Mes litiges'),
          if (data != null && data.disputes.isEmpty)
            const Text('Aucun litige pour le moment.'),
          for (final d in data?.disputes ?? const <DisputeSummary>[])
            Card(
              margin: const EdgeInsets.only(bottom: SabouSpace.s3),
              child: ListTile(
                key: Key('litige-${d.code}'),
                minVerticalPadding: SabouSpace.s3,
                title: Text(d.subject),
                subtitle: Text(
                  '${d.recourse ? 'Recours' : 'Litige'} ${d.code} · ouvert le '
                  '${_date(d.openedAt)}\n${_outcome(d)}',
                ),
                isThreeLine: true,
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _show(d.code),
              ),
            ),
        ],
      ),
    );
  }
}

/// Ouverture d'un litige ou d'un recours ; la page se ferme avec le code du litige.
class DisputeOpenPage extends StatefulWidget {
  const DisputeOpenPage({super.key, required this.api, required this.recourse});

  final DisputesApi api;
  final bool recourse;

  @override
  State<DisputeOpenPage> createState() => _DisputeOpenPageState();
}

class _DisputeOpenPageState extends State<DisputeOpenPage> {
  final _formKey = GlobalKey<FormState>();
  late final _subject = TextEditingController(
    text: widget.recourse ? 'Contestation du rejet définitif' : '',
  );
  final _message = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _subject.dispose();
    _message.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => (_busy = true, _error = null));
    try {
      final code = await widget.api.open(
        recourse: widget.recourse,
        subject: _subject.text.trim(),
        message: _message.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(code);
      return;
    } on DisputeException catch (e) {
      _error = e.message;
    } on Exception {
      _error = 'L’envoi n’a pas abouti. Vérifiez le réseau, puis réessayez.';
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(widget.recourse ? 'Déposer un recours' : 'Ouvrir un litige'),
    ),
    body: SafeArea(
      child: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(SabouSpace.s4),
          children: [
            Text(
              widget.recourse
                  ? 'Expliquez pourquoi le rejet doit être revu. Vous pourrez ensuite joindre '
                        'des pièces en photo et répondre aux questions de l’administration.'
                  : 'Décrivez la décision ou la situation que vous contestez. L’administration '
                        'régionale l’examine et vous répond ici.',
            ),
            const SizedBox(height: SabouSpace.s4),
            if (_error != null) StatusMessage(_error!, kind: StatusKind.error),
            TextFormField(
              key: const Key('litige-objet'),
              controller: _subject,
              maxLength: 200,
              decoration: const InputDecoration(labelText: 'Objet'),
              validator: (v) => (v ?? '').trim().isEmpty
                  ? 'Indiquez l’objet du litige.'
                  : null,
            ),
            const SizedBox(height: SabouSpace.s3),
            TextFormField(
              key: const Key('litige-message'),
              controller: _message,
              minLines: 5,
              maxLines: 12,
              maxLength: 2000,
              decoration: const InputDecoration(
                labelText: 'Votre explication',
                alignLabelWithHint: true,
              ),
              validator: (v) => (v ?? '').trim().isEmpty
                  ? 'Expliquez ce que vous contestez.'
                  : null,
            ),
            const SizedBox(height: SabouSpace.s4),
            FilledButton(
              key: const Key('litige-envoyer'),
              onPressed: _busy ? null : _submit,
              child: Text(_busy ? 'Envoi en cours…' : 'Envoyer'),
            ),
          ],
        ),
      ),
    ),
  );
}

/// Litige : échanges, pièces, décision motivée.
class DisputeDetailPage extends StatefulWidget {
  const DisputeDetailPage({
    super.key,
    required this.api,
    required this.code,
    required this.picker,
    required this.prepare,
    required this.onSignedOut,
  });

  final DisputesApi api;
  final String code;
  final PhotoPicker picker;
  final Future<Uint8List> Function(Uint8List) prepare;
  final VoidCallback onSignedOut;

  @override
  State<DisputeDetailPage> createState() => _DisputeDetailPageState();
}

class _DisputeDetailPageState extends State<DisputeDetailPage> {
  final _text = TextEditingController();
  DisputeDetail? _detail;
  String? _message;
  StatusKind _kind = StatusKind.info;
  String? _fieldError;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final detail = await widget.api.detail(widget.code);
      if (mounted) setState(() => _detail = detail);
    } on SignedOutException {
      widget.onSignedOut();
    } on DisputeException catch (e) {
      _say(e.message, StatusKind.error);
    } on Exception {
      _say(
        'Le litige n’a pas pu être chargé. Vérifiez le réseau, puis réessayez.',
        StatusKind.error,
      );
    }
  }

  void _say(String text, StatusKind kind) {
    if (mounted) setState(() => (_message = text, _kind = kind));
  }

  Future<void> _act(Future<void> Function() work, String done) async {
    setState(() => _busy = true);
    try {
      await work();
      _say(done, StatusKind.success);
      await _load();
    } on SignedOutException {
      widget.onSignedOut();
    } on DisputeException catch (e) {
      _say(e.message, StatusKind.error);
    } on PhotoException catch (e) {
      _say(e.message, StatusKind.error);
    } on Exception {
      _say(
        'L’envoi n’a pas abouti. Vérifiez le réseau, puis réessayez.',
        StatusKind.error,
      );
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _send() async {
    final text = _text.text.trim();
    if (text.isEmpty) {
      setState(() => _fieldError = 'Écrivez votre message.');
      return;
    }
    setState(() => _fieldError = null);
    await _act(() async {
      await widget.api.message(widget.code, text);
      _text.clear();
    }, 'Message envoyé.');
  }

  Future<void> _addPhoto(PhotoOrigin origin) async {
    final original = await widget.picker.pick(origin);
    if (original == null) return;
    await _act(
      () async =>
          widget.api.addPiece(widget.code, await widget.prepare(original)),
      'Pièce jointe au litige.',
    );
  }

  @override
  Widget build(BuildContext context) {
    final d = _detail;
    return Scaffold(
      appBar: AppBar(title: Text('Litige ${widget.code}')),
      body: SafeArea(
        child: d == null && _message == null
            ? const LoadingView(label: 'Chargement du litige')
            : ListView(
                padding: const EdgeInsets.all(SabouSpace.s4),
                children: [
                  if (_message != null) StatusMessage(_message!, kind: _kind),
                  if (d != null) ..._content(context, d),
                ],
              ),
      ),
    );
  }

  List<Widget> _content(BuildContext context, DisputeDetail d) {
    final s = d.summary;
    final open = s.status != 'resolu';
    return [
      Text(s.subject, style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: SabouSpace.s1),
      Text(
        '${s.recourse ? 'Recours' : 'Litige'} · ouvert le ${_date(s.openedAt)}',
      ),
      const SizedBox(height: SabouSpace.s3),
      if (!open)
        StatusMessage(
          '${_outcome(s)}. ${d.decision ?? ''}'
          '${d.certificate == null ? '' : ' Nouveau certificat : ${d.certificate}.'}',
          kind: s.issue == 'accepte' ? StatusKind.success : StatusKind.warning,
        )
      else
        Text(
          _statusLabels[s.status] ?? s.status,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
      if (s.recourse && d.rejectionReason != null) ...[
        const SizedBox(height: SabouSpace.s3),
        Text('Motif du rejet contesté : ${d.rejectionReason}'),
      ],
      const SizedBox(height: SabouSpace.s4),
      const SectionTitle('Échanges'),
      for (final m in d.messages)
        Card(
          margin: const EdgeInsets.only(bottom: SabouSpace.s2),
          child: Padding(
            padding: const EdgeInsets.all(SabouSpace.s3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${m.fromPractitioner ? 'Vous' : 'Administration'} · ${_dateTime(m.at)}',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: SabouSpace.s1),
                Text(m.text),
              ],
            ),
          ),
        ),
      Text(
        d.pieces == 0
            ? 'Aucune pièce jointe.'
            : '${d.pieces} pièce${d.pieces > 1 ? 's' : ''} jointe${d.pieces > 1 ? 's' : ''}.',
      ),
      if (open) ...[
        const SizedBox(height: SabouSpace.s4),
        TextField(
          key: const Key('litige-reponse'),
          controller: _text,
          minLines: 3,
          maxLines: 8,
          maxLength: 2000,
          enabled: !_busy,
          decoration: InputDecoration(
            labelText: 'Votre message',
            errorText: _fieldError,
            alignLabelWithHint: true,
          ),
        ),
        FilledButton(
          key: const Key('litige-repondre'),
          onPressed: _busy ? null : _send,
          child: const Text('Envoyer le message'),
        ),
        const SizedBox(height: SabouSpace.s3),
        OutlinedButton.icon(
          key: const Key('litige-photo'),
          onPressed: _busy ? null : () => _addPhoto(PhotoOrigin.camera),
          icon: const Icon(Icons.photo_camera),
          label: const Text(
            'Joindre une photo',
            semanticsLabel: 'Joindre une photo au litige',
          ),
        ),
        const SizedBox(height: SabouSpace.s2),
        OutlinedButton.icon(
          onPressed: _busy ? null : () => _addPhoto(PhotoOrigin.gallery),
          icon: const Icon(Icons.photo_library),
          label: const Text(
            'Choisir dans la galerie',
            semanticsLabel: 'Choisir une photo dans la galerie pour le litige',
          ),
        ),
      ],
    ];
  }
}
