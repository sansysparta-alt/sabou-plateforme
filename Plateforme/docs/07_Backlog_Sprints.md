# SABOU — Backlog produit, sprints et Definition of Done

Entrée : `06_Cas_Utilisation.md` (cas d’utilisation validés). Méthode : Scrum, sprints de **2 semaines**. Outil cible : **GitLab** (issues, epics, milestones = sprints), cohérent avec `05_Choix_Techniques.md` ; le fichier `07_Backlog_import_GitLab.csv` permet l’import direct des récits. En attendant l’hébergeur souverain, le dépôt est sur GitHub ; la bascule vers GitLab est le récit US-008 (voir la décision dans `05_Choix_Techniques.md` §2.11).

**Critère de passage respecté** : chaque récit ci-dessous a des critères d’acceptation. **Question de contrôle** : chaque sprint a un objectif livrable et démontrable seul.

## 1. Hypothèses de planification

- Équipe de développement de 5 personnes (2 back-end, 1 web, 1 mobile, 1 qualité et exploitation) + un Product Owner (IPCREATECH) et un Scrum Master.
- Capacité visée : environ 20 à 25 points par sprint, dont **20 % de marge** pour les imprévus et la dette technique. À recalibrer après les sprints 1 et 2 avec la vélocité réelle.
- Estimation en points de complexité (suite de Fibonacci : 1, 2, 3, 5, 8). Un récit à plus de 8 points doit être découpé.
- Priorité MoSCoW : **Must** (indispensable au lancement), **Should** (important), **Could** (si le temps le permet).
- **Contre le risque de backlog trop gros** : seuls les sprints 0 à 3 sont détaillés au format « Étant donné… quand… alors… » ; les récits suivants ont des critères plus courts, à affiner lors du raffinement qui précède chaque sprint.

Volume : **78 récits**, **352 points**, **19 sprints** (sprint 0 à sprint 18), soit environ **39 semaines** de développement : le sprint 0 dure 3 semaines (mise en place et prototypes), les autres 2 semaines.

Les sprints S9, S15 et S16 sont volontairement plus légers : ils absorbent les retards et la dette technique de leur phase.

## 2. Plan des sprints

| Sprint | Phase du CdC | Objectif du sprint (livrable démontrable seul) | Récits | Points |
|---|---|---|---|---|
| **S0** | 1. Cadrage (fin de la phase 1) | L’équipe peut développer, tester et déployer ; les trois prototypes techniques sont tranchés. | US-001, US-002, US-003, US-004, US-005, US-006, US-007 | 33 |
| **S1** | 2. Socle et sécurité | Un administrateur se connecte avec double facteur et ne voit que les données de sa zone. | US-010, US-011, US-012, US-013, US-014, US-020, US-021, US-030 | 26 |
| **S2** | 2. Socle et sécurité | Un praticien soumet son dossier ; il est validé sur le terrain, consolidé et expertisé ; il reçoit un SMS à chaque étape. | US-031, US-040, US-041, US-042, US-043, US-044 | 26 |
| **S3** | 2. Socle et sécurité | La DG approuve, le certificat signé est émis et le praticien apparaît comme certifié. | US-045, US-046, US-047, US-048, US-049, US-008 | 23 |
| **S4** | 3. Application de gestion et mobile | Une fiche plante validée, avec la voix de son nom dans les 5 langues, est consultable dans l’application. | US-050, US-051, US-052, US-053, US-070, US-071 | 24 |
| **S5** | 3. Application de gestion et mobile | Un traitement saisi au Studio web suit tout le circuit jusqu’à la certification. | US-060, US-061, US-062, US-063, US-064 | 22 |
| **S6** | 3. Application de gestion et mobile | Les voix d’un traitement sont résumées, validées, contrôlées par le Comité et publiées ; un signalement peut suspendre un traitement. | US-072, US-073, US-074, US-075, US-100 | 19 |
| **S7** | 3. Application de gestion et mobile | Un praticien enregistre une recette complète sans réseau et la retrouve synchronisée. | US-080, US-081 | 16 |
| **S8** | 3. Application de gestion et mobile | Un agent préfectoral numérise une recette et réalise une visite sans réseau ; litiges et alertes sont traités. | US-082, US-083, US-101, US-102 | 14 |
| **S9** | 3. Application de gestion et mobile | Chaque profil dispose de son tableau de bord et de ses rapports. | US-090, US-091 | 8 |
| **S10** | 4. Site public | Un visiteur cherche « paludisme » dans sa langue et voit les traitements certifiés ; la DG pilote les menus. | US-110, US-111, US-117, US-130 | 21 |
| **S11** | 4. Site public | Un visiteur écoute un traitement en malinké, même sans réseau, et trouve un praticien certifié. | US-112, US-113, US-114 | 18 |
| **S12** | 4. Site public | Un visiteur consulte le Dictionnaire, vérifie un certificat et un citoyen témoigne. | US-115, US-116, US-120 | 18 |
| **S13** | 4. Site public | Un citoyen demande une plante par la voix et un praticien la lui envoie ; le site est rapide en 3G. | US-121, US-122, US-118 | 18 |
| **S14** | 5. Services | Un praticien paie GOLD par Mobile Money, publie un 4e traitement et renouvelle son certificat. | US-140, US-141, US-153 | 16 |
| **S15** | 5. Services | Un praticien GOLD vend un produit validé ; les exports sont disponibles. | US-142, US-143, US-152 | 11 |
| **S16** | 5. Services | Un partenaire et DHIS2 reçoivent les indicateurs anonymisés. | US-150, US-151 | 10 |
| **S17** | 6. Recette et déploiement | La plateforme tient la charge, passe l’audit de sécurité et tourne en production souveraine. | US-160, US-161, US-162 | 13 |
| **S18** | 6. Recette et déploiement | Le pilote de Haute Guinée est réussi ; la généralisation est planifiée. | US-163, US-164, US-165 | 16 |

### Tâches hors développement, à mener en parallèle (Product Owner)

| Tâche | Échéance | Lien | Statut (2 novembre 2026) |
|---|---|---|---|
| Agrégateur SMS (contrat, **nom d’expéditeur** « SABOU ») | Avant S2 | US-031 | **En cours** : décidé de partir sur un agrégateur avec nom d’expéditeur ; l’enregistrement du nom auprès des opérateurs peut prendre plusieurs semaines |
| Hébergement de la recette (sprints 0 à 2, données fictives) | Avant fin S0 | US-007 | **En cours** : choix à trancher (Vercel ou serveur unique Docker Compose) |
| Prototype 3.4 — choisir l’hébergeur souverain (3 serveurs, sauvegarde hors site, coût) | Avant S3 | US-008, US-162 | À lancer |
| Atelier linguistique : un référent par langue, voix et transcriptions des noms | Avant S4 | US-053, US-071 | Reporté (à revoir plus tard) |
| Validation du dispositif de sécurité sanitaire par le ministère de la Santé | Avant S6 | US-100 | Reporté (à revoir plus tard) |
| Accords Orange Money et MTN MoMo (comptes marchands, accès API) | Avant S14 | US-140 | Reporté (à revoir plus tard) |
| Prototype 3.5 — contact DHIS2 au ministère, liste des indicateurs et format | Avant S14 | US-151 | Reporté (à revoir plus tard) |

## 3. Epics

| Epic | Intitulé | Phase | Récits | Points |
|---|---|---|---|---|
| E00 | Fondations techniques | 1 | 8 | 36 |
| E01 | Identité et accès | 2 | 5 | 18 |
| E02 | Référentiels | 2 | 2 | 5 |
| E03 | Audit et notifications | 2 | 2 | 8 |
| E04 | Certification et certificat | 2 | 11 | 44 |
| E05 | Dictionnaire Impérial | 3 | 4 | 14 |
| E06 | Traitements et circuit | 3 | 5 | 22 |
| E07 | Voix et gouvernance linguistique | 3 | 6 | 24 |
| E08 | Application mobile de terrain | 3 | 4 | 24 |
| E09 | Tableaux de bord et rapports | 3 | 2 | 8 |
| E10 | Sécurité sanitaire, litiges, alertes | 3 | 3 | 11 |
| E11 | Site public | 4 | 9 | 49 |
| E12 | Communauté | 4 | 3 | 21 |
| E13 | Pilotage du site | 4 | 1 | 5 |
| E14 | Services (paiements, boutique, formation) | 5 | 4 | 21 |
| E15 | Interopérabilité (API, DHIS2, exports) | 5 | 3 | 13 |
| E16 | Recette et déploiement | 6 | 6 | 29 |

## 4. Backlog priorisé (par sprint)

### Sprint 0 — L’équipe peut développer, tester et déployer ; les trois prototypes techniques sont tranchés.

#### US-001 · Un dépôt monorepo avec intégration continue
*Fondations techniques* · **Must** · 3 points · cas : —

> En tant qu’équipe, je veux un dépôt monorepo avec intégration continue, afin que chaque changement soit vérifié automatiquement.

Critères d’acceptation :
- Étant donné une demande de fusion, quand elle est poussée, alors le lint, le formatage, les tests et la compilation de chaque application (`apps/api`, `apps/admin`, `apps/site`, `packages/types`) s’exécutent.
- Étant donné une fusion sur `main`, quand elle est poussée, alors le même pipeline s’exécute.
- Étant donné une dépendance avec une faille critique, quand l’analyse Trivy s’exécute, alors le pipeline échoue.
- Chaque étape du pipeline est un script de `infra/ci/` exécutable en local ; le fichier GitHub Actions ne fait que les appeler. Les actions GitHub et Trivy sont épinglés par SHA.
- ~~Étant donné un test en échec, quand la demande de fusion est examinée, alors la fusion est bloquée.~~ **Reporté à US-008** (décision du maître d’œuvre, novembre 2026) : un dépôt privé sur un compte GitHub gratuit n’autorise ni protection de branche ni règles de fusion. Jusqu’à US-008, le blocage se fait **par convention** : le maître d’œuvre ne fusionne une demande que si son pipeline est vert.

Périmètre : les applications sont des squelettes minimaux (un test chacun, aucune fonctionnalité). Hors périmètre : application mobile (US-004), tests sur un vrai PostgreSQL (US-003), analyse des images Docker (US-002), déploiement (US-007).

#### US-002 · Lancer tout l’environnement local en une commande
*Fondations techniques* · **Must** · 5 points · cas : —

> En tant que développeur, je veux lancer tout l’environnement local en une commande, afin de travailler dans les conditions de production.

Critères d’acceptation :
- Étant donné un poste neuf, quand je lance la commande de démarrage, alors PostgreSQL 17 + PostGIS, Keycloak, Valkey et SeaweedFS démarrent et leurs contrôles de santé sont verts.
- Étant donné l’environnement démarré, quand j’ouvre l’API, alors elle répond et lit la base.

#### US-003 · Exécuter et corriger les scripts SQL v2 sous forme de migrations versionnées
*Fondations techniques* · **Must** · 5 points · cas : —

> En tant qu’équipe, je veux exécuter et corriger les scripts SQL v2 sous forme de migrations versionnées, afin de partir d’une base fiable.

Critères d’acceptation :
- Étant donné une base vide, quand les migrations s’exécutent avec arrêt sur erreur, alors elles réussissent sans erreur.
- Étant donné les cas interdits de 03_queries.sql (langue non autorisée, traitement incomplet, acteur hors zone), quand les tests automatiques les exécutent, alors chacun est refusé par la base.
- Étant donné une migration déjà appliquée, quand on la modifie, alors l’outil de migration le détecte et échoue.

#### US-004 · Un prototype de synchronisation hors réseau (Flutter + PowerSync)
*Fondations techniques* · **Must** · 8 points · cas : UC-74

> En tant qu’équipe, je veux un prototype de synchronisation hors réseau (Flutter + PowerSync), afin de valider ou remplacer ce choix technique.

Critères d’acceptation :
- Étant donné un téléphone sans réseau, quand un agent saisit un dossier avec pièces et voix, alors tout est conservé sur le téléphone.
- Étant donné le retour du réseau, quand la synchronisation s’exécute, alors le dossier apparaît sur le serveur sans perte.
- Étant donné une modification concurrente, quand la synchronisation s’exécute, alors la version validée du serveur prime et l’autre reste en brouillon (R-DON-04).
- Une décision écrite « validé » ou « solution remplacée » est ajoutée à 05_Choix_Techniques.md.
- Étant donné une demande de fusion qui modifie `apps/mobile/`, quand elle est poussée, alors un job Flutter (analyse, tests, compilation) s’exécute ; il ne s’exécute pas si `apps/mobile/` n’est pas modifié.

#### US-005 · Un prototype de chaîne audio
*Fondations techniques* · **Must** · 5 points · cas : UC-73

> En tant qu’équipe, je veux un prototype de chaîne audio, afin de garantir une voix claire et légère sur téléphone d’entrée de gamme.

Critères d’acceptation :
- Étant donné un Android d’entrée de gamme, quand on enregistre 90 s dans un lieu bruyant, alors le fichier traité (RNNoise, normalisation, Opus 24 kbit/s) pèse au plus 300 Ko et reste compréhensible.
- Étant donné une connexion 3G simulée, quand on lance la lecture, alors elle démarre en moins de 3 s.
- Une décision écrite est ajoutée à 05_Choix_Techniques.md.

#### US-006 · Un prototype de QR signé vérifiable hors ligne
*Fondations techniques* · **Must** · 5 points · cas : UC-06

> En tant qu’équipe, je veux un prototype de QR signé vérifiable hors ligne, afin de valider le format CBOR/COSE/Base45 et Ed25519.

Critères d’acceptation :
- Étant donné un QR généré et signé, quand un téléphone sans réseau le scanne, alors le verdict « authentique » s’affiche.
- Étant donné un QR dont une donnée est modifiée, quand il est scanné, alors le verdict « falsifié » (rouge) s’affiche.
- Une décision écrite est ajoutée à 05_Choix_Techniques.md.

#### US-007 · Un environnement de recette déployé automatiquement
*Fondations techniques* · **Must** · 2 points · cas : —

> En tant qu’équipe, je veux un environnement de recette déployé automatiquement, afin de montrer chaque sprint.

Critères d’acceptation :
- Étant donné une fusion sur la branche principale, quand le pipeline se termine, alors l’environnement de recette est mis à jour sans intervention.

### Sprint 1 — Un administrateur se connecte avec double facteur et ne voit que les données de sa zone.

#### US-010 · Me connecter avec un double facteur obligatoire
*Identité et accès* · **Must** · 5 points · cas : UC-65

> En tant qu’administrateur, je veux me connecter avec un double facteur obligatoire, afin que mon compte ne puisse pas être usurpé.

Critères d’acceptation :
- Étant donné un administrateur sans double facteur, quand il se connecte, alors il doit l’activer avant d’accéder à l’application.
- Étant donné un praticien ou un citoyen, quand il se connecte, alors le double facteur est proposé mais pas imposé.
- Étant donné 5 échecs de connexion, quand une 6e tentative arrive, alors le compte est bloqué temporairement et l’événement est journalisé.

#### US-011 · Ne voir que les données de ma zone
*Identité et accès* · **Must** · 5 points · cas : UC-65

> En tant qu’admin préfectoral ou régional, je veux ne voir que les données de ma zone, afin de respecter le moindre privilège.

Critères d’acceptation :
- Étant donné l’admin préfectoral de Labé, quand il liste les praticiens, alors seuls ceux de Labé apparaissent, même par appel direct à l’API.
- Étant donné l’admin régional de Kankan, quand il liste les dossiers, alors seuls ceux des préfectures de sa région apparaissent.
- Étant donné une requête SQL sans contexte de zone, quand elle s’exécute sous le rôle applicatif, alors elle ne renvoie aucune ligne (RLS).

#### US-012 · Créer ou inviter un compte et lui attribuer rôle, zone et langues de travail
*Identité et accès* · **Must** · 3 points · cas : UC-65

> En tant que DG, je veux créer ou inviter un compte et lui attribuer rôle, zone et langues de travail, afin d’organiser les équipes.

Critères d’acceptation :
- Étant donné une invitation envoyée, quand la personne l’accepte, alors son compte a exactement le rôle, la zone et les langues attribués.
- Étant donné un rôle régional sans région, quand la DG enregistre, alors l’enregistrement est refusé.

#### US-013 · Suspendre un compte en un clic
*Identité et accès* · **Must** · 2 points · cas : UC-65

> En tant que DG, je veux suspendre un compte en un clic, afin de couper immédiatement un accès.

Critères d’acceptation :
- Étant donné un compte connecté, quand la DG le suspend, alors ses sessions sont révoquées dans la minute et toute nouvelle connexion est refusée.
- La suspension est inscrite au journal d’audit.

#### US-014 · Créer un compte gratuit avec mon numéro de téléphone
*Identité et accès* · **Must** · 3 points · cas : UC-10

> En tant que citoyen, je veux créer un compte gratuit avec mon numéro de téléphone, afin de témoigner et de demander une plante.

Critères d’acceptation :
- Étant donné un numéro valide, quand je m’inscris, alors je reçois un code par SMS et mon compte est créé après saisie du code.
- Étant donné un numéro déjà inscrit, quand je m’inscris, alors on me propose de me connecter.

#### US-020 · Gérer les langues (texte, voix) et les territoires
*Référentiels* · **Must** · 3 points · cas : UC-65

> En tant que DG, je veux gérer les langues (texte, voix) et les territoires, afin de paramétrer la plateforme sans code.

Critères d’acceptation :
- Étant donné l’anglais (langue sans voix), quand on enregistre une voix en anglais, alors c’est refusé.
- Étant donné Conakry, quand on consulte sa région naturelle, alors c’est la Basse Guinée (soussou par défaut).
- Étant donné une nouvelle langue nationale ajoutée, quand on l’active, alors elle est utilisable sans modification du code.

#### US-021 · Gérer la liste des 8 spécialités
*Référentiels* · **Should** · 2 points · cas : UC-65

> En tant que DG, je veux gérer la liste des 8 spécialités, afin de classer les praticiens.

Critères d’acceptation :
- Étant donné la liste initiale, quand on l’affiche, alors les 8 spécialités du cahier des charges v1.3 sont présentes, en français et en anglais.

#### US-030 · Un journal de toutes les décisions et connexions, non modifiable
*Audit et notifications* · **Must** · 3 points · cas : —

> En tant qu’auditeur, je veux un journal de toutes les décisions et connexions, non modifiable, afin d’assurer la traçabilité.

Critères d’acceptation :
- Étant donné une décision de workflow, quand elle est prise, alors une ligne d’audit (qui, quoi, quand, IP) est écrite dans la même transaction.
- Étant donné une tentative de modification ou de suppression du journal, quand elle s’exécute, alors elle est refusée.

### Sprint 2 — Un praticien soumet son dossier ; il est validé sur le terrain, consolidé et expertisé ; il reçoit un SMS à chaque étape.

#### US-031 · Être notifié par SMS à chaque étape de mon dossier
*Audit et notifications* · **Must** · 5 points · cas : UC-72

> En tant que praticien, je veux être notifié par SMS à chaque étape de mon dossier, afin de suivre ma certification.

Critères d’acceptation :
- Étant donné une transition validée, quand la transaction est confirmée, alors un SMS part dans les 5 minutes.
- Étant donné une transition annulée (erreur), quand la transaction échoue, alors aucun SMS ne part.
- Étant donné un échec d’envoi, quand le service SMS répond en erreur, alors 3 nouvelles tentatives ont lieu puis l’échec est visible.

#### US-040 · Soumettre mon dossier de certification
*Certification et certificat* · **Must** · 5 points · cas : UC-20

> En tant que praticien, je veux soumettre mon dossier de certification, afin d’entrer dans le workflow.

Critères d’acceptation :
- Étant donné un dossier complet (identité, pièces, photo), quand je le soumets, alors il passe à l’étape 2 et je reçois un accusé de réception.
- Étant donné une pièce obligatoire manquante, quand je soumets, alors la soumission est bloquée avec la liste des pièces manquantes.
- Étant donné un rejet définitif datant de moins de 12 mois, quand j’ouvre un dossier, alors c’est refusé.

#### US-041 · Planifier et réaliser les visites terrain
*Certification et certificat* · **Must** · 5 points · cas : UC-30

> En tant qu’admin préfectoral, je veux planifier et réaliser les visites terrain, afin de vérifier les praticiens.

Critères d’acceptation :
- Étant donné une visite planifiée, quand la veille arrive, alors un rappel part au praticien.
- Étant donné une visite réalisée, quand je l’enregistre, alors un compte rendu signé est obligatoire.

#### US-042 · Valider ou rejeter un dossier à l’étape 2
*Certification et certificat* · **Must** · 5 points · cas : UC-31

> En tant qu’admin préfectoral, je veux valider ou rejeter un dossier à l’étape 2, afin de faire avancer la certification.

Critères d’acceptation :
- Étant donné une visite réalisée avec compte rendu, quand je valide, alors le dossier passe à l’étape 3.
- Étant donné un dossier initial sans visite réalisée, quand je valide, alors c’est refusé.
- Étant donné un rejet, quand je ne saisis pas de motif, alors c’est refusé ; avec motif, le dossier revient à l’étape 1.
- Étant donné un dossier d’une autre préfecture, quand je tente de décider, alors c’est refusé.

#### US-043 · Consolider un dossier à l’étape 3
*Certification et certificat* · **Must** · 3 points · cas : UC-40

> En tant qu’admin régional, je veux consolider un dossier à l’étape 3, afin de le transmettre au Comité.

Critères d’acceptation :
- Étant donné un dossier de ma région à l’étape 3, quand je valide, alors il passe à l’étape 4 ; quand je rejette avec motif, il revient à l’étape 2.

#### US-044 · Expertiser un dossier à l’étape 4
*Certification et certificat* · **Must** · 3 points · cas : UC-50

> En tant que membre du Comité, je veux expertiser un dossier à l’étape 4, afin de garantir la non-toxicité.

Critères d’acceptation :
- Étant donné un dossier à l’étape 4, quand je valide, alors il passe à l’étape 5 ; quand je rejette avec motif, il revient à l’étape 3.

### Sprint 3 — La DG approuve, le certificat signé est émis et le praticien apparaît comme certifié.

#### US-045 · Approuver un dossier et émettre un certificat signé
*Certification et certificat* · **Must** · 8 points · cas : UC-60

> En tant que DG, je veux approuver un dossier et émettre un certificat signé, afin de certifier le praticien.

Critères d’acceptation :
- Étant donné un dossier à l’étape 5, quand j’approuve, alors un certificat de 12 mois est créé avec empreinte SHA3-256, signature Ed25519 et QR.
- La clé privée n’est jamais lue par l’application : la signature est faite par le coffre (Vault/OpenBao).
- Étant donné un renouvellement, quand le nouveau certificat est émis, alors l’ancien passe à « expiré ».

#### US-046 · Publier le praticien à l’étape 6
*Certification et certificat* · **Must** · 3 points · cas : UC-70

> En tant que système, je veux publier le praticien à l’étape 6, afin qu’il apparaisse dans l’annuaire.

Critères d’acceptation :
- Étant donné un certificat actif, quand la publication s’exécute, alors le praticien passe « certifié » et ses traitements expertisés joints au dossier passent « certifiés ».

#### US-047 · Prononcer un rejet définitif
*Certification et certificat* · **Must** · 3 points · cas : UC-61

> En tant que DG, je veux prononcer un rejet définitif, afin d’écarter un praticien frauduleux ou dangereux.

Critères d’acceptation :
- Étant donné un autre rôle que la DG, quand il tente un rejet définitif, alors c’est refusé.
- Étant donné un rejet définitif motivé, quand il est prononcé, alors le praticien passe « rejeté », son certificat est révoqué et il est informé de son recours de 30 jours.

#### US-048 · L’entonnoir des 6 étapes et les dossiers bloqués
*Certification et certificat* · **Should** · 3 points · cas : UC-67

> En tant que DG, je veux l’entonnoir des 6 étapes et les dossiers bloqués, afin de piloter les délais.

Critères d’acceptation :
- Étant donné des dossiers en cours, quand j’ouvre l’écran, alors je vois le nombre par étape, le délai moyen par étape et les dossiers sans décision depuis plus de 15 jours.

#### US-049 · Expirer les certificats et relancer les praticiens 60 jours avant
*Certification et certificat* · **Must** · 3 points · cas : UC-71

> En tant que système, je veux expirer les certificats et relancer les praticiens 60 jours avant, afin de tenir les statuts à jour.

Critères d’acceptation :
- Étant donné un certificat arrivé à échéance, quand la tâche quotidienne s’exécute, alors il passe « expiré » et le praticien sort de l’annuaire public.
- Étant donné un certificat à 60 jours de l’échéance, quand la tâche s’exécute, alors le praticien reçoit une invitation à renouveler.

#### US-008 · Basculer le dépôt et le pipeline sur le GitLab souverain
*Fondations techniques* · **Must** · 3 points · cas : —

> En tant qu’équipe, je veux basculer le dépôt et le pipeline de GitHub vers le GitLab auto-hébergé, afin que le code et la chaîne de livraison soient souverains avant toute donnée réelle (E7).

Critères d’acceptation :
- Étant donné le GitLab installé chez l’hébergeur souverain, quand le dépôt y est poussé, alors tout l’historique, les branches et les étiquettes sont présents.
- Étant donné les pipelines de US-001 et US-007, quand ils sont portés sur GitLab CI, alors le lint, les tests, la compilation et le déploiement en recette passent comme sur GitHub.
- Étant donné un test en échec, quand la demande de fusion est examinée, alors la fusion est bloquée (branche `main` protégée, pipeline réussi obligatoire). Critère reporté de US-001 ; il remplace la convention « on ne fusionne que si le pipeline est vert ».
- Étant donné le fichier 07_Backlog_import_GitLab.csv, quand il est importé, alors chaque récit devient une issue avec son epic, son sprint et son poids.
- Étant donné la bascule terminée, quand on consulte GitHub, alors le dépôt est en miroir en lecture seule ou archivé, et GitLab est la seule référence.

### Sprint 4 — Une fiche plante validée, avec la voix de son nom dans les 5 langues, est consultable dans l’application.

#### US-050 · Créer et modifier une fiche plante avec ses images
*Dictionnaire Impérial* · **Must** · 5 points · cas : UC-05

> En tant que DG ou Comité, je veux créer et modifier une fiche plante avec ses images, afin d’alimenter le Dictionnaire.

Critères d’acceptation :
- Nom scientifique unique, famille, nom français (obligatoire) et anglais.
- Une seule photo principale ; texte alternatif obligatoire.

#### US-051 · Valider une fiche plante
*Dictionnaire Impérial* · **Must** · 3 points · cas : UC-52

> En tant que membre du Comité, je veux valider une fiche plante, afin qu’elle puisse entrer dans un traitement certifié.

Critères d’acceptation :
- Une plante « en revue » ne peut pas entrer dans un traitement certifié.
- La validation enregistre le valideur et la date.

#### US-052 · Gérer les fiches maladies
*Dictionnaire Impérial* · **Must** · 3 points · cas : UC-05

> En tant que DG ou Comité, je veux gérer les fiches maladies, afin de permettre la recherche.

Critères d’acceptation :
- Nom français unique, nom anglais, dénominations, symptômes.
- Les dénominations sont trouvées par la recherche sans accents.

#### US-053 · Saisir les noms locaux d’une plante (transcription + voix)
*Dictionnaire Impérial* · **Must** · 3 points · cas : UC-12

> En tant que référent linguistique, je veux saisir les noms locaux d’une plante (transcription + voix), afin qu’on la retrouve par son nom local.

Critères d’acceptation :
- Plusieurs noms par langue, un seul principal.
- La transcription n’apparaît jamais sur les fiches publiques ; elle sert à la recherche.

#### US-070 · Traiter chaque voix déposée
*Voix et gouvernance linguistique* · **Must** · 5 points · cas : UC-73

> En tant que système, je veux traiter chaque voix déposée, afin d’obtenir un son clair et léger.

Critères d’acceptation :
- Réduction du bruit, normalisation du volume, Opus 24 kbit/s + secours AAC.
- Durée, taille et empreinte calculées automatiquement.

#### US-071 · Gérer la voix des noms de plantes et de maladies par langue, avec ses statuts
*Voix et gouvernance linguistique* · **Must** · 5 points · cas : UC-33, UC-41

> En tant qu’admin, je veux gérer la voix des noms de plantes et de maladies par langue, avec ses statuts, afin de publier des noms écoutables.

Critères d’acceptation :
- Statuts Brouillon → Traduit → Validé → Publié par langue.
- Publication impossible sans consentement ; le valideur n’est jamais celui qui a enregistré.

### Sprint 5 — Un traitement saisi au Studio web suit tout le circuit jusqu’à la certification.

#### US-060 · Créer un traitement depuis le Studio web
*Traitements et circuit* · **Must** · 8 points · cas : UC-21

> En tant que praticien, je veux créer un traitement depuis le Studio web, afin de préparer sa certification.

Critères d’acceptation :
- Maladie, 1 à n plantes ordonnées avec partie utilisée, cycle (durée, prises, pause).
- 4 sections obligatoires + conservation facultative, texte français (et anglais facultatif).
- Consentement et niveau de visibilité obligatoires avant soumission.

#### US-061 · Faire avancer un traitement (soumettre, transmettre, expertiser, certifier, rejeter)
*Traitements et circuit* · **Must** · 5 points · cas : UC-22, UC-42, UC-51, UC-62

> En tant qu’acteur du circuit, je veux faire avancer un traitement (soumettre, transmettre, expertiser, certifier, rejeter), afin qu’il soit publié.

Critères d’acceptation :
- Seul le rôle prévu, dans sa zone, peut faire chaque transition.
- Un rejet exige un motif et renvoie à l’étape précédente.
- Chaque transition est historisée et notifiée.

#### US-062 · Que la certification d’un traitement soit bloquée s’il est incomplet
*Traitements et circuit* · **Must** · 3 points · cas : UC-62

> En tant que DG, je veux que la certification d’un traitement soit bloquée s’il est incomplet, afin de ne publier que des traitements sûrs.

Critères d’acceptation :
- Refus si une plante n’est pas validée, si une section obligatoire manque ou si le praticien n’a pas de certificat actif.
- Refus au-delà de 3 traitements certifiés en formule gratuite (après les 30 jours de grâce).

#### US-063 · Indiquer les contre-indications structurées
*Traitements et circuit* · **Should** · 3 points · cas : UC-21

> En tant que praticien, je veux indiquer les contre-indications structurées, afin qu’elles s’affichent en alerte.

Critères d’acceptation :
- Liste paramétrable (grossesse, allaitement, enfant de moins de 5 ans…).
- Affichage en alerte sur la page traitement.

#### US-064 · Annoter un traitement ou une plante
*Traitements et circuit* · **Should** · 3 points · cas : UC-51

> En tant que membre du Comité, je veux annoter un traitement ou une plante, afin de motiver mes avis.

Critères d’acceptation :
- Annotation datée avec avis (favorable, réserve, défavorable).
- Historique consultable par la DG.

### Sprint 6 — Les voix d’un traitement sont résumées, validées, contrôlées par le Comité et publiées ; un signalement peut suspendre un traitement.

#### US-072 · Valider les voix de ma langue dans l’atelier linguistique
*Voix et gouvernance linguistique* · **Must** · 5 points · cas : UC-41

> En tant qu’admin régional, je veux valider les voix de ma langue dans l’atelier linguistique, afin de garantir leur qualité.

Critères d’acceptation :
- Écoute de la voix et lecture du texte français côte à côte.
- Validation ou renvoi motivé ; seules les voix de ma langue et de ma région apparaissent.

#### US-073 · Contrôler la voix des effets indésirables dans chaque langue
*Voix et gouvernance linguistique* · **Must** · 3 points · cas : UC-53

> En tant que membre du Comité, je veux contrôler la voix des effets indésirables dans chaque langue, afin d’autoriser sa publication.

Critères d’acceptation :
- Sans ce contrôle, la voix des effets indésirables ne peut pas être publiée.

#### US-074 · Suivre la couverture vocale par langue et publier les voix validées
*Voix et gouvernance linguistique* · **Should** · 3 points · cas : UC-63

> En tant que DG, je veux suivre la couverture vocale par langue et publier les voix validées, afin de piloter les traductions.

Critères d’acceptation :
- Pourcentage de sections publiées par langue et retards par région.
- Publication groupée des voix validées.

#### US-075 · Résumer une recette en français et enregistrer la voix locale
*Voix et gouvernance linguistique* · **Must** · 3 points · cas : UC-33

> En tant qu’admin préfectoral, je veux résumer une recette en français et enregistrer la voix locale, afin de l’envoyer au régional.

Critères d’acceptation :
- Texte français par section, voix locale par section.
- Envoi à l’admin régional de la langue.

#### US-100 · Traiter les signalements de danger et d’effets indésirables
*Sécurité sanitaire, litiges, alertes* · **Must** · 5 points · cas : UC-08, UC-54

> En tant que membre du Comité, je veux traiter les signalements de danger et d’effets indésirables, afin de protéger les patients.

Critères d’acceptation :
- Signalements graves en tête de file, délai cible 24 h.
- Décision motivée : aucune action, révision, suspension ou retrait ; la suspension retire le traitement du site immédiatement.

### Sprint 7 — Un praticien enregistre une recette complète sans réseau et la retrouve synchronisée.

#### US-080 · Une application mobile qui fonctionne sans réseau
*Application mobile de terrain* · **Must** · 8 points · cas : UC-74

> En tant que praticien ou agent, je veux une application mobile qui fonctionne sans réseau, afin de travailler partout.

Critères d’acceptation :
- Connexion, puis usage complet hors réseau des écrans prévus.
- Synchronisation automatique au retour du réseau, règle de conflit R-DON-04.

#### US-081 · Enregistrer ma recette au Studio mobile
*Application mobile de terrain* · **Must** · 8 points · cas : UC-21

> En tant que praticien, je veux enregistrer ma recette au Studio mobile, afin de la préserver dans ma langue.

Critères d’acceptation :
- Un enregistrement par champ, réécoute, ré-enregistrement, alerte de bruit.
- Consentement enregistré ; brouillon conservé hors réseau ; soumission au retour du réseau.

### Sprint 8 — Un agent préfectoral numérise une recette et réalise une visite sans réseau ; litiges et alertes sont traités.

#### US-082 · Numériser une recette orale et créer un dossier praticien sur le terrain
*Application mobile de terrain* · **Must** · 5 points · cas : UC-32, UC-35

> En tant qu’admin préfectoral, je veux numériser une recette orale et créer un dossier praticien sur le terrain, afin d’enregistrer les savoirs hors réseau.

Critères d’acceptation :
- Saisie assistée, voix par champ dans la langue du praticien, rattachement au praticien.
- Création d’un dossier avec identité, spécialité, localité, pièces et photo.

#### US-083 · Gérer mon agenda de visites et déposer le compte rendu signé depuis le téléphone
*Application mobile de terrain* · **Must** · 3 points · cas : UC-30

> En tant qu’admin préfectoral, je veux gérer mon agenda de visites et déposer le compte rendu signé depuis le téléphone, afin de valider sur place.

Critères d’acceptation :
- Agenda des visites, itinéraire, photo du compte rendu signé ajoutée au dossier.

#### US-101 · Arbitrer les litiges
*Sécurité sanitaire, litiges, alertes* · **Should** · 3 points · cas : UC-43

> En tant qu’admin régional, je veux arbitrer les litiges, afin de rendre des décisions motivées.

Critères d’acceptation :
- Pièces et échanges, décision motivée notifiée.
- Le recours de 30 jours après un rejet définitif passe par un litige.

#### US-102 · Traiter les alertes territoriales
*Sécurité sanitaire, litiges, alertes* · **Should** · 3 points · cas : UC-44

> En tant qu’admin régional, je veux traiter les alertes territoriales, afin de réagir vite.

Critères d’acceptation :
- Alertes : hausse de pathologie, désert thérapeutique, dossier bloqué.
- Accusé de réception et relance.

### Sprint 9 — Chaque profil dispose de son tableau de bord et de ses rapports.

#### US-090 · Un tableau de bord adapté à mon profil
*Tableaux de bord et rapports* · **Should** · 5 points · cas : UC-67

> En tant qu’administrateur, je veux un tableau de bord adapté à mon profil, afin de piloter mon périmètre.

Critères d’acceptation :
- Indicateurs du cahier des charges pour chaque profil (§6.2 à 6.6).
- Données limitées à la zone du compte.

#### US-091 · Générer des rapports PDF et XLSX
*Tableaux de bord et rapports* · **Should** · 3 points · cas : UC-36, UC-67

> En tant qu’administrateur, je veux générer des rapports PDF et XLSX, afin de rendre compte.

Critères d’acceptation :
- Rapport mensuel préfectoral prérempli, envoi au régional.
- Historique des exports.

### Sprint 10 — Un visiteur cherche « paludisme » dans sa langue et voit les traitements certifiés ; la DG pilote les menus.

#### US-110 · Un site installable dans ma langue
*Site public* · **Must** · 5 points · cas : UC-03

> En tant que visiteur, je veux un site installable dans ma langue, afin de l’utiliser facilement sur mon téléphone.

Critères d’acceptation :
- La langue de la région est proposée à la première visite et mémorisée.
- Interface en français et en anglais ; site installable (PWA).

#### US-111 · Rechercher une maladie
*Site public* · **Must** · 8 points · cas : UC-01

> En tant que visiteur, je veux rechercher une maladie, afin de trouver ses traitements certifiés.

Critères d’acceptation :
- Recherche sans accents ni fautes, par nom français, anglais ou dénomination.
- Carte par traitement : photos, noms français et voix des plantes, cycle, note.
- Repli sur la voix française avec « traduction en cours ».

#### US-117 · Lire les pages institutionnelles
*Site public* · **Should** · 3 points · cas : UC-09

> En tant que visiteur, je veux lire les pages institutionnelles, afin de comprendre SABOU.

Critères d’acceptation :
- À propos, Concept, Devenir partenaire (formulaire), Mentions légales.

#### US-130 · Piloter les menus et sliders du site
*Pilotage du site* · **Must** · 5 points · cas : UC-64

> En tant que DG, je veux piloter les menus et sliders du site, afin de le modifier sans technicien.

Critères d’acceptation :
- 7 entrées visibles au plus dans le header.
- Aperçu avant publication, publication immédiate, historique des publications.

### Sprint 11 — Un visiteur écoute un traitement en malinké, même sans réseau, et trouve un praticien certifié.

#### US-112 · Écouter une page traitement
*Site public* · **Must** · 8 points · cas : UC-02

> En tant que visiteur, je veux écouter une page traitement, afin de comprendre le traitement dans ma langue.

Critères d’acceptation :
- Sections dans l’ordre, lecteur par section, vitesse réglable, transcription française.
- Contre-indications en alerte ; mention « SABOU informe, ne prescrit pas ».

#### US-113 · Télécharger un traitement pour l’écouter sans réseau
*Site public* · **Must** · 5 points · cas : UC-07

> En tant que visiteur, je veux télécharger un traitement pour l’écouter sans réseau, afin de le réécouter chez moi.

Critères d’acceptation :
- Après téléchargement, la page et ses voix fonctionnent en mode avion.

#### US-114 · Consulter l’annuaire des praticiens certifiés
*Site public* · **Must** · 5 points · cas : UC-04

> En tant que visiteur, je veux consulter l’annuaire des praticiens certifiés, afin d’en trouver un près de chez moi.

Critères d’acceptation :
- Seuls les praticiens certifiés avec certificat actif apparaissent.
- Filtres région, spécialité, statut, langue ; 12 cartes par page.

### Sprint 12 — Un visiteur consulte le Dictionnaire, vérifie un certificat et un citoyen témoigne.

#### US-115 · Consulter le Dictionnaire
*Site public* · **Must** · 5 points · cas : UC-05

> En tant que visiteur, je veux consulter le Dictionnaire, afin de connaître une plante ou une maladie.

Critères d’acceptation :
- Fiche plante : nom scientifique en italique, nom français, voix du nom dans chaque langue.
- Aucun texte en langue nationale affiché.

#### US-116 · Vérifier un certificat par numéro ou QR
*Site public* · **Must** · 5 points · cas : UC-06

> En tant que visiteur, je veux vérifier un certificat par numéro ou QR, afin de savoir si un praticien est authentique.

Critères d’acceptation :
- Verdict vert, ambre ou rouge en moins de 5 s.
- Vérification de la signature hors ligne avec la clé publique en cache.

#### US-120 · Témoigner sur un traitement
*Communauté* · **Must** · 8 points · cas : UC-11, UC-24, UC-34

> En tant que citoyen, je veux témoigner sur un traitement, afin de partager mon expérience.

Critères d’acceptation :
- Un témoignage par traitement ; modification → nouvelle modération ; retrait possible.
- Modération par le préfectoral de la zone ou la DG ; réponse du praticien modérée.
- Prénom et initiale seulement ; notes recalculées.

### Sprint 13 — Un citoyen demande une plante par la voix et un praticien la lui envoie ; le site est rapide en 3G.

#### US-121 · Demander une plante par son nom local
*Communauté* · **Must** · 8 points · cas : UC-12, UC-23

> En tant que citoyen, je veux demander une plante par son nom local, afin de l’obtenir d’un praticien de ma localité.

Critères d’acceptation :
- Nom dit (voix) ou écrit ; propositions de plantes à écouter.
- Envoi au praticien le plus proche ; suivi Reçue → À envoyer → Envoyée.

#### US-122 · Participer au forum
*Communauté* · **Should** · 5 points · cas : UC-13

> En tant que citoyen, je veux participer au forum, afin d’échanger avec la communauté.

Critères d’acceptation :
- Discussions par catégorie et par zone ; modération selon la zone.
- Signalement traité sous 48 h ; questions de toxicité routées vers le Comité.

#### US-118 · Des pages rapides et accessibles
*Site public* · **Must** · 5 points · cas : —

> En tant que visiteur sur réseau faible, je veux des pages rapides et accessibles, afin d’utiliser le site partout.

Critères d’acceptation :
- Pages principales affichées en moins de 3 s en 3G simulée.
- Contraste AA, focus visible, cibles de 40 px, textes alternatifs.

### Sprint 14 — Un praticien paie GOLD par Mobile Money, publie un 4e traitement et renouvelle son certificat.

#### US-140 · Payer par Orange Money ou MTN MoMo
*Services (paiements, boutique, formation)* · **Must** · 8 points · cas : UC-76

> En tant que praticien, je veux payer par Orange Money ou MTN MoMo, afin de souscrire GOLD ou d’acheter.

Critères d’acceptation :
- Paiement initié, confirmé par l’opérateur, tracé (référence, statut).
- Un paiement échoué ne donne aucun droit ; remboursement possible.

#### US-141 · Souscrire et renouveler GOLD
*Services (paiements, boutique, formation)* · **Must** · 5 points · cas : UC-26

> En tant que praticien, je veux souscrire et renouveler GOLD, afin de publier plus de 3 traitements.

Critères d’acceptation :
- Formules Gratuit, GOLD, Institution ; délai de grâce de 30 jours.
- À l’expiration : traitements déjà certifiés maintenus, boutique suspendue.

#### US-153 · Renouveler mon certificat
*Certification et certificat* · **Must** · 3 points · cas : UC-28

> En tant que praticien, je veux renouveler mon certificat, afin de rester certifié.

Critères d’acceptation :
- Dossier de renouvellement ouvert 60 jours avant l’échéance, 6 étapes au contenu proportionné.
- Visite requise seulement selon les critères de R-QR-07 (dont tirage au sort de 20 %).

### Sprint 15 — Un praticien GOLD vend un produit validé ; les exports sont disponibles.

#### US-142 · Vendre des produits validés
*Services (paiements, boutique, formation)* · **Should** · 5 points · cas : UC-27

> En tant que praticien GOLD, je veux vendre des produits validés, afin de compléter mes revenus.

Critères d’acceptation :
- Validation scientifique avant publication ; stock et rupture.
- Commission SABOU de 10 % calculée sur chaque commande.

#### US-143 · Suivre des modules de formation
*Services (paiements, boutique, formation)* · **Could** · 3 points · cas : UC-29

> En tant que praticien, je veux suivre des modules de formation, afin d’obtenir des attestations.

Critères d’acceptation :
- 3 modules du cahier des charges ; attestation numérotée.

#### US-152 · Exporter les registres et le Dictionnaire
*Interopérabilité (API, DHIS2, exports)* · **Should** · 3 points · cas : UC-67

> En tant qu’administrateur, je veux exporter les registres et le Dictionnaire, afin de partager les données.

Critères d’acceptation :
- CSV pour les registres, JSON pour le Dictionnaire, limités à ma zone.

### Sprint 16 — Un partenaire et DHIS2 reçoivent les indicateurs anonymisés.

#### US-150 · Une API documentée et sécurisée
*Interopérabilité (API, DHIS2, exports)* · **Must** · 5 points · cas : UC-66, UC-75

> En tant que partenaire, je veux une API documentée et sécurisée, afin de consommer les indicateurs anonymisés.

Critères d’acceptation :
- OAuth2 identifiants client, quota par partenaire, 100 requêtes/min/IP.
- Aucune donnée nominative ; documentation OpenAPI publiée.

#### US-151 · Recevoir les indicateurs de SABOU dans DHIS2
*Interopérabilité (API, DHIS2, exports)* · **Should** · 5 points · cas : UC-75

> En tant que ministère, je veux recevoir les indicateurs de SABOU dans DHIS2, afin de les intégrer au système national.

Critères d’acceptation :
- Format et indicateurs conformes à l’accord obtenu au prototype 3.5.
- Envoi planifié et journalisé.

### Sprint 17 — La plateforme tient la charge, passe l’audit de sécurité et tourne en production souveraine.

#### US-160 · Des tests de charge
*Recette et déploiement* · **Must** · 5 points · cas : —

> En tant qu’équipe, je veux des tests de charge, afin de garantir la tenue au pic national.

Critères d’acceptation :
- Scénario de pic validé avec k6, temps de réponse et taux d’erreur sous les seuils fixés.

#### US-161 · Un audit de sécurité externe
*Recette et déploiement* · **Must** · 5 points · cas : —

> En tant que DG, je veux un audit de sécurité externe, afin de mettre en production sans faille critique.

Critères d’acceptation :
- Rapport d’audit sans vulnérabilité critique restante.

#### US-162 · Une production souveraine redondante
*Recette et déploiement* · **Must** · 3 points · cas : —

> En tant que DG, je veux une production souveraine redondante, afin d’atteindre 99,9 %.

Critères d’acceptation :
- 3 serveurs, base en haute disponibilité, sauvegardes hors site, restauration testée.

### Sprint 18 — Le pilote de Haute Guinée est réussi ; la généralisation est planifiée.

#### US-163 · Former les administrateurs et fournir les guides par profil
*Recette et déploiement* · **Must** · 5 points · cas : —

> En tant que DG, je veux former les administrateurs et fournir les guides par profil, afin qu’ils soient autonomes.

Critères d’acceptation :
- Sessions de formation réalisées ; un guide par profil publié.

#### US-164 · Un pilote en Haute Guinée (Kankan, malinké)
*Recette et déploiement* · **Must** · 8 points · cas : —

> En tant que DG, je veux un pilote en Haute Guinée (Kankan, malinké), afin de valider la plateforme sur le terrain.

Critères d’acceptation :
- Tous les critères de recette du cahier des charges §11.3 sont passés.
- Retours du pilote traités ou planifiés.

#### US-165 · Un plan de généralisation aux trois autres régions
*Recette et déploiement* · **Must** · 3 points · cas : —

> En tant que DG, je veux un plan de généralisation aux trois autres régions, afin d’étendre SABOU.

Critères d’acceptation :
- Calendrier, référents linguistiques et formations prévus par région.

## 5. Definition of Ready (un récit peut entrer dans un sprint)

- Le récit suit le format « En tant que… je veux… afin de… » et renvoie à un cas d’utilisation ou à une règle R-xxx.
- Ses critères d’acceptation sont écrits et compris par l’équipe.
- Il est estimé à 8 points ou moins ; sinon, il est découpé.
- Ses dépendances (autre récit, prototype, accord externe) sont levées.
- Les maquettes ou textes nécessaires sont disponibles.

## 6. Definition of Done (un récit est terminé)

| Domaine | Critère |
|---|---|
| Fonctionnel | Tous les critères d’acceptation sont vérifiés et démontrés au Product Owner |
| Règles métier | Les règles R-xxx concernées sont couvertes par des tests automatiques ; les cas interdits sont testés |
| Code | Relu et approuvé par un autre développeur ; tant que l’équipe ne compte qu’un seul développeur, la relecture est faite par le maître d’œuvre. Lint et formatage sans erreur ; pipeline vert avant toute fusion |
| Tests | Tests unitaires et d’intégration passés dans l’intégration continue (base PostgreSQL réelle pour les règles en base) ; test de bout en bout pour les parcours utilisateur |
| Sécurité | Contrôle d’accès par rôle et par zone vérifié ; aucune donnée nominative exposée ; analyse des dépendances et des images sans faille critique |
| Langues | Textes en français (et anglais si prévu), aucun texte en langue nationale ; repli sur la voix française vérifié |
| Accessibilité | Contraste AA, focus visible, cibles de 40 px, textes alternatifs (écrans concernés) |
| Performance | Écrans publics concernés affichés en moins de 3 s en 3G simulée |
| Traçabilité | Décisions journalisées ; notifications vérifiées quand le récit en prévoit |
| Documentation | API (OpenAPI) et documents concernés mis à jour ; migrations de base versionnées |
| Déploiement | Déployé sur l’environnement de recette et vérifié |

## 7. Risques du découpage et parades

| Risque | Parade |
|---|---|
| Backlog trop gros | Détail seulement pour les 3 prochains sprints ; raffinement à chaque sprint ; récits de 8 points au plus |
| Sprints qui débordent | 20 % de marge ; vélocité mesurée dès S1–S2 ; un récit non terminé retourne au backlog, il n’est pas « presque fini » |
| Dépendances externes (hébergeur, DHIS2, Mobile Money, SMS) | Tâches du Product Owner lancées dès maintenant, avec échéances avant les sprints concernés |
| Prototype négatif (S0) | Décision écrite et ajustement de `05_Choix_Techniques.md` avant S1 |
| Voix manquantes au lancement | Atelier linguistique avant S4 ; repli sur la voix française prévu par les règles |
