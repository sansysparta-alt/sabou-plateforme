// Dossiers de terrain (US-004) : l'agent saisit avec ou sans réseau ; l'écran dit si les
// saisies sont arrivées au serveur et prévient l'agent d'un conflit (R-DON-04).
import 'package:flutter/material.dart';
import 'package:powersync/powersync.dart' show SyncStatus;

import 'saisie_store.dart';

class SaisiePage extends StatelessWidget {
  const SaisiePage({super.key, required this.store});

  final SaisieStore store;

  Future<void> _edit(BuildContext context, [Saisie? saisie]) async {
    final contenu = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(builder: (_) => SaisieForm(initial: saisie?.contenu)),
    );
    if (contenu == null) return;
    if (saisie == null) {
      await store.create(contenu);
    } else {
      await store.update(saisie.id, contenu);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Dossiers de terrain')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _edit(context),
        icon: const Icon(Icons.add),
        label: const Text('Nouveau dossier'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            _SyncBanner(
              status: store.db.statusStream,
              pending: store.watchPending(),
            ),
            StreamBuilder<List<Avis>>(
              stream: store.watchAvis(),
              builder: (context, snapshot) => Column(
                children: [
                  for (final avis in snapshot.data ?? const <Avis>[])
                    Card(
                      color: Theme.of(context).colorScheme.tertiaryContainer,
                      child: ListTile(
                        leading: const Icon(Icons.info_outline),
                        title: Text(avis.message),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            StreamBuilder<List<Saisie>>(
              stream: store.watchAll(),
              builder: (context, snapshot) {
                final saisies = snapshot.data ?? const <Saisie>[];
                if (snapshot.hasData && saisies.isEmpty) {
                  return const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Text('Aucun dossier pour l’instant.'),
                  );
                }
                return Column(
                  children: [
                    for (final saisie in saisies)
                      Card(
                        child: ListTile(
                          title: Text(
                            saisie.contenu['praticien'] as String? ??
                                'Sans nom',
                          ),
                          subtitle: Text(_statusLabel(saisie)),
                          // Un dossier validé ne se modifie plus sur le téléphone
                          onTap: saisie.statut == 'valide'
                              ? null
                              : () => _edit(context, saisie),
                        ),
                      ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  static String _statusLabel(Saisie saisie) {
    if (saisie.statut == 'valide') return 'Validé';
    if (saisie.origineId != null) return 'Brouillon (copie après conflit)';
    if (saisie.version == null) return 'Brouillon, pas encore sur le serveur';
    return 'Brouillon';
  }
}

class _SyncBanner extends StatelessWidget {
  const _SyncBanner({required this.status, required this.pending});

  final Stream<SyncStatus> status;
  final Stream<int> pending;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<SyncStatus>(
      stream: status,
      builder: (context, statusSnapshot) => StreamBuilder<int>(
        stream: pending,
        builder: (context, pendingSnapshot) {
          final connected = statusSnapshot.data?.connected ?? false;
          final waiting = pendingSnapshot.data ?? 0;
          final text = connected
              ? (waiting == 0
                    ? 'Connecté : tout est sur le serveur.'
                    : 'Connecté : envoi de $waiting modification(s)…')
              : 'Hors réseau : vos saisies sont gardées sur le téléphone'
                    '${waiting == 0 ? '.' : ' ($waiting en attente).'}';
          return Semantics(
            liveRegion: true,
            child: Row(
              children: [
                Icon(connected ? Icons.cloud_done : Icons.cloud_off),
                const SizedBox(width: 8),
                Expanded(child: Text(text)),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// Saisie du dossier entier ; renvoie son contenu, ou rien si l'agent annule.
class SaisieForm extends StatefulWidget {
  const SaisieForm({super.key, this.initial});

  final Map<String, dynamic>? initial;

  @override
  State<SaisieForm> createState() => _SaisieFormState();
}

class _SaisieFormState extends State<SaisieForm> {
  final _formKey = GlobalKey<FormState>();
  late final _praticien = TextEditingController(
    text: widget.initial?['praticien'] as String?,
  );
  late final _notes = TextEditingController(
    text: widget.initial?['notes'] as String?,
  );

  @override
  void dispose() {
    _praticien.dispose();
    _notes.dispose();
    super.dispose();
  }

  void _save() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.of(context).pop({
      ...?widget.initial,
      'praticien': _praticien.text.trim(),
      'notes': _notes.text.trim(),
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.initial == null ? 'Nouveau dossier' : 'Modifier le dossier',
        ),
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              TextFormField(
                controller: _praticien,
                decoration: const InputDecoration(labelText: 'Praticien'),
                textInputAction: TextInputAction.next,
                validator: (value) => (value ?? '').trim().isEmpty
                    ? 'Indiquez le nom du praticien.'
                    : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _notes,
                decoration: const InputDecoration(labelText: 'Notes de visite'),
                minLines: 3,
                maxLines: 8,
              ),
              const SizedBox(height: 24),
              FilledButton(onPressed: _save, child: const Text('Enregistrer')),
            ],
          ),
        ),
      ),
    );
  }
}
