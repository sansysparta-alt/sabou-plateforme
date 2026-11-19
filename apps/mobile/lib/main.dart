// Application mobile SABOU, réservée aux praticiens et aux agents préfectoraux de terrain
// (CdC §1.3). Socle (US-018) : thème de la charte, composants communs, navigation selon le
// profil ; les rubriques sont déclarées dans app.dart.
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:url_launcher/url_launcher.dart';

import 'app.dart';
import 'dev/prototypes.dart';
import 'dossier/config.dart';
import 'dossier/dossier_api.dart';
import 'dossier/photo.dart';
import 'dossier/session.dart';
import 'shell/gate.dart';
import 'signup/signup_api.dart';
import 'studio/studio_api.dart';
import 'studio/voice_device.dart';
import 'studio/voice_field.dart';
import 'sync/database_key.dart' show DeviceSecretStore;
import 'ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // US-081 : micro, haut-parleur et coffre chiffré des voix en attente
  final voiceTools = await deviceVoiceTools();
  runApp(SabouApp(voiceTools: voiceTools));
}

class SabouApp extends StatefulWidget {
  const SabouApp({super.key, this.voiceTools});

  final VoiceTools? voiceTools;

  @override
  State<SabouApp> createState() => _SabouAppState();
}

class _SabouAppState extends State<SabouApp> {
  // Créée une seule fois : le jeton d'accès en mémoire survit aux reconstructions
  final session = PractitionerSession(
    store: DeviceSecretStore(),
    launcher: AppAuthLoginLauncher(),
  );
  late final rubrics = appRubrics(
    dossierApi: DossierApi(
      baseUrl: Uri.parse(practitionerApiUrl),
      session: session,
    ),
    studioApi: StudioApi(
      baseUrl: Uri.parse(practitionerApiUrl),
      session: session,
    ),
    picker: DevicePhotoPicker(),
    voiceTools: widget.voiceTools,
  );

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SABOU',
      // Textes en français (et en anglais) ; les langues nationales sont en voix seulement
      supportedLocales: const [Locale('fr'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      theme: sabouTheme(),
      home: SabouGate(
        session: session,
        rubrics: rubrics,
        openUrl: (url) => launchUrl(url, mode: LaunchMode.externalApplication),
        signupApi: SignupApi(baseUrl: Uri.parse(practitionerApiUrl)),
        siteUrl: Uri.parse(publicSiteUrl),
        devTools: devToolsButton(debug: kDebugMode),
      ),
    );
  }
}
