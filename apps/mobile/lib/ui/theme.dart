// Thème de l'application mobile (US-018), construit sur les jetons de la charte. Les écrans
// prennent leurs couleurs et leurs styles ici (Theme.of(context)), jamais en dur.
// Polices : celles du téléphone (aucune police téléchargée, réseau 3G). Titres de page en
// police à empattements du système, comme le Cambria de la charte ; le reste en police
// sans empattements du système, comme le Calibri de la charte (05_Choix_Techniques §2.30).
import 'package:flutter/material.dart';

import 'tokens.dart';

/// Famille à empattements fournie par Android (Noto Serif).
const _serif = 'serif';

ThemeData sabouTheme() {
  const scheme = ColorScheme(
    brightness: Brightness.light,
    primary: SabouColors.institution,
    onPrimary: SabouColors.onDark,
    primaryContainer: SabouColors.mist,
    onPrimaryContainer: SabouColors.forest,
    secondary: SabouColors.forest,
    onSecondary: SabouColors.onDark,
    secondaryContainer: SabouColors.mint,
    onSecondaryContainer: SabouColors.forest,
    tertiary: SabouColors.gold,
    onTertiary: SabouColors.forest,
    error: SabouColors.error,
    onError: SabouColors.onDark,
    errorContainer: SabouColors.errorBg,
    onErrorContainer: SabouColors.error,
    surface: SabouColors.surface,
    onSurface: SabouColors.text,
    onSurfaceVariant: SabouColors.textMuted,
    surfaceContainerLowest: SabouColors.surface,
    surfaceContainerLow: SabouColors.surface,
    surfaceContainer: SabouColors.surface,
    surfaceContainerHigh: SabouColors.bg,
    surfaceContainerHighest: SabouColors.bg,
    outline: SabouColors.borderStrong,
    outlineVariant: SabouColors.border,
  );

  const text = TextTheme(
    headlineMedium: TextStyle(
      fontFamily: _serif,
      fontSize: SabouText.xxl,
      fontWeight: FontWeight.w700,
      height: 1.25,
      color: SabouColors.forest,
    ),
    headlineSmall: TextStyle(
      fontFamily: _serif,
      fontSize: SabouText.xl,
      fontWeight: FontWeight.w700,
      height: 1.25,
      color: SabouColors.forest,
    ),
    titleLarge: TextStyle(
      fontSize: SabouText.lg,
      fontWeight: FontWeight.w600,
      height: 1.25,
      color: SabouColors.text,
    ),
    titleMedium: TextStyle(
      fontSize: SabouText.md,
      fontWeight: FontWeight.w600,
      height: 1.25,
      color: SabouColors.text,
    ),
    bodyLarge: TextStyle(
      fontSize: SabouText.md,
      height: 1.5,
      color: SabouColors.text,
    ),
    bodyMedium: TextStyle(
      fontSize: SabouText.md,
      height: 1.5,
      color: SabouColors.text,
    ),
    bodySmall: TextStyle(
      fontSize: SabouText.xs,
      height: 1.5,
      color: SabouColors.textMuted,
    ),
    labelLarge: TextStyle(fontSize: SabouText.md, fontWeight: FontWeight.w600),
    labelMedium: TextStyle(fontSize: SabouText.sm, fontWeight: FontWeight.w600),
  );

  final buttonShape = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(SabouRadius.sm),
  );
  const buttonPadding = EdgeInsets.symmetric(
    horizontal: SabouSpace.s4,
    vertical: SabouSpace.s3,
  );
  OutlineInputBorder field(Color color, [double width = 1]) =>
      OutlineInputBorder(
        borderRadius: BorderRadius.circular(SabouRadius.sm),
        borderSide: BorderSide(color: color, width: width),
      );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    textTheme: text,
    scaffoldBackgroundColor: SabouColors.bg,
    // Cibles tactiles de 48 px au moins
    materialTapTargetSize: MaterialTapTargetSize.padded,
    visualDensity: VisualDensity.standard,
    appBarTheme: const AppBarTheme(
      backgroundColor: SabouColors.forest,
      foregroundColor: SabouColors.onDark,
      elevation: 0,
      scrolledUnderElevation: 0,
      titleTextStyle: TextStyle(
        fontSize: SabouText.lg,
        fontWeight: FontWeight.w600,
        color: SabouColors.onDark,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: SabouColors.surface,
      indicatorColor: SabouColors.mint,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      height: 64,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          color: states.contains(WidgetState.selected)
              ? SabouColors.forest
              : SabouColors.textMuted,
        ),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: SabouText.sm,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w700
              : FontWeight.w400,
          color: states.contains(WidgetState.selected)
              ? SabouColors.forest
              : SabouColors.textMuted,
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(sabouTarget),
        shape: buttonShape,
        padding: buttonPadding,
        textStyle: text.labelLarge,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(sabouTarget),
        shape: buttonShape,
        padding: buttonPadding,
        foregroundColor: SabouColors.institution,
        side: const BorderSide(color: SabouColors.institution),
        textStyle: text.labelLarge,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(sabouTarget, sabouTarget),
        shape: buttonShape,
        foregroundColor: SabouColors.institution,
        textStyle: text.labelLarge,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: SabouColors.surface,
      border: field(SabouColors.borderStrong),
      enabledBorder: field(SabouColors.borderStrong),
      focusedBorder: field(SabouColors.focus, 2),
      errorBorder: field(SabouColors.error),
      focusedErrorBorder: field(SabouColors.error, 2),
      labelStyle: const TextStyle(color: SabouColors.textMuted),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: SabouSpace.s3,
        vertical: SabouSpace.s3,
      ),
    ),
    cardTheme: CardThemeData(
      color: SabouColors.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(SabouRadius.md),
        side: const BorderSide(color: SabouColors.border),
      ),
    ),
    dividerTheme: const DividerThemeData(color: SabouColors.border),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: SabouColors.institution,
      linearTrackColor: SabouColors.mint,
    ),
  );
}
