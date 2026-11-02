# SABOU — plateforme

Plateforme nationale de la médecine traditionnelle guinéenne. Les documents de référence (cahier des charges, règles métier, choix techniques, backlog) sont dans [`Plateforme/`](Plateforme/README.md) ; les règles de travail dans [`CLAUDE.md`](CLAUDE.md).

## Organisation du dépôt

```
apps/api        API (NestJS)
apps/admin      application de gestion (React + Vite)
apps/site       site public (Next.js)
packages/types  types et schémas de validation partagés
infra/ci        scripts du pipeline (appelés par GitHub Actions, puis GitLab CI)
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

6. **Docker Desktop** doit être démarré pour l'analyse des dépendances (Trivy est lancé dans un conteneur).

## Commandes

| Commande                            | Effet                                                          |
| ----------------------------------- | -------------------------------------------------------------- |
| `pnpm lint`                         | Lint de chaque application                                     |
| `pnpm format:check` / `pnpm format` | Vérifier / corriger le formatage                               |
| `pnpm test`                         | Tests de chaque application                                    |
| `pnpm build`                        | Compilation de chaque application                              |
| `pnpm ci:local`                     | Tout le pipeline, comme dans l'intégration continue (Git Bash) |
| `pnpm --filter @sabou/site dev`     | Site public sur http://localhost:3000                          |
| `pnpm --filter @sabou/admin dev`    | Application de gestion sur http://localhost:5173               |

`pnpm ci:local` se lance depuis un terminal **Git Bash** (dans VS Code : menu du terminal, profil « Git Bash »). Depuis PowerShell ou cmd, la commande `bash` désigne celle de WSL, qui ne voit ni Node ni pnpm : le pipeline s'arrête alors avec un message qui le dit. Le nom `pipeline` n'est pas utilisé, car `pnpm pipeline` est une commande intégrée de pnpm 12 ; `check-repo.sh` refuse tout script racine qui porterait le nom d'une commande intégrée.

Sans Docker, l'analyse Trivy peut utiliser un binaire local de la même version (0.76.1, somme de contrôle vérifiée) : `TRIVY_BIN=/chemin/vers/trivy.exe pnpm ci:local`.

## Contribuer

Une branche par récit (`us-xxx-description`), une demande de fusion vers `main`, fusion par le maître d'œuvre après relecture et pipeline vert. Jamais de push direct sur `main`. Détails dans [`CLAUDE.md`](CLAUDE.md).
