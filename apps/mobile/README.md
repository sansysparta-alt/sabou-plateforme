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
