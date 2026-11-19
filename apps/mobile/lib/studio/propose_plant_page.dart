// US-054 : le praticien propose une plante qui manque au Dictionnaire. Décision du maître
// d'œuvre du 18 novembre 2026 : nom français obligatoire ; nom scientifique, famille et
// description facultatifs. La plante est créée « en revue » ; le Comité scientifique complète
// son identité botanique et la valide (US-051, US-055). Renvoie la plante créée.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../dossier/session.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'studio_api.dart';
import 'studio_texts.dart';

/// Bornes de packages/types/src/plants.ts.
const plantNameMax = 150;
const plantScientificNameMax = 150;
const plantFamilyMax = 100;
const plantDescriptionMax = 1000;

class ProposePlantPage extends StatefulWidget {
  const ProposePlantPage({
    super.key,
    required this.api,
    required this.onSignedOut,
  });

  final StudioApi api;
  final VoidCallback onSignedOut;

  @override
  State<ProposePlantPage> createState() => _ProposePlantPageState();
}

class _ProposePlantPageState extends State<ProposePlantPage> {
  final _nameFr = TextEditingController();
  final _scientific = TextEditingController();
  final _family = TextEditingController();
  final _description = TextEditingController();
  String? _nameError;
  String? _message;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_nameFr, _scientific, _family, _description]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    if (_nameFr.text.trim().isEmpty) {
      setState(() => _nameError = 'Indiquez le nom de la plante en français.');
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final plant = await widget.api.proposePlant(
        nameFr: _nameFr.text.trim(),
        scientificName: _scientific.text.trim(),
        family: _family.text.trim(),
        description: _description.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(plant);
      return;
    } on SignedOutException {
      if (mounted) Navigator.of(context).pop();
      widget.onSignedOut();
      return;
    } on StudioException catch (error) {
      _message = error.message;
    } on Exception {
      _message = networkError;
    }
    if (mounted) setState(() => _busy = false);
  }

  Widget _field(
    String id,
    TextEditingController controller,
    String label,
    int max, {
    String? helper,
    String? error,
    int lines = 1,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: SabouSpace.s3),
    child: TextField(
      key: Key('proposer-$id'),
      controller: controller,
      enabled: !_busy,
      minLines: lines,
      maxLines: lines == 1 ? 1 : null,
      inputFormatters: [LengthLimitingTextInputFormatter(max)],
      onChanged: id == 'nomFr' && _nameError != null
          ? (_) => setState(() => _nameError = null)
          : null,
      decoration: InputDecoration(
        labelText: label,
        helperText: helper,
        helperMaxLines: 3,
        errorText: error,
        errorMaxLines: 3,
        alignLabelWithHint: lines > 1,
      ),
    ),
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Proposer une plante')),
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(SabouSpace.s4),
        children: [
          const Text(
            'La plante sera examinée par le Comité scientifique. Vous pouvez déjà l’ajouter à '
            'vos traitements ; ils ne seront certifiés qu’après sa validation.',
          ),
          const SizedBox(height: SabouSpace.s4),
          if (_message != null)
            StatusMessage(_message!, kind: StatusKind.error),
          _field(
            'nomFr',
            _nameFr,
            'Nom en français',
            plantNameMax,
            error: _nameError,
          ),
          _field(
            'nomScientifique',
            _scientific,
            'Nom scientifique (facultatif)',
            plantScientificNameMax,
            helper: 'Si vous le connaissez. Sinon, le Comité le complétera.',
          ),
          _field('famille', _family, 'Famille (facultatif)', plantFamilyMax),
          _field(
            'description',
            _description,
            'Description (facultatif)',
            plantDescriptionMax,
            helper:
                'Où elle pousse, à quoi elle ressemble, la partie utilisée…',
            lines: 3,
          ),
          if (_busy) ...[
            const LinearProgressIndicator(),
            const SizedBox(height: SabouSpace.s3),
          ],
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: const Text('Envoyer la proposition'),
          ),
        ],
      ),
    ),
  );
}
