# SABOU — règles de travail

Plateforme nationale de la médecine traditionnelle guinéenne. Ce fichier est lu automatiquement par Claude Code, que la session soit ouverte dans l'application Claude ou dans VS Code : les règles ci-dessous s'appliquent partout.

## Sources de vérité

- Le **cahier des charges v1.3** (`Plateforme/docs/cahier-des-charges/`) fait foi. En cas d'écart, on le signale au lieu de trancher seul.
- Ordre de lecture et statut des documents : `Plateforme/README.md`.
- Règles métier numérotées : `Plateforme/docs/04_Regles_Metier.md`. Pile technique validée : `Plateforme/docs/05_Choix_Techniques.md`. Travail à faire : `Plateforme/docs/07_Backlog_Sprints.md`.
- Toute décision technique nouvelle est écrite dans `05_Choix_Techniques.md` ; tout changement de périmètre dans le backlog.

## Règles de conduite

- **Pas de développement ni de tests sans feu vert explicite** du maître d'œuvre, récit par récit (US-xxx).
- Les questions qui relèvent du maître d'œuvre se posent avant de coder, regroupées en une seule fois.
- **Langues nationales en voix uniquement** : aucun texte en soussou, malinké, pular ou guerzé. Textes et libellés en français (et en anglais).
- **La plateforme informe, elle ne prescrit pas.**
- Choix techniques fondés sur l'adéquation au projet (exigences E1 à E11), pas sur les habitudes.
- On échange en français ; le code (noms de variables, fonctions) est en anglais, les commentaires et la documentation en français.

## Exigence de qualité et autonomie

Principe : aller vite sans perdre en qualité. Le code est de niveau production dès le premier jet, au sens de la Definition of Done. Pas de version « légère » à reprendre plus tard.

### Références

- Sécurité : OWASP ASVS niveau 2.
- Accessibilité : WCAG 2.2 AA.
- Performance : Core Web Vitals mesurés sur téléphone d'entrée de gamme, en réseau 3G.
- Chaîne logicielle : dépendances et actions épinglées, failles analysées.

On s'inspire des pratiques des meilleures équipes du numérique en corrigeant leurs faiblesses connues, sans importer une complexité que le projet ne justifie pas (exigences E1 à E11).

### Preuves

- Chaque critère d'acceptation est prouvé par au moins un test automatisé.
- Une exigence de qualité n'est considérée comme tenue que si le pipeline la vérifie. Tant qu'elle ne l'est pas, le compte rendu le dit.

### Autonomie

- Claude tranche seul les questions techniques courantes, selon les règles de l'art, et inscrit dans `05_Choix_Techniques.md` toute décision structurante.
- Il pose une question au maître d'œuvre uniquement pour : un écart au cahier des charges, un changement de périmètre ou d'estimation, une dépense, un sujet de sécurité ou de données, une décision difficile à défaire.
- Ces questions sont regroupées en une seule fois, avant de coder. Si l'une d'elles surgit en cours de route, Claude s'arrête et la pose aussitôt.

### Jamais seul

- Fusionner dans `main`.
- Toucher à un secret ou à la production.
- Supprimer des données.
- Engager une dépense.
- Ajouter un service externe.

### Avant de rendre la main

- Pipeline complet vert, en local puis sur GitHub.
- Contre-épreuves : une erreur volontaire doit faire échouer l'étape concernée.
- Relecture de son propre diff : sécurité, performance sur réseau faible, accessibilité, lisibilité.
- Il corrige ce qu'il trouve sans attendre qu'on le lui signale.

### Communication

- Demandes de fusion petites. Si une demande devient trop longue à relire, le récit est découpé.
- Chaque demande est accompagnée d'un guide de lecture : les fichiers à lire en priorité, ce qui est secondaire ou généré.
- Récit de 5 points ou plus : un point d'étape de deux lignes à mi-parcours, sans attendre de réponse sauf objection.
- Un seul compte rendu, à la fin du récit, court :
  - ce qui est fait et vérifié, avec la correspondance entre critères et tests ;
  - ce qui ne l'est pas ;
  - les décisions prises seul, une ligne chacune ;
  - les actions du maître d'œuvre, numérotées, pas à pas, avec les commandes exactes.

## Où travailler

**Un seul outil : Claude Code dans VS Code** (extension officielle d'Anthropic), ouvert sur `D:\DEV\Plan\medecineTraditionnel`. Analyse, documents, code, Docker, scripts SQL, tests, relecture des diffs et Git se font dans cette seule fenêtre. L'aperçu des applications s'ouvre dans le navigateur habituel (`localhost`).

Une seule session Claude à la fois sur ce projet : on n'ouvre pas en parallèle une autre session (application Claude, terminal) qui modifierait les mêmes fichiers.

## Consommation de l'abonnement

Deux limites : une fenêtre de 5 heures et une limite par semaine. Objectif : environ **14 % de la limite hebdomadaire par jour**, pour tenir les 7 jours.

- **Suivi** : la ligne d'état sous la zone de saisie (outil `ccusage`, version 20.0.36 épinglée, installé sur le poste) affiche le coût de la session et le temps restant dans la fenêtre de 5 heures. Le pourcentage hebdomadaire se lit dans le panneau de consommation de Claude Code.
- **Avant un récit ou une tâche lourde**, Claude lance `ccusage blocks --active` et donne en une ligne l'heure de fin de la fenêtre (par exemple : « commencée à 9 h, fin à 14 h, il reste 3 h 37 »).
- **Moins de 30 minutes dans la fenêtre, ou plus de 85 % de la semaine** : Claude termine l'étape en cours, commite et pousse, puis donne le message de reprise. Il ne commence pas une tâche lourde.
- **Une conversation par récit.** À la fin d'un récit, ou d'une partie de récit fusionnée, Claude demande au maître d'œuvre de taper `/clear`. Il ne peut pas le faire lui-même. La mémoire et ce fichier restent. Si une conversation devient longue en cours de récit, Claude propose `/compact`.
- **Modèle et effort** : effort moyen par défaut. **Sonnet** (`/model`) pour le courant : documents, Git, petites corrections. **Opus** pour l'analyse et le code difficile. Claude dit en une ligne quand un changement de modèle conviendrait.
- **Économie de Claude** : lire des extraits plutôt que des fichiers entiers, filtrer les journaux, faire des comptes rendus courts, pas de sous-agents ni de relecture multi-agents sans demande. Mesurer lui-même plutôt que demander des essais manuels.
- **Économie du maître d'œuvre** : un seul message avec toutes les demandes ; une ligne de texte plutôt qu'une capture quand elle suffit.

## Cycle d'un récit

1. Le maître d'œuvre désigne le récit (ex. « US-003 »).
2. Claude relit le récit, ses critères d'acceptation et les règles liées. Il pose en une seule fois les questions qui relèvent du maître d'œuvre, puis crée la branche du récit (ex. `us-003-migrations-sql`).
3. Claude code, teste et se relit selon la section « Exigence de qualité et autonomie ». Il commite sur la branche, pousse, ouvre la demande de fusion vers `main` et attend que le pipeline GitHub soit vert.
4. Claude envoie son compte rendu unique.
5. Le maître d'œuvre relit les diffs, en suivant le guide de lecture. Tant que l'équipe ne compte qu'un seul développeur, cette relecture tient lieu de relecture par un autre développeur (Definition of Done).
6. Le maître d'œuvre décide de la fusion dans `main`, uniquement si le pipeline est vert.
7. Une fois la fusion faite et le pipeline de `main` vert, Claude supprime la branche du récit, en local et sur GitHub, puis met `main` à jour en local.

Les autorisations de Claude Code (`.claude/settings.json`, versionné) traduisent ces règles : les commandes courantes du cycle passent sans demande, la fusion (`gh pr merge`) demande confirmation, l'envoi vers `main` et l'écrasement d'historique sont refusés. Claude ne modifie pas ce fichier lui-même : c'est le maître d'œuvre qui l'écrit.

## Git

- Dépôt : GitHub privé `sansysparta-alt/sabou-plateforme`, branche `main`. Compte gh actif : `sansysparta-alt`.
- **Jamais de push direct sur `main`** : une branche par récit, une demande de fusion, la fusion après validation. Le compte GitHub gratuit ne permet pas de protéger `main` : jusqu'à US-008, la règle « on ne fusionne que si le pipeline est vert » est tenue par convention.
- Bascule vers le GitLab souverain avant S3 (récit US-008) : la logique des pipelines vit dans des scripts du dépôt, les fichiers de CI ne font que les appeler.
- Messages de commit en français, préfixés par le récit quand il y en a un : `US-003 : migrations SQL versionnées`.
- **Aucun secret** dans le dépôt (`.env` ignoré, seul `.env.example` est versionné). Jamais de secret de production sur GitHub.
- Aucune donnée réelle (praticiens, patients, voix) avant la bascule sur l'hébergement souverain.

## Organisation du dépôt (monorepo, à créer au sprint 0)

```
Plateforme/   documents de référence (ne pas y mettre de code)
apps/         applications : api, admin, site, mobile
packages/     code partagé (types, client API…)
infra/        Docker Compose, scripts de pipeline, déploiement
```
