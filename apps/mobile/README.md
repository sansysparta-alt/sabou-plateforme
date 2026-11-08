# Application mobile SABOU (Flutter)

Application Android des praticiens et des agents de terrain (CdC §2.10, §8). Pour l'instant, elle ne contient que le **Studio (essai)** du récit US-005 : enregistrer une voix, l'envoyer au banc d'essai en 3G simulée, écouter les versions traitées et mesurer le démarrage de la lecture.

- Android 8.0 (API 26) au minimum. Enregistrement en Opus 32 kbit/s à partir d'Android 10, en AAC 48 kbit/s sur Android 8 et 9 (`lib/recording_format.dart`).
- Flutter **3.47.7**, épinglé dans `infra/ci/mobile.sh`. Ne pas utiliser une autre version : le pipeline la refuse.
- Textes en français (et en anglais). Les langues nationales sont en voix seulement.

```
lib/recording_format.dart   format d'enregistrement selon la version d'Android
lib/audio_io.dart           enregistrement et lecture (interfaces, pour tester sans micro)
lib/essai_api.dart          envoi au banc d'essai (packages/audio/src/essai-server.ts)
lib/studio_page.dart        écran Studio (essai)
test/                       tests unitaires, parcours de l'écran, règles d'accessibilité
```

## Commandes

Sur un poste dont le Flutter par défaut n'est pas la 3.47.7, indiquer celui du projet une fois pour toutes (PowerShell), puis rouvrir le terminal :

```powershell
setx FLUTTER_BIN D:\DEV\tools\flutter-3.47.7\flutter\bin\flutter
```

| Commande (depuis la racine du dépôt, Git Bash) | Effet |
|---|---|
| `bash infra/ci/mobile.sh` | Format, analyse, tests, APK de débogage, comme le pipeline |
| `pnpm --filter @sabou/audio essai` | Banc d'essai (port 3400) et relais 3G (port 3300), pour l'essai sur téléphone |

Le job Flutter du pipeline (`.github/workflows/mobile.yml`) ne tourne que si `apps/mobile/` change. Il publie l'APK de débogage (`sabou-mobile-debug-apk`, gardé 14 jours).

Sous Windows, la compilation Kotlin incrémentale est désactivée (`android/gradle.properties`) : elle échoue quand le projet et le cache des paquets Flutter sont sur deux lecteurs différents.

## Essai du dossier du praticien sur le téléphone (US-040b)

L'application parle à `localhost` ; `adb reverse` relie le `localhost` du téléphone au poste
(câble USB, débogage USB activé). Environnement local démarré (`pnpm env:up`) et site public
lancé (`pnpm --filter @sabou/site dev`, pour « Créer un compte »).

```bash
adb reverse tcp:4000 tcp:4000   # API
adb reverse tcp:8080 tcp:8080   # Keycloak (page de connexion)
adb reverse tcp:3000 tcp:3000   # site public (inscription)
cd apps/mobile && flutter build apk --debug --split-per-abi
adb push build/app/outputs/flutter-apk/app-arm64-v8a-debug.apk /sdcard/Atest/
```

Installer l'APK depuis le gestionnaire de fichiers du téléphone (MIUI refuse l'installation
par USB), puis : « Mon dossier de praticien » → « Créer un compte » (choisir « je suis
praticien » ; code SMS dans `docker compose … logs api`) → « Se connecter » → fiche, photo de
la pièce d'identité et du praticien → « Soumettre mon dossier ».
