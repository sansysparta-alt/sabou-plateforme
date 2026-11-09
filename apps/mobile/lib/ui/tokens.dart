// Jetons de la charte SABOU (CdC §10) pour l'application mobile (US-018).
// Source unique : packages/ui/src/tokens.css (base de design de US-016). Les valeurs sont
// recopiées ici, et test/ui/tokens_test.dart vérifie qu'elles sont identiques à celles du
// fichier CSS : une couleur changée d'un côté sans l'autre fait échouer le pipeline.
// Aucun écran n'écrit de couleur, d'espacement ou de rayon en dur : il passe par ces jetons
// ou par le thème (theme.dart).
import 'package:flutter/painting.dart';

/// Couleurs de la charte et leurs règles d'emploi (mêmes noms que les variables CSS).
abstract final class SabouColors {
  /// Bandeaux, barre du haut, fonds sombres.
  static const forest = Color(0xFF0B3D2E);

  /// Titres, boutons principaux, éléments actifs, liens.
  static const institution = Color(0xFF0F6B4F);

  /// Graphiques et indicateurs uniquement, jamais du texte (contraste 3,5:1).
  static const action = Color(0xFF1F9B72);

  /// Fonds de cartes, onglets, puces ; repère de l'onglet actif.
  static const mint = Color(0xFFCFE9DB);

  /// Fonds clairs.
  static const mist = Color(0xFFE6F4EC);

  /// Accents ; en texte seulement sur Vert forêt.
  static const gold = Color(0xFFC9A227);

  static const text = Color(0xFF17201C);
  static const textMuted = Color(0xFF4A5551);
  static const bg = Color(0xFFF5F7F6);
  static const surface = Color(0xFFFFFFFF);

  /// Séparateurs décoratifs.
  static const border = Color(0xFFDCE3E0);

  /// Contours de champs : 3:1 au moins (WCAG 1.4.11).
  static const borderStrong = Color(0xFF6B7672);
  static const onDark = Color(0xFFFFFFFF);
  static const onDarkMuted = Color(0xFFCFE9DB);

  static const info = Color(0xFF1D4F91);
  static const infoBg = Color(0xFFEEF4FB);
  static const infoBorder = Color(0xFFC3D6EE);
  static const success = Color(0xFF0F6B4F);
  static const successBg = Color(0xFFE6F4EC);
  static const successBorder = Color(0xFFB5DCC6);
  static const warning = Color(0xFF7A4B00);
  static const warningBg = Color(0xFFFDF6E3);
  static const warningBorder = Color(0xFFECD9A4);
  static const error = Color(0xFFB42318);
  static const errorBg = Color(0xFFFDF1F0);
  static const errorBorder = Color(0xFFF4C7C3);
  static const focus = Color(0xFF1D4F91);

  /// Correspondance avec les variables CSS, pour le test d'alignement.
  static const Map<String, Color> css = {
    'forest': forest,
    'institution': institution,
    'action': action,
    'mint': mint,
    'mist': mist,
    'gold': gold,
    'text': text,
    'text-muted': textMuted,
    'bg': bg,
    'surface': surface,
    'border': border,
    'border-strong': borderStrong,
    'on-dark': onDark,
    'on-dark-muted': onDarkMuted,
    'info': info,
    'info-bg': infoBg,
    'info-border': infoBorder,
    'success': success,
    'success-bg': successBg,
    'success-border': successBorder,
    'warning': warning,
    'warning-bg': warningBg,
    'warning-border': warningBorder,
    'error': error,
    'error-bg': errorBg,
    'error-border': errorBorder,
    'focus': focus,
  };
}

/// Espacements (pixels logiques ; 1 rem = 16 px).
abstract final class SabouSpace {
  static const s1 = 4.0;
  static const s2 = 8.0;
  static const s3 = 12.0;
  static const s4 = 16.0;
  static const s5 = 24.0;
  static const s6 = 32.0;
  static const s7 = 48.0;
  static const s8 = 64.0;

  static const Map<String, double> css = {
    'space-1': s1,
    'space-2': s2,
    'space-3': s3,
    'space-4': s4,
    'space-5': s5,
    'space-6': s6,
    'space-7': s7,
    'space-8': s8,
  };
}

/// Rayons des angles.
abstract final class SabouRadius {
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;

  static const Map<String, double> css = {
    'radius-sm': sm,
    'radius-md': md,
    'radius-lg': lg,
  };
}

/// Tailles de texte.
abstract final class SabouText {
  /// Légendes.
  static const xs = 13.0;
  static const sm = 14.0;

  /// Texte courant.
  static const md = 16.0;
  static const lg = 18.0;
  static const xl = 22.0;

  /// Titre de page.
  static const xxl = 28.0;

  static const Map<String, double> css = {
    'text-xs': xs,
    'text-sm': sm,
    'text-md': md,
    'text-lg': lg,
    'text-xl': xl,
    'text-2xl': xxl,
  };
}

/// Cible tactile minimale de l'application : 48 px (repère Android ; CdC §8 : 40 px au
/// moins). Plus large que les 44 px du web, le doigt sur un téléphone étant moins précis
/// que le pointeur.
const double sabouTarget = 48;
