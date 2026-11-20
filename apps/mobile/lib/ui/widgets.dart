// Composants réutilisables de l'application mobile (US-018). Chaque écran les assemble au
// lieu de recréer ses propres messages, chargements et titres (catalogue : README.md).
import 'package:flutter/material.dart';

import 'tokens.dart';

/// Nature d'un message d'état. La couleur n'est jamais seule : le texte dit l'état.
enum StatusKind { info, success, warning, error }

/// Message d'état, annoncé par les lecteurs d'écran dès qu'il paraît ou change.
class StatusMessage extends StatelessWidget {
  const StatusMessage(this.text, {super.key, this.kind = StatusKind.info});

  final String text;
  final StatusKind kind;

  @override
  Widget build(BuildContext context) {
    final (fg, bg, border, icon) = switch (kind) {
      StatusKind.info => (
        SabouColors.info,
        SabouColors.infoBg,
        SabouColors.infoBorder,
        Icons.info_outline,
      ),
      StatusKind.success => (
        SabouColors.success,
        SabouColors.successBg,
        SabouColors.successBorder,
        Icons.check_circle_outline,
      ),
      StatusKind.warning => (
        SabouColors.warning,
        SabouColors.warningBg,
        SabouColors.warningBorder,
        Icons.warning_amber_outlined,
      ),
      StatusKind.error => (
        SabouColors.error,
        SabouColors.errorBg,
        SabouColors.errorBorder,
        Icons.error_outline,
      ),
    };
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(SabouSpace.s3),
        margin: const EdgeInsets.only(bottom: SabouSpace.s4),
        decoration: BoxDecoration(
          color: bg,
          border: Border.all(color: border),
          borderRadius: BorderRadius.circular(SabouRadius.sm),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ExcludeSemantics(child: Icon(icon, color: fg, size: 20)),
            const SizedBox(width: SabouSpace.s2),
            Expanded(
              child: Text(text, style: TextStyle(color: fg)),
            ),
          ],
        ),
      ),
    );
  }
}

/// Chargement en cours, avec un libellé lu par les lecteurs d'écran.
class LoadingView extends StatelessWidget {
  const LoadingView({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Center(
    child: Semantics(label: label, child: const CircularProgressIndicator()),
  );
}

/// Titre d'une section d'écran, signalé comme titre aux lecteurs d'écran.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: SabouSpace.s2),
    child: Semantics(
      header: true,
      child: Text(text, style: Theme.of(context).textTheme.titleLarge),
    ),
  );
}

/// Écran sans contenu à montrer (rubrique pas encore ouverte, accès refusé…), avec une
/// action éventuelle.
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.actions = const [],
  });

  final IconData icon;
  final String title;
  final String message;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(SabouSpace.s5),
      children: [
        const SizedBox(height: SabouSpace.s6),
        ExcludeSemantics(
          child: Icon(
            icon,
            size: SabouSpace.s7,
            color: SabouColors.institution,
          ),
        ),
        const SizedBox(height: SabouSpace.s4),
        Semantics(
          header: true,
          child: Text(
            title,
            textAlign: TextAlign.center,
            style: theme.textTheme.headlineSmall,
          ),
        ),
        const SizedBox(height: SabouSpace.s3),
        Text(message, textAlign: TextAlign.center),
        for (final action in actions) ...[
          const SizedBox(height: SabouSpace.s4),
          action,
        ],
      ],
    );
  }
}

/// En-tête d'une saisie en plusieurs étapes : « Étape 2 sur 6 », barre d'avancement et titre
/// de l'étape. Une idée par écran : les longs formulaires sont découpés (ergonomie, MOE
/// 20/11). Le changement d'étape est annoncé aux lecteurs d'écran.
class StepHeader extends StatelessWidget {
  const StepHeader({
    super.key,
    required this.index,
    required this.count,
    required this.title,
  });

  /// Étape affichée, à partir de 0.
  final int index;
  final int count;
  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final position = 'Étape ${index + 1} sur $count';
    return Semantics(
      liveRegion: true,
      container: true,
      label: '$position : $title',
      child: ExcludeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              position,
              style: theme.textTheme.labelLarge?.copyWith(
                color: SabouColors.textMuted,
              ),
            ),
            const SizedBox(height: SabouSpace.s2),
            ClipRRect(
              borderRadius: BorderRadius.circular(SabouRadius.sm),
              child: LinearProgressIndicator(
                value: (index + 1) / count,
                minHeight: 6,
                color: SabouColors.action,
                backgroundColor: SabouColors.mint,
              ),
            ),
            const SizedBox(height: SabouSpace.s4),
            SectionTitle(title),
          ],
        ),
      ),
    );
  }
}

/// Barre du bas d'une saisie en étapes : « Précédent » (absent à la première étape) et
/// l'action principale de l'étape (« Suivant », ou l'envoi à la dernière). Toujours visible,
/// au-dessus du clavier, pour qu'on ne cherche jamais le bouton au bas d'une longue page.
class StepNavigation extends StatelessWidget {
  const StepNavigation({super.key, this.onPrevious, required this.primary});

  /// Null à la première étape : le bouton n'est pas affiché.
  final VoidCallback? onPrevious;
  final Widget primary;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      color: SabouColors.surface,
      border: Border(top: BorderSide(color: SabouColors.border)),
    ),
    child: Padding(
      padding: const EdgeInsets.fromLTRB(
        SabouSpace.s4,
        SabouSpace.s3,
        SabouSpace.s4,
        SabouSpace.s3,
      ),
      child: Row(
        children: [
          if (onPrevious != null) ...[
            Expanded(
              child: OutlinedButton(
                onPressed: onPrevious,
                child: const Text('Précédent'),
              ),
            ),
            const SizedBox(width: SabouSpace.s3),
          ],
          Expanded(child: primary),
        ],
      ),
    ),
  );
}
