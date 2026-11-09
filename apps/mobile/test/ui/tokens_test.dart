// US-018, critère 1 : le thème de l'application reprend les jetons de la charte de
// packages/ui/src/tokens.css (US-016), source unique. Une valeur changée d'un seul côté
// fait échouer ce test (le job Flutter se déclenche aussi sur tokens.css).
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/ui/theme.dart';
import 'package:sabou_mobile/ui/tokens.dart';

/// Variables `--sabou-*` du fichier CSS, valeur brute.
Map<String, String> cssTokens() {
  final css = File('../../packages/ui/src/tokens.css').readAsStringSync();
  final root = css.substring(0, css.indexOf('}'));
  return {
    for (final m in RegExp(
      r'--sabou-([a-z0-9-]+):\s*([^;]+);',
    ).allMatches(root))
      m.group(1)!: m.group(2)!.trim(),
  };
}

Color hex(String value) =>
    Color(int.parse('FF${value.substring(1).toUpperCase()}', radix: 16));

double px(String value) => value.endsWith('rem')
    ? double.parse(value.replaceFirst('rem', '')) * 16
    : double.parse(value.replaceFirst('px', ''));

void main() {
  final css = cssTokens();

  test(
    'chaque couleur de la charte est celle de tokens.css, et toutes y sont',
    () {
      final cssColors = {
        for (final e in css.entries)
          if (RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(e.value)) e.key: e.value,
      };
      expect(cssColors.keys.toSet(), SabouColors.css.keys.toSet());
      for (final e in SabouColors.css.entries) {
        expect(e.value, hex(cssColors[e.key]!), reason: '--sabou-${e.key}');
      }
    },
  );

  test('espacements, rayons et tailles de texte identiques à tokens.css', () {
    for (final table in [SabouSpace.css, SabouRadius.css, SabouText.css]) {
      for (final e in table.entries) {
        expect(css, contains(e.key), reason: '--sabou-${e.key} absent');
        expect(e.value, px(css[e.key]!), reason: '--sabou-${e.key}');
      }
    }
  });

  test('le thème emploie les couleurs selon les règles de la charte', () {
    final theme = sabouTheme();
    expect(theme.colorScheme.primary, SabouColors.institution);
    expect(theme.appBarTheme.backgroundColor, SabouColors.forest);
    expect(theme.scaffoldBackgroundColor, SabouColors.bg);
    expect(theme.colorScheme.outline, SabouColors.borderStrong);
    // Vert action : jamais pour du texte (contraste 3,5:1)
    expect([
      theme.colorScheme.primary,
      theme.colorScheme.onSurface,
      theme.colorScheme.onSurfaceVariant,
      theme.colorScheme.onPrimaryContainer,
    ], isNot(contains(SabouColors.action)));
  });
}
