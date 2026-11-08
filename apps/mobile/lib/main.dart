// Application mobile SABOU : prototypes de US-005 (Studio d'essai de la chaîne audio) et de
// US-004 (dossiers de terrain saisis hors réseau).
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:path_provider/path_provider.dart';

import 'package:url_launcher/url_launcher.dart';

import 'audio_io.dart';
import 'dossier/config.dart';
import 'dossier/dossier_api.dart';
import 'dossier/photo.dart';
import 'dossier/practitioner_pages.dart';
import 'dossier/session.dart';
import 'sync/database_key.dart' show DeviceSecretStore;
import 'essai_api.dart';
import 'studio_page.dart';
import 'sync/saisie_device.dart';
import 'sync/saisie_page.dart';

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
      home: const AccueilPage(),
    );
  }
}

class AccueilPage extends StatelessWidget {
  const AccueilPage({super.key});

  @override
  Widget build(BuildContext context) {
    void open(Widget page) =>
        Navigator.of(context)
            .push(MaterialPageRoute<void>(builder: (_) => page));
    return Scaffold(
      appBar: AppBar(title: const Text('SABOU')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            FilledButton(
              onPressed: () => open(practitionerHome()),
              child: const Text('Mon dossier de praticien'),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => open(const _SaisieLoader()),
              child: const Text('Dossiers de terrain'),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => open(
                StudioPage(
                  recorder: DeviceVoiceRecorder(),
                  player: DeviceVoicePlayer(),
                  api: EssaiApi(baseUrl: Uri.parse(defaultEssaiUrl)),
                  sdkInt: () async =>
                      (await DeviceInfoPlugin().androidInfo).version.sdkInt,
                  tempDir: getTemporaryDirectory,
                ),
              ),
              child: const Text('Studio (essai)'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Dossier du praticien (US-040b) avec les services du téléphone.
Widget practitionerHome() {
  final session = PractitionerSession(
    store: DeviceSecretStore(),
    launcher: AppAuthLoginLauncher(),
  );
  return PractitionerHome(
    session: session,
    api: DossierApi(baseUrl: Uri.parse(practitionerApiUrl), session: session),
    picker: DevicePhotoPicker(),
    openUrl: (url) => launchUrl(url, mode: LaunchMode.externalApplication),
    signupUrl: Uri.parse('$publicSiteUrl/inscription'),
  );
}

class _SaisieLoader extends StatelessWidget {
  const _SaisieLoader();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder(
      future: deviceSaisieStore(),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return const Scaffold(
            body: Center(
              child: Text('La base du téléphone n’a pas pu être ouverte.'),
            ),
          );
        }
        final store = snapshot.data;
        if (store == null) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        return SaisiePage(store: store);
      },
    );
  }
}
