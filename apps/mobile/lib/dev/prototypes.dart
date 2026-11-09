// Prototypes de S0, gardés pour le développement seulement (US-018) : Studio d'essai de la
// chaîne audio (US-005) et dossiers de terrain saisis hors réseau (US-004). Ils ne
// paraissent pas dans la version publiée : le bouton n'existe qu'en version de
// développement (voir [devToolsButton]).
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';

import '../audio_io.dart';
import '../essai_api.dart';
import '../studio_page.dart';
import '../sync/saisie_device.dart';
import '../sync/saisie_page.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';

/// Bouton des prototypes dans la barre du haut, ou null hors version de développement.
Widget? devToolsButton({required bool debug}) =>
    debug ? const _PrototypesButton() : null;

class _PrototypesButton extends StatelessWidget {
  const _PrototypesButton();

  @override
  Widget build(BuildContext context) => IconButton(
    icon: const Icon(Icons.science_outlined),
    color: SabouColors.onDark,
    tooltip: 'Prototypes (développement)',
    onPressed: () => Navigator.of(context)
        .push(MaterialPageRoute<void>(builder: (_) => const _PrototypesPage())),
  );
}

class _PrototypesPage extends StatelessWidget {
  const _PrototypesPage();

  @override
  Widget build(BuildContext context) {
    void open(Widget page) =>
        Navigator.of(context)
            .push(MaterialPageRoute<void>(builder: (_) => page));
    return Scaffold(
      appBar: AppBar(title: const Text('Prototypes')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(SabouSpace.s4),
          children: [
            const StatusMessage(
              'Version de développement : ces écrans ne figurent pas dans '
              'l’application publiée.',
              kind: StatusKind.warning,
            ),
            OutlinedButton(
              onPressed: () => open(const _SaisieLoader()),
              child: const Text('Dossiers de terrain'),
            ),
            const SizedBox(height: SabouSpace.s4),
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
            body: LoadingView(label: 'Ouverture de la base du téléphone'),
          );
        }
        return SaisiePage(store: store);
      },
    );
  }
}
