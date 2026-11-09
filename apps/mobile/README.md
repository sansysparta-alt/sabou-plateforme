# Application mobile SABOU (Flutter)

Application Android réservée aux **praticiens** et aux **agents préfectoraux de terrain** (CdC §1.3, §2.10, §8) ; le citoyen passe par le site public. Rubrique ouverte : **Mon dossier** du praticien (US-040b). Socle commun (US-018) : thème de la charte, composants réutilisables, navigation selon le profil.

- Android 8.0 (API 26) au minimum. Enregistrement en Opus 32 kbit/s à partir d'Android 10, en AAC 48 kbit/s sur Android 8 et 9 (`lib/recording_format.dart`).
- Flutter **3.47.7**, épinglé dans `infra/ci/mobile.sh`. Ne pas utiliser une autre version : le pipeline la refuse.
- Textes en français (et en anglais). Les langues nationales sont en voix seulement.

```
lib/main.dart               composition : services du téléphone, thème, porte d'entrée
lib/app.dart                registre des rubriques (une entrée par rubrique)
lib/ui/                     socle visuel : jetons de la charte, thème, composants communs
lib/shell/                  porte d'entrée (connexion, profil), coquille et navigation
lib/dossier/                rubrique « Mon dossier » : session, API, photo, écran
lib/dev/prototypes.dart     prototypes de S0, en version de développement seulement
lib/studio_page.dart, lib/sync/   prototypes US-005 (chaîne audio) et US-004 (hors réseau)
test/                       tests unitaires, parcours des écrans, règles d'accessibilité
```

## Socle (US-018)

**Règle** : un écran n'écrit ni couleur, ni espacement, ni rayon en dur. Il prend ses styles dans le thème (`Theme.of(context)`) ou dans les jetons (`SabouColors`, `SabouSpace`, `SabouRadius`, `SabouText`), et assemble les composants ci-dessous. Les jetons recopient `packages/ui/src/tokens.css` (base de design de US-016) ; `test/ui/tokens_test.dart` échoue si les deux divergent. Pour changer une couleur, on la change dans les deux fichiers.

| Composant (`lib/ui/widgets.dart`) | Emploi |
|---|---|
| `StatusMessage(texte, kind: StatusKind.…)` | Message d'état (information, réussite, avertissement, erreur), annoncé par les lecteurs d'écran ; le texte dit toujours l'état |
| `LoadingView(label: …)` | Chargement, avec un libellé lu par les lecteurs d'écran |
| `SectionTitle(texte)` | Titre de section, signalé comme titre |
| `EmptyState(icon:, title:, message:, actions:)` | Écran sans contenu : rubrique pas encore ouverte, accès refusé… |

Le thème (`lib/ui/theme.dart`) règle les boutons (48 px de haut), les champs (contour à 3:1), les cartes, la barre du haut (Vert forêt) et la barre de navigation du bas.

**Ajouter une rubrique** (Studio en S7, numérisation et agenda en S8) : une entrée `Rubric` dans `lib/app.dart`, avec son libellé, ses deux icônes, les profils qui la voient et son contenu (sans `Scaffold` : la coquille fournit la barre du haut et la déconnexion). La barre de navigation du bas paraît d'elle-même dès qu'un profil a deux rubriques. Une rubrique dont l'API répond « session expirée » appelle `rubric.onSignedOut`.

**Profils** : le profil vient des rôles du jeton (`praticien`, `admin_prefectoral`), gardés sur le téléphone pour ouvrir l'application sans réseau. Un compte citoyen est déconnecté et renvoyé vers le site. La connexion des agents arrive avec US-082.

**Prototypes** : en version de développement, un bouton de la barre du haut (fiole) ouvre le Studio (essai) et les dossiers de terrain ; il n'existe pas dans la version publiée.

## Commandes

Sur un poste dont le Flutter par défaut n'est pas la 3.47.7, indiquer celui du projet une fois pour toutes (PowerShell), puis rouvrir le terminal :

```powershell
setx FLUTTER_BIN D:\DEV\tools\flutter-3.47.7\flutter\bin\flutter
```

| Commande (depuis la racine du dépôt, Git Bash) | Effet |
|---|---|
| `bash infra/ci/mobile.sh` | Format, analyse, tests, APK de débogage, comme le pipeline |
| `pnpm --filter @sabou/audio essai` | Banc d'essai (port 3400) et relais 3G (port 3300), pour l'essai sur téléphone |

Le job Flutter du pipeline (`.github/workflows/mobile.yml`) ne tourne que si `apps/mobile/` ou `packages/ui/src/tokens.css` change. Il publie l'APK de débogage (`sabou-mobile-debug-apk`, gardé 14 jours).

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
adb install -r build/app/outputs/flutter-apk/app-arm64-v8a-debug.apk
```

Sous Git Bash, préfixer les commandes `adb` qui citent un chemin du téléphone par
`MSYS_NO_PATHCONV=1` (sinon `/sdcard/…` est réécrit). Puis :
« Créer un compte » (« Praticien » est coché d'office ; code SMS dans `docker compose … logs api`) → « Se connecter » → fiche, photo de
la pièce d'identité et du praticien → « Soumettre mon dossier ».
