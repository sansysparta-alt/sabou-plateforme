# SABOU — Plateforme (documents de référence pour le développement)

Plateforme nationale de la médecine traditionnelle guinéenne (« Yeleen Kènè »). Ce dossier `Plateforme/` contient **uniquement les documents à jour et indispensables** au développement (analyse validée en novembre 2026). Il peut être copié tel quel dans le dépôt de code et ouvert dans VS Code.

## Organisation

```
Plateforme/
├── README.md                          ← ce fichier
├── docs/
│   ├── cahier-des-charges/
│   │   └── SABOU_Cahier_des_Charges_Vert_v1.3.docx
│   ├── maquettes/
│   │   ├── SABOU_Maquette_Site_Web_Vert_v1.3.pptx
│   │   └── SABOU_Maquette_Application_Gestion_Vert_v1.3.pptx
│   ├── 00_Conception_BDD_SABOU.md
│   ├── 04_Regles_Metier.md
│   ├── 05_Choix_Techniques.md
│   ├── 06_Cas_Utilisation.md
│   ├── 07_Backlog_Sprints.md
│   └── 07_Backlog_import_GitLab.csv
```

Les scripts SQL v2 (`database/01_schema.sql`, `02_seed.sql`, `03_queries.sql`) ont été exécutés et corrigés au récit US-003, puis remplacés (décision du maître d'œuvre, novembre 2026) par le paquet [`packages/db`](../packages/db/README.md) du dépôt : migrations versionnées, jeu d'exemple et requêtes d'exemple, prouvés par des tests. L'historique Git conserve les fichiers d'origine.

Les anciennes versions (cahier des charges et maquettes v1.2, conception v1) sont conservées hors de ce dossier : ne plus les utiliser.

## Documents, dans l'ordre de lecture

| # | Fichier | Contenu | Statut |
|---|---|---|---|
| 1 | `docs/cahier-des-charges/SABOU_Cahier_des_Charges_Vert_v1.3.docx` | **Cahier des charges officiel.** Il fait foi. L'annexe B liste les modifications par rapport à la v1.2 | À jour (v1.3) |
| 2 | `docs/04_Regles_Metier.md` | Les règles numérotées (R-LNG-01…), leur origine et les 6 décisions tranchées | À jour |
| 3 | `docs/00_Conception_BDD_SABOU.md` | Modèle de la base de données : entités, tables, diagramme, choix | À jour (v2) |
| 4 | `../packages/db/migrations/` | Création de la base : tables, contraintes, triggers, workflows, recherche, vues (migrations Atlas) | **Source de vérité** du schéma, testée (US-003) |
| 5 | `../packages/db/seed/dev.sql` | Jeu de données d'exemple fictif (développement et tests uniquement) | Testé (US-003) |
| 6 | `../packages/db/examples/queries.sql` | Requêtes d'exemple : recherche, workflows, statistiques, cas interdits | Testé (US-003) |
| 7 | `docs/05_Choix_Techniques.md` | Technologies retenues, justification, alternatives écartées | **Validé** |
| 8 | `docs/06_Cas_Utilisation.md` | 55 cas d'utilisation par acteur (7 détaillés), reliés aux règles | À jour |
| 9 | `docs/07_Backlog_Sprints.md` (une version PDF existe, conservée hors de ce dossier) | Backlog priorisé (79 récits avec critères d'acceptation), 19 sprints, Definition of Ready et of Done | À jour |
| 10 | `docs/07_Backlog_import_GitLab.csv` | Les 79 récits au format d'import des issues GitLab | À jour |
| 11 | `docs/maquettes/` | Maquettes v1.3 du site public (23 diapositives) et de l'application de gestion (29) | À jour (v1.3) |

## Règles clés à retenir

- **Langues** : aucun texte en langue nationale. Texte et libellés en français (et en anglais) ; soussou, malinké, pular et guerzé en **voix** uniquement.
- **Certification** : 6 étapes, aucune sautée ; seul le responsable de l'étape, dans sa zone, décide ; un rejet renvoie à l'étape précédente.
- **Traitement** : 1 maladie, 1 à n plantes validées, 4 sections obligatoires (dont effets indésirables) + conservation facultative ; certifié par la DG après expertise du Comité.
- **Certificat** : QR signé Ed25519 + empreinte SHA-3, vérifiable hors ligne, valable 12 mois.
- **La plateforme informe, elle ne prescrit pas.**

## Points d'attention pour la suite

1. **Base de données** : toute évolution du schéma passe par une nouvelle migration de `packages/db/migrations/` (jamais par la modification d'une migration appliquée).
2. **Maquettes v1.3** : seuls les textes ont changé. Les noms locaux qui restent (« Kignè », « Dialambéré », « Kèmèkhoui ») sont des exemples de ce que dit ou tape un utilisateur dans le parcours « demande de plante ».
3. **À confirmer avec le ministère de la Santé** : l'intégration DHIS2 et la validation du dispositif de sécurité sanitaire.

## Prochaine phase : développement

Suivre `docs/07_Backlog_Sprints.md` : sprint 0 (dépôt, intégration continue, test des scripts SQL, prototypes 3.1 à 3.3), puis sprints 1 à 18 alignés sur les phases 2 à 6 du cahier des charges (§11.2). Les tâches hors développement (hébergeur, DHIS2, atelier linguistique, Mobile Money, SMS, avis du ministère) sont à lancer dès maintenant par le Product Owner.
