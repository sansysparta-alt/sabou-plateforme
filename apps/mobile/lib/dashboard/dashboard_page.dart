// Rubrique « Accueil » du praticien (US-090, CdC §6.6, §2.90) : ses traitements par état, la
// frise de certification de son dernier dossier, son certificat. Textes en français ; les
// langues nationales restent en voix.
import 'package:flutter/material.dart';

import '../dossier/session.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'dashboard_api.dart';

/// Noms des 6 étapes (R-CER-01).
const stepNames = {
  1: 'Soumission du dossier',
  2: 'Vérification sur le terrain',
  3: 'Consolidation régionale',
  4: 'Expertise du Comité scientifique',
  5: 'Approbation de la Direction Générale',
  6: 'Publication',
};

String _two(int n) => n.toString().padLeft(2, '0');
String _date(DateTime d) {
  final l = d.toLocal();
  return '${_two(l.day)}/${_two(l.month)}/${l.year}';
}

/// « 2026-12-14 » → « 14/12/2026 ».
String _calendarDay(String iso) =>
    '${iso.substring(8, 10)}/${iso.substring(5, 7)}/${iso.substring(0, 4)}';

class DashboardPage extends StatefulWidget {
  const DashboardPage({
    super.key,
    required this.api,
    required this.onSignedOut,
  });

  final DashboardApi api;
  final VoidCallback onSignedOut;

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  PractitionerDashboard? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.load();
      if (mounted) setState(() => (_data = data, _error = null));
    } on SignedOutException {
      widget.onSignedOut();
    } on DashboardException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } on Exception {
      if (mounted) {
        setState(
          () => _error = 'Votre tableau de bord n’a pas pu être chargé. Vérifiez le réseau, puis réessayez.',
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    if (data == null && _error == null) {
      return const LoadingView(label: 'Chargement de votre tableau de bord');
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
          if (data != null) ...[
            const SectionTitle('Mes traitements'),
            Wrap(
              spacing: SabouSpace.s3,
              runSpacing: SabouSpace.s3,
              children: [
                _Tile('Certifiés', data.certified, 'En ligne sur le site'),
                _Tile('En examen', data.inReview, 'Auprès de l’administration'),
                _Tile('Brouillons', data.drafts, 'Dans votre Studio'),
                if (data.suspended > 0)
                  _Tile('Suspendus', data.suspended, 'Retirés du site'),
              ],
            ),
            const SizedBox(height: SabouSpace.s5),
            const SectionTitle('Ma certification'),
            if (data.certificate case final c?)
              StatusMessage(
                'Certificat ${c.number}, valable jusqu’au ${_calendarDay(c.expiresOn)}.',
                kind: StatusKind.success,
              ),
            if (data.dossier case final d?)
              _Timeline(d)
            else
              const Text(
                'Vous n’avez pas encore de dossier de certification. Ouvrez-le dans '
                'la rubrique « Mon dossier ».',
              ),
          ],
        ],
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile(this.label, this.value, this.detail);

  final String label;
  final int value;
  final String detail;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context).textTheme;
    // Deux tuiles par ligne sur téléphone ; la tuile s'agrandit avec le texte
    final width =
        (MediaQuery.sizeOf(context).width - SabouSpace.s4 * 2 - SabouSpace.s3) /
        2;
    return ConstrainedBox(
      constraints: BoxConstraints(
        minWidth: width,
        maxWidth: width < 140 ? double.infinity : width,
      ),
      child: Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(SabouSpace.s3),
          child: MergeSemantics(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: theme.labelLarge?.copyWith(
                    color: SabouColors.textMuted,
                  ),
                ),
                Text(
                  '$value',
                  style: theme.headlineMedium?.copyWith(
                    color: SabouColors.forest,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  detail,
                  style: theme.bodySmall?.copyWith(
                    color: SabouColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Frise des 6 étapes du dernier dossier.
class _Timeline extends StatelessWidget {
  const _Timeline(this.dossier);

  final DashboardDossier dossier;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Dossier ${dossier.code}', style: theme.titleSmall),
        const SizedBox(height: SabouSpace.s2),
        for (final step in dossier.steps)
          _StepRow(step, last: step.number == 6),
      ],
    );
  }
}

class _StepRow extends StatelessWidget {
  const _StepRow(this.step, {required this.last});

  final CertificationStep step;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final name = stepNames[step.number] ?? 'Étape ${step.number}';
    final at = step.at == null ? null : _date(step.at!);
    final (icon, color, state) = switch (step.state) {
      CertificationStepState.passed => (
        Icons.check_circle,
        SabouColors.action,
        at == null ? 'Franchie' : 'Franchie le $at',
      ),
      CertificationStepState.current => (
        Icons.radio_button_checked,
        SabouColors.gold,
        at == null ? 'En cours' : 'En cours depuis le $at',
      ),
      CertificationStepState.stopped => (
        Icons.cancel,
        SabouColors.error,
        'Dossier arrêté à cette étape',
      ),
      CertificationStepState.upcoming => (
        Icons.radio_button_unchecked,
        SabouColors.borderStrong,
        'À venir',
      ),
    };
    return MergeSemantics(
      child: Semantics(
        label: 'Étape ${step.number} sur 6',
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                children: [
                  Icon(icon, color: color, size: 24),
                  if (!last)
                    Expanded(
                      child: Container(width: 2, color: SabouColors.border),
                    ),
                ],
              ),
              const SizedBox(width: SabouSpace.s3),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: SabouSpace.s4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, style: Theme.of(context).textTheme.bodyLarge),
                      Text(
                        state,
                        style: Theme.of(context).textTheme.bodyMedium
                            ?.copyWith(color: SabouColors.textMuted),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
