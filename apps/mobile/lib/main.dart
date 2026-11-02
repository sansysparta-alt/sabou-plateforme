// Application mobile SABOU : squelette du récit US-005 (Studio d'essai de la chaîne audio).
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:path_provider/path_provider.dart';

import 'audio_io.dart';
import 'essai_api.dart';
import 'studio_page.dart';

/// Vert de la charte SABOU, contraste suffisant avec le blanc (WCAG 2.2 AA).
const Color sabouGreen = Color(0xFF1B6E3A);

void main() {
  runApp(const SabouApp());
}

class SabouApp extends StatelessWidget {
  const SabouApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SABOU',
      // Textes en français (et en anglais) ; les langues nationales sont en voix seulement
      supportedLocales: const [Locale('fr'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: sabouGreen),
        // Cibles tactiles d'au moins 48 px (CdC §8 : 40 px au moins)
        materialTapTargetSize: MaterialTapTargetSize.padded,
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(48),
          ),
        ),
      ),
      home: StudioPage(
        recorder: DeviceVoiceRecorder(),
        player: DeviceVoicePlayer(),
        api: EssaiApi(baseUrl: Uri.parse(defaultEssaiUrl)),
        sdkInt: () async =>
            (await DeviceInfoPlugin().androidInfo).version.sdkInt,
        tempDir: getTemporaryDirectory,
      ),
    );
  }
}
