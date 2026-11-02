# SABOU — règles de travail

Plateforme nationale de la médecine traditionnelle guinéenne. Ce fichier est lu automatiquement par Claude Code, que la session soit ouverte dans l'application Claude ou dans VS Code : les règles ci-dessous s'appliquent partout.

## Sources de vérité

- Le **cahier des charges v1.3** (`Plateforme/docs/cahier-des-charges/`) fait foi. En cas d'écart, on le signale au lieu de trancher seul.
- Ordre de lecture et statut des documents : `Plateforme/README.md`.
- Règles métier numérotées : `Plateforme/docs/04_Regles_Metier.md`. Pile technique validée : `Plateforme/docs/05_Choix_Techniques.md`. Travail à faire : `Plateforme/docs/07_Backlog_Sprints.md`.
- Toute décision technique nouvelle est écrite dans `05_Choix_Techniques.md` ; tout changement de périmètre dans le backlog.

## Règles de conduite

- **Pas de développement ni de tests sans feu vert explicite** du maître d'œuvre, récit par récit (US-xxx).
- Une question ouverte se pose avant de coder, jamais après.
- **Langues nationales en voix uniquement** : aucun texte en soussou, malinké, pular ou guerzé. Textes et libellés en français (et en anglais).
- **La plateforme informe, elle ne prescrit pas.**
- Choix techniques fondés sur l'adéquation au projet (exigences E1 à E11), pas sur les habitudes.
- On échange en français ; le code (noms de variables, fonctions) est en anglais, les commentaires et la documentation en français.

## Où travailler

**Un seul outil : Claude Code dans VS Code** (extension officielle d'Anthropic), ouvert sur `D:\DEV\Plan\medecineTraditionnel`. Analyse, documents, code, Docker, scripts SQL, tests, relecture des diffs et Git se font dans cette seule fenêtre. L'aperçu des applications s'ouvre dans le navigateur habituel (`localhost`).

Une seule session Claude à la fois sur ce projet : on n'ouvre pas en parallèle une autre session (application Claude, terminal) qui modifierait les mêmes fichiers.

## Cycle d'un récit

1. Le maître d'œuvre désigne le récit (ex. « US-003 »).
2. Claude relit le récit, ses critères d'acceptation et les règles liées, puis code et teste.
3. Claude montre le résultat (tests, captures, résumé des fichiers).
4. Le maître d'œuvre relit les diffs dans VS Code et valide ou demande des corrections.
5. Commit puis push sur `main`, uniquement après validation.

## Git

- Dépôt : GitHub privé `sansysparta-alt/sabou-plateforme`, branche `main`. Compte gh actif : `sansysparta-alt`.
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
