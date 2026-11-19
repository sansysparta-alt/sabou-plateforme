// Champ des parcours sans session (inscription US-066, mot de passe oublié US-069) : erreur
// sous le champ (annoncée par les lecteurs d'écran), aide sur plusieurs lignes, clé de test.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../ui/tokens.dart';

Widget publicFormField({
  required String keyPrefix,
  required String id,
  required TextEditingController controller,
  required String label,
  required bool enabled,
  String? error,
  String? hint,
  String? helper,
  TextInputType? keyboard,
  Iterable<String>? autofill,
  List<TextInputFormatter>? formatters,
  bool obscure = false,
  Widget? suffix,
  TextInputAction action = TextInputAction.next,
  VoidCallback? onSubmitted,
}) => Padding(
  padding: const EdgeInsets.only(bottom: SabouSpace.s4),
  child: TextField(
    key: Key('$keyPrefix-$id'),
    controller: controller,
    enabled: enabled,
    keyboardType: keyboard,
    autofillHints: autofill,
    inputFormatters: formatters,
    obscureText: obscure,
    autocorrect: false,
    enableSuggestions: !obscure,
    textInputAction: action,
    onSubmitted: onSubmitted == null ? null : (_) => onSubmitted(),
    decoration: InputDecoration(
      labelText: label,
      hintText: hint,
      helperText: helper,
      helperMaxLines: 3,
      errorText: error,
      errorMaxLines: 3,
      suffixIcon: suffix,
    ),
  ),
);
