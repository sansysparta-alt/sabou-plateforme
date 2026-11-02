# SABOU — plateforme

Plateforme nationale de la médecine traditionnelle guinéenne. Les documents de référence (cahier des charges, règles métier, choix techniques, backlog) sont dans [`Plateforme/`](Plateforme/README.md) ; les règles de travail dans [`CLAUDE.md`](CLAUDE.md).

## Organisation du dépôt

```
apps/api        API (NestJS)
apps/admin      application de gestion (React + Vite)
apps/site       site public (Next.js)
packages/types  types et schémas de validation partagés
packages/db     base de données : migrations, jeu d'exemple, tests
infra/ci        scripts du pipeline (appelés par GitHub Actions, puis GitLab CI)
infra/local     environnement local (Docker Compose)
Plateforme/     documents de référence (pas de code)
```

## Installer le poste (Windows)

Le projet utilise **Node 26** et **pnpm 12** (versions fixées dans `.nvmrc` et dans le champ `packageManager` de `package.json`). Le gestionnaire de versions **fnm** permet de garder Node 24 pour les autres projets : il bascule tout seul sur Node 26 en entrant dans ce dossier.

1. Installer fnm, dans PowerShell :

   ```powershell
   winget install Schniz.fnm
   ```

2. Activer fnm dans les terminaux, puis les fermer et les rouvrir.

   PowerShell : ouvrir le profil avec `notepad $PROFILE` (créer le fichier s'il n'existe pas) et ajouter la ligne :

   ```powershell
   fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
   ```

   Git Bash : ajouter la ligne suivante à la fin de `~/.bashrc` :

   ```bash
   eval "$(fnm env --use-on-cd --shell bash)"
   ```

3. Installer Node 26 pour ce projet et garder Node 24 par défaut ailleurs :

   ```powershell
   fnm install 24
   fnm default 24
   cd D:\DEV\Plan\medecineTraditionnel
   fnm install
   node -v
   ```

   `fnm install` lit `.nvmrc` ; `node -v` doit afficher `v26.x` dans ce dossier, et `v24.x` ailleurs.

4. Installer pnpm 12 (depuis Node 25, Corepack n'est plus livré avec Node). Dans le dossier du projet, donc sous Node 26 :

   ```powershell
   npm install -g pnpm@12.16.1
   pnpm -v
   ```

   pnpm est installé pour Node 26 seulement ; Node 24 n'est pas modifié.

5. Installer les dépendances :

   ```powershell
   pnpm install
   ```

6. **Docker Desktop** doit être démarré : environnement local et analyses Trivy tournent dans des conteneurs.

## Commandes

| Commande                            | Effet                                                          |
| ----------------------------------- | -------------------------------------------------------------- |
| `pnpm lint`                         | Lint de chaque application                                     |
| `pnpm format:check` / `pnpm format` | Vérifier / corriger le formatage                               |
| `pnpm test`                         | Tests de chaque application                                    |
| `pnpm build`                        | Compilation de chaque application                              |
| `pnpm ci:local`                     | Tout le pipeline, comme dans l'intégration continue (Git Bash) |
| `pnpm env:up`                       | Environnement local complet (voir ci-dessous)                  |
| `pnpm env:down`                     | Arrêter l'environnement local, données conservées              |
| `pnpm env:reset`                    | Arrêter l'environnement local et **effacer** ses données       |
| `pnpm db:migrate` / `pnpm db:seed`  | Migrer la base locale / charger le jeu d'exemple fictif        |
| `pnpm --filter @sabou/site dev`     | Site public sur http://localhost:3000                          |
| `pnpm --filter @sabou/admin dev`    | Application de gestion sur http://localhost:5173               |

`pnpm ci:local` se lance depuis un terminal **Git Bash** (dans VS Code : menu du terminal, profil « Git Bash »). Depuis PowerShell ou cmd, la commande `bash` désigne celle de WSL, qui ne voit ni Node ni pnpm : le pipeline s'arrête alors avec un message qui le dit. Le nom `pipeline` n'est pas utilisé, car `pnpm pipeline` est une commande intégrée de pnpm 12 ; `check-repo.sh` refuse tout script racine qui porterait le nom d'une commande intégrée.

Sans Docker, l'analyse Trivy peut utiliser un binaire local de la même version (0.76.1, somme de contrôle vérifiée) : `TRIVY_BIN=/chemin/vers/trivy.exe pnpm ci:local`.

## Environnement local

`pnpm env:up` (depuis PowerShell ou Git Bash) démarre, dans Docker, PostgreSQL 17 + PostGIS, Keycloak, Valkey, SeaweedFS et l'API, puis attend que chaque contrôle de santé soit vert. Le premier lancement télécharge les images (plusieurs minutes) ; les suivants prennent quelques secondes.

| Service    | Adresse                            | Accès                                                       |
| ---------- | ---------------------------------- | ----------------------------------------------------------- |
| API        | http://localhost:4000/health/ready | répond `{"status":"ok","service":"api","database":"ok"}`    |
| Keycloak   | http://localhost:8080              | utilisateur `admin`, mot de passe `KEYCLOAK_ADMIN_PASSWORD` |
| PostgreSQL | localhost:5432, base `sabou`       | rôles `sabou_migrator` (migrations) et `sabou_app` (API)    |
| Valkey     | localhost:6379                     | mot de passe `VALKEY_PASSWORD`                              |
| S3         | http://localhost:8333              | clés `S3_ACCESS_KEY` et `S3_SECRET_KEY`                     |

Au premier lancement, `.env` est créé à partir de `.env.example` avec des mots de passe tirés au hasard ; il n'est jamais versionné. Les ports n'écoutent que sur `127.0.0.1` ; s'il y a un conflit avec un autre projet, il suffit de changer le port dans `.env`. Les données sont gardées dans des volumes Docker jusqu'à `pnpm env:reset`. Changer un mot de passe de `.env` après le premier lancement demande un `pnpm env:reset`, car PostgreSQL ne lit les mots de passe qu'à sa création.

## Contribuer

Une branche par récit (`us-xxx-description`), une demande de fusion vers `main`, fusion par le maître d'œuvre après relecture et pipeline vert. Jamais de push direct sur `main`. Détails dans [`CLAUDE.md`](CLAUDE.md).
