# SABOU — Backlog produit, sprints et Definition of Done

Entrée : `06_Cas_Utilisation.md` (cas d’utilisation validés). Méthode : Scrum, sprints de **2 semaines**. Outil cible : **GitLab** (issues, epics, milestones = sprints), cohérent avec `05_Choix_Techniques.md` ; le fichier `07_Backlog_import_GitLab.csv` permet l’import direct des récits. En attendant l’hébergeur souverain, le dépôt est sur GitHub ; la bascule vers GitLab est le récit US-008 (voir la décision dans `05_Choix_Techniques.md` §2.11).

**Critère de passage respecté** : chaque récit ci-dessous a des critères d’acceptation. **Question de contrôle** : chaque sprint a un objectif livrable et démontrable seul.

## 1. Hypothèses de planification

- Équipe de développement de 5 personnes (2 back-end, 1 web, 1 mobile, 1 qualité et exploitation) + un Product Owner (IPCREATECH) et un Scrum Master.
- Capacité visée : environ 20 à 25 points par sprint, dont **20 % de marge** pour les imprévus et la dette technique. À recalibrer après les sprints 1 et 2 avec la vélocité réelle.
- Estimation en points de complexité (suite de Fibonacci : 1, 2, 3, 5, 8). Un récit à plus de 8 points doit être découpé.
- Priorité MoSCoW : **Must** (indispensable au lancement), **Should** (important), **Could** (si le temps le permet).
- **Contre le risque de backlog trop gros** : seuls les sprints 0 à 3 sont détaillés au format « Étant donné… quand… alors… » ; les récits suivants ont des critères plus courts, à affiner lors du raffinement qui précède chaque sprint.

Volume : **80 récits**, **361 points**, **19 sprints** (sprint 0 à sprint 18), soit environ **39 semaines** de développement : le sprint 0 dure 3 semaines (mise en place et prototypes), les autres 2 semaines.

Les sprints S9, S15 et S16 sont volontairement plus légers : ils absorbent les retards et la dette technique de leur phase.

Réestimation du 2 novembre 2026, à la clôture de US-001 : US-007 passe de 2 à 3 points (analyse Semgrep) et US-010 de 5 à 8 points (contrôles axe et Lighthouse CI). S1 monte ainsi à 29 points, au-dessus de la capacité visée : un récit de S1 sera reporté en S2 lors du raffinement de S1.

Découpage du 7 novembre 2026 (décision du maître d’œuvre) : US-040 est découpé en US-040a (API et base, 5 points) et US-040b (application mobile, 5 points). S2 passe de 26 à 31 points. Les recettes vocales rejoignent le dossier avec le Studio (S5).

Réestimation du 14 novembre 2026 (décision du maître d’œuvre) : US-047 (rejet définitif) passe de 3 à 5 points, car la DG peut aussi rejeter un praticien déjà certifié sans dossier en cours (R-QR-06) ; S3 passe de 31 à 33 points et l’epic E04 de 44 à 46 points. Un critère est ajouté à US-061 : les traitements d’un praticien rejeté sortent des files.

Report du 12 novembre 2026 (décision du maître d’œuvre) : US-008 (bascule vers le GitLab souverain, 3 points) sort de S3, qui passe de 34 à 31 points ; il revient au premier sprint qui suit le choix de l’hébergeur souverain (prototype 3.4). D’ici là, le pipeline tourne en local (jusqu’au 1er décembre 2026), puis sur GitHub.

Ajout du 8 novembre 2026, soir (décision du maître d’œuvre) : US-016 se termine avec un LCP de 4 s en 3G pour les pages de l’application de gestion qui attendent des données (tableau de bord, Comptes, Référentiels, Invitation), 3 s ailleurs. Le nouveau récit US-017 (environ 1 jour, 3 points) ramène 3 s partout ; placé en S3 par le maître d’œuvre (8 novembre 2026) : S3 passe de 28 à 31 points.

Ajout du 9 novembre 2026 (décision du maître d’œuvre) : nouveau récit US-018, socle de l’application mobile (thème de la charte, composants communs, navigation selon le profil), 3 points, en S3 : S3 passe de 31 à 34 points ; l’epic E08 passe à 5 récits et 27 points. La connexion des agents préfectoraux dans l’application arrive avec leur première rubrique (US-082, S8).

Ajout du 8 novembre 2026 (décision du maître d’œuvre) : US-016 (base de design et tableau de bord d’accueil, 5 points) entre en S2 ; pour ne pas le surcharger, US-041 (visites terrain, 5 points) passe en S3. S2 reste à 31 points, S3 passe de 23 à 28 points.

Découpage du 3 novembre 2026 (décision du maître d’œuvre) : US-007 se limite à l’analyse Semgrep (1 point, fait) ; le déploiement automatique de la recette devient le récit US-015 (2 points), placé en fin de S1, juste avant la revue du sprint. S0 passe à 34 points, S1 à 31.

Réestimation du 2 novembre 2026, au cadrage des prototypes (décision du maître d’œuvre) : US-004 est découpé ; il passe de 8 à 5 points (lignes de la base, conflit, cloisonnement par zone) et le nouveau récit US-009 (pièces jointes et voix hors réseau) prend 4 points. US-005 passe de 5 à 6 points : il crée le squelette Flutter et le job Flutter du pipeline, critère repris de US-004. S0 monte ainsi de 34 à 36 points.

Réestimation du 3 novembre 2026 (décision du maître d’œuvre) : le chiffrement de la base du téléphone (SQLCipher, clé dans le magasin sécurisé Android) entre dans US-004, qui passe de 5 à 6 points ; le surcoût est mesuré sur téléphone d’entrée de gamme. S0 passe à 35 points.

## 2. Plan des sprints

| Sprint | Phase du CdC | Objectif du sprint (livrable démontrable seul) | Récits | Points |
|---|---|---|---|---|
| **S0** | 1. Cadrage (fin de la phase 1) | L’équipe peut développer et tester ; les trois prototypes techniques sont tranchés. | US-001, US-002, US-003, US-004, US-005, US-006, US-007, US-009 | 35 |
| **S1** | 2. Socle et sécurité | Un administrateur se connecte avec double facteur et ne voit que les données de sa zone. | US-010, US-011, US-012, US-012b, US-013, US-014, US-020, US-021, US-030, US-015 | 35 |
| **S2** | 2. Socle et sécurité | Un praticien soumet son dossier ; il est validé sur le terrain, consolidé et expertisé ; il reçoit un SMS à chaque étape. | US-016, US-031, US-040a, US-040b, US-042, US-043, US-044 | 31 |
| **S3** | 2. Socle et sécurité | La DG approuve, le certificat signé est émis et le praticien apparaît comme certifié. | US-041, US-045, US-046, US-047, US-048, US-049, US-017, US-018 | 33 |
| **S4** | 3. Application de gestion et mobile | Une fiche plante validée, avec la voix de son nom dans les 5 langues, est consultable dans l’application. | US-050, US-051, US-052, US-053, US-070, US-071 | 24 |
| **S5** | 3. Application de gestion et mobile | Un traitement saisi au Studio web suit tout le circuit jusqu’à la certification. | US-060, US-061, US-062, US-063, US-064 | 22 |
| **S5b** | 3. Application de gestion et mobile | Un praticien s’inscrit et saisit un traitement depuis l’application mobile ; le site ne sert plus que le grand public. *Sprint intermédiaire de l’alignement (17/11/2026).* | US-066, US-067, US-068 | 18 |
| **S5c** | 3. Application de gestion et mobile | Le compte DG est unique et récupérable sous contrôle ; praticien et citoyen retrouvent leur mot de passe par SMS ; plantes, dossiers terrain et langues suivent le cahier des charges. *Corrections de l’alignement (17/11/2026).* | US-024, US-069, US-054, US-055, US-040c, US-040d, US-012c | 26 |
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
| Agrégateur SMS (contrat, **nom d’expéditeur** « SABOU ») | Avant la mise en service | US-031 | **Décidé le 12 novembre 2026 : API SMS d’Orange Guinée**, branchée à la mise en service (US-031 livré avec l’envoi simulé, aucun achat d’ici là). À obtenir d’Orange par écrit : livraison vers MTN et Cellcom, contrat avec facture, accusés de réception ; nom « SABOU » par le formulaire d’Orange (environ 5 jours ouvrés) |
| Hébergement de la recette (sprints 1 et 2, données fictives) | Avant la revue de S1 | US-015 | **Reporté** (décision du 3 novembre 2026) : serveur unique sous Docker Compose recommandé plutôt que Vercel (la recette a besoin de l’API et de la base) ; hébergeur, adresse, accès et clé de déploiement à trancher |
| Prototype 3.4 — choisir l’hébergeur souverain (3 serveurs, sauvegarde hors site, coût) | Avant S3 | US-008, US-162 | À lancer |
| Atelier linguistique : un référent par langue, voix et transcriptions des noms | Avant S4 | US-053, US-071 | Reporté (à revoir plus tard) |
| Validation du dispositif de sécurité sanitaire par le ministère de la Santé | Avant S6 | US-100 | Reporté (à revoir plus tard) |
| Accords Orange Money et MTN MoMo (comptes marchands, accès API) | Avant S14 | US-140 | Reporté (à revoir plus tard) |
| Prototype 3.5 — contact DHIS2 au ministère, liste des indicateurs et format | Avant S14 | US-151 | Reporté (à revoir plus tard) |

## 3. Epics

| Epic | Intitulé | Phase | Récits | Points |
|---|---|---|---|---|
| E00 | Fondations techniques | 1 | 10 | 39 |
| E01 | Identité et accès | 2 | 5 | 23 |
| E02 | Référentiels | 2 | 2 | 5 |
| E03 | Audit et notifications | 2 | 2 | 8 |
| E04 | Certification et certificat | 2 | 11 | 46 |
| E05 | Dictionnaire Impérial | 3 | 4 | 14 |
| E06 | Traitements et circuit | 3 | 5 | 22 |
| E07 | Voix et gouvernance linguistique | 3 | 6 | 24 |
| E08 | Application mobile de terrain | 3 | 5 | 27 |
| E09 | Tableaux de bord et rapports | 3 | 2 | 8 |
| E10 | Sécurité sanitaire, litiges, alertes | 3 | 3 | 11 |
| E11 | Site public | 4 | 9 | 49 |
| E12 | Communauté | 4 | 3 | 21 |
| E13 | Pilotage du site | 4 | 1 | 5 |
| E14 | Services (paiements, boutique, formation) | 5 | 4 | 21 |
| E15 | Interopérabilité (API, DHIS2, exports) | 5 | 3 | 13 |
| E16 | Recette et déploiement | 6 | 6 | 29 |

## 4. Backlog priorisé (par sprint)

### Sprint 0 — L’équipe peut développer et tester ; les trois prototypes techniques sont tranchés.

#### US-001 · Un dépôt monorepo avec intégration continue
*Fondations techniques* · **Must** · 3 points · cas : —

> En tant qu’équipe, je veux un dépôt monorepo avec intégration continue, afin que chaque changement soit vérifié automatiquement.

Critères d’acceptation :
- Étant donné une demande de fusion, quand elle est poussée, alors le lint, le formatage, les tests et la compilation de chaque application (`apps/api`, `apps/admin`, `apps/site`, `packages/types`) s’exécutent.
- Étant donné une fusion sur `main`, quand elle est poussée, alors le même pipeline s’exécute.
- Étant donné une dépendance avec une faille critique, quand l’analyse Trivy s’exécute, alors le pipeline échoue.
- Chaque étape du pipeline est un script de `infra/ci/` exécutable en local ; le fichier GitHub Actions ne fait que les appeler. Les actions GitHub et Trivy sont épinglés par SHA.
- ~~Étant donné un test en échec, quand la demande de fusion est examinée, alors la fusion est bloquée.~~ **Reporté à US-008** (décision du maître d’œuvre, novembre 2026) : un dépôt privé sur un compte GitHub gratuit n’autorise ni protection de branche ni règles de fusion. Jusqu’à US-008, le blocage se fait **par convention** : le maître d’œuvre ne fusionne une demande que si son pipeline est vert.

Périmètre : les applications sont des squelettes minimaux (un test chacun, aucune fonctionnalité). Hors périmètre : application mobile (US-004), tests sur un vrai PostgreSQL (US-003), analyse des images Docker (US-002), déploiement (US-015).

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
*Fondations techniques* · **Must** · 6 points · cas : UC-74

> En tant qu’équipe, je veux un prototype de synchronisation hors réseau (Flutter + PowerSync), afin de valider ou remplacer ce choix technique.

Périmètre : les lignes de la base (dossier et ses données). Les fichiers (pièces et voix) sont traités par US-009. PowerSync en édition auto-hébergée (licence FSL), dans Docker Compose ; PostgreSQL en réplication logique. Base du téléphone chiffrée (SQLCipher).

Critères d’acceptation :
- Étant donné un téléphone sans réseau, quand un agent saisit un dossier, alors il est conservé sur le téléphone.
- Étant donné une synchronisation coupée puis rétablie, quand elle s’exécute, alors le dossier apparaît sur le serveur sans perte.
- Étant donné une modification concurrente, quand la synchronisation s’exécute, alors la version validée du serveur prime et l’autre reste en brouillon (R-DON-04, précisée dans 04_Regles_Metier.md).
- Étant donné un agent d’une zone, quand la synchronisation s’exécute, alors il ne reçoit aucune donnée d’une autre zone (test automatique obligatoire : les règles de synchronisation filtrent en dehors du RLS).
- Étant donné la base du téléphone, quand on la lit sans la clé, alors elle est illisible ; la clé est gardée dans le magasin sécurisé du téléphone (Keystore Android), jamais dans le code ; le surcoût du chiffrement est mesuré sur téléphone d’entrée de gamme et noté dans 05_Choix_Techniques.md.
- Une décision écrite « validé » ou « solution remplacée » est ajoutée à 05_Choix_Techniques.md ; elle dit ce que l’équipe ferait si la licence FSL devenait bloquante.

#### US-009 · Synchroniser les pièces jointes et la voix hors réseau
*Fondations techniques* · **Must** · 4 points · cas : UC-74

> En tant qu’agent de terrain, je veux que les pièces et les voix d’un dossier saisies sans réseau arrivent sur le serveur, afin qu’aucun fichier ne soit perdu.

Périmètre : PowerSync ne transporte que des lignes. Les fichiers suivent une file d’envoi sur le téléphone, passent par l’API (authentification, zone, taille, type) qui les dépose dans SeaweedFS ; SeaweedFS n’est pas exposé. Envoi du téléphone vers le serveur seulement.

Critères d’acceptation :
- Étant donné un téléphone sans réseau, quand un agent joint des photos de pièces et une voix à un dossier, alors les fichiers sont conservés sur le téléphone, avec leur empreinte SHA-256.
- Étant donné un envoi coupé puis rétabli, quand il reprend, alors chaque fichier arrive sur le serveur avec une empreinte identique ; le téléphone ne supprime sa copie qu’après confirmation du serveur.
- Étant donné un fichier manquant ou une empreinte différente, quand le dossier est soumis, alors la soumission est refusée.
- Étant donné un agent d’une zone, quand il envoie un fichier pour un dossier d’une autre zone, alors l’envoi est refusé.

#### US-005 · Un prototype de chaîne audio
*Fondations techniques* · **Must** · 6 points · cas : UC-73

> En tant qu’équipe, je veux un prototype de chaîne audio, afin de garantir une voix claire et légère sur téléphone d’entrée de gamme.

Périmètre : crée le squelette de l’application Flutter (`apps/mobile/`) et son job dans le pipeline. Traitement côté serveur (CdC §8) ; le téléphone envoie de l’Opus 32 kbit/s (Android 10 et plus) ou de l’AAC 48 kbit/s (Android 8 et 9). Android 8.0 minimum. Profil « 3G » du pipeline : 400 kbit/s en réception et en envoi, 400 ms d’aller-retour, bloquant.

Critères d’acceptation :
- Étant donné un Android d’entrée de gamme, quand on enregistre 90 s dans un lieu bruyant, alors le fichier traité (RNNoise, normalisation, Opus 24 kbit/s) pèse au plus 300 Ko et reste compréhensible.
- Étant donné une connexion 3G simulée (400 kbit/s en réception et en envoi, 400 ms d’aller-retour), quand on lance la lecture d’une voix traitée de 90 s, alors la lecture démarre en moins de 3 s, avant la fin du téléchargement. Mesure automatique dans le navigateur (Chromium piloté par Playwright, site public), du clic à l’événement `playing`, sans connexion déjà ouverte avec le serveur audio, au travers du relais de bridage de `infra/local` (et non du bridage de Chromium, pour que l’établissement de la connexion soit compté). Essai manuel dans l’application Flutter, même seuil, au travers du même relais.
- Étant donné une demande de fusion qui modifie `apps/mobile/`, quand elle est poussée, alors un job Flutter (analyse, tests, compilation) s’exécute ; il ne s’exécute pas si `apps/mobile/` n’est pas modifié.
- Une décision écrite est ajoutée à 05_Choix_Techniques.md.

#### US-006 · Un prototype de QR signé vérifiable hors ligne
*Fondations techniques* · **Must** · 5 points · cas : UC-06

> En tant qu’équipe, je veux un prototype de QR signé vérifiable hors ligne, afin de valider le format CBOR/COSE/Base45 et Ed25519.

Critères d’acceptation :
- Étant donné un QR généré et signé, quand un téléphone sans réseau le scanne, alors le verdict « authentique » s’affiche.
- Étant donné un QR dont une donnée est modifiée, quand il est scanné, alors le verdict « falsifié » (rouge) s’affiche.
- Une décision écrite est ajoutée à 05_Choix_Techniques.md.

#### US-007 · Le code est analysé par Semgrep à chaque demande de fusion
*Fondations techniques* · **Must** · 1 point · cas : —

> En tant qu’équipe, je veux que chaque demande de fusion soit analysée par Semgrep, afin de bloquer les failles graves avant la fusion.

Critères d’acceptation :
- Étant donné une demande de fusion, quand elle est poussée, alors le code est analysé par Semgrep (édition communautaire, image épinglée par empreinte, lancée par un script de `infra/ci/`) et un résultat de gravité haute fait échouer le pipeline. À livrer avant S2. CodeQL est écarté : il est payant sur un dépôt privé.

### Sprint 1 — Un administrateur se connecte avec double facteur et ne voit que les données de sa zone.

#### US-010 · Me connecter avec un double facteur obligatoire
*Identité et accès* · **Must** · 8 points · cas : UC-65

> En tant qu’administrateur, je veux me connecter avec un double facteur obligatoire, afin que mon compte ne puisse pas être usurpé.

Critères d’acceptation :
- Étant donné un administrateur sans double facteur, quand il se connecte, alors il doit l’activer avant d’accéder à l’application.
- Étant donné un praticien ou un citoyen, quand il se connecte, alors le double facteur est proposé mais pas imposé.
- Étant donné 5 échecs de connexion, quand une 6e tentative arrive, alors le compte est bloqué temporairement et l’événement est journalisé.
- Premier récit avec de vraies pages : étant donné une demande de fusion, quand le pipeline s’exécute, alors les pages livrées passent les tests d’accessibilité axe (Playwright, WCAG 2.2 AA) et Lighthouse CI (réseau 3G et processeur bridés), avec des seuils bloquants. Chaque récit suivant qui ajoute des pages les ajoute à ces contrôles.

Écarts à l’écran « Connexion » du CdC (maquette), validés par le maître d’œuvre le 5 novembre 2026 : pas de sélecteur de profil (le profil vient du compte) ; « Mot de passe oublié » renvoie vers l’administrateur, la réinitialisation par e-mail demandera un service SMTP et un récit à créer ; « Explorer la démo sans compte » hors de ce récit. Décisions techniques : `05_Choix_Techniques.md` §2.20.

Mise à jour du 17 novembre 2026 (décision du maître d'œuvre, demande #60) : la page de Keycloak est la page de connexion du §5.2, sans page intermédiaire ; « Mot de passe oublié » par e-mail pour les quatre profils de gestion, avec alerte par e-mail à chaque changement de mot de passe ou de double facteur (`05_Choix_Techniques.md` §2.60). **Reporté** : « Explorer la démo sans compte » (§5.2), récit à planifier.

#### US-011 · Ne voir que les données de ma zone
*Identité et accès* · **Must** · 5 points · cas : UC-65

> En tant qu’admin préfectoral ou régional, je veux ne voir que les données de ma zone, afin de respecter le moindre privilège.

Critères d’acceptation :
- Étant donné l’admin préfectoral de Labé, quand il liste les praticiens, alors seuls ceux de Labé apparaissent, même par appel direct à l’API.
- Étant donné l’admin régional de Kankan, quand il liste les dossiers, alors seuls ceux des préfectures de sa région apparaissent.
- Étant donné une requête SQL sans contexte de zone, quand elle s’exécute sous le rôle applicatif, alors elle ne renvoie aucune ligne (RLS).
- Décisions du maître d’œuvre du 6 novembre 2026 (lot B) : API seule (`GET /api/praticiens`, `GET /api/dossiers`), écrans en S2 ; RLS sur les praticiens, les dossiers et leurs tables filles, et les saisies de terrain, les autres tables à zone suivent leur récit ; accès internes par fonctions SQL dédiées, sans rôle qui contourne le RLS ; Comité national, praticien limité à sa fiche, citoyen sans accès (05_Choix_Techniques.md §2.23).

#### US-012 · Créer ou inviter un compte et lui attribuer rôle, zone et langues de travail
*Identité et accès* · **Must** · 3 points · cas : UC-65

> En tant que DG, je veux créer ou inviter un compte et lui attribuer rôle, zone et langues de travail, afin d’organiser les équipes.

Critères d’acceptation :
- Étant donné une invitation envoyée, quand la personne l’accepte, alors son compte a exactement le rôle, la zone et les langues attribués.
- Étant donné un rôle régional sans région, quand la DG enregistre, alors l’enregistrement est refusé.
- Décisions du maître d’œuvre du 6 novembre 2026 (lot A, avec US-013) : invitation par lien à usage unique valable 72 h, que la DG transmet elle-même (aucun service d’envoi) ; l’invité choisit son mot de passe et, s’il est administrateur, active le double facteur. Keycloak est la seule source des mots de passe et du double facteur : la table `utilisateur` garde le rôle, la zone, les langues et l’identifiant Keycloak.

#### US-012b · Consulter les rôles et leurs droits ; téléphone du compte
*Identité et accès* · **Must** · 2 points · cas : UC-65 · ajouté le 17 novembre 2026 (décision du maître d’œuvre)

> En tant que DG, je veux consulter ce que chaque profil peut faire et joindre un administrateur par téléphone, afin d’attribuer le bon rôle et d’organiser les équipes.

Critères d’acceptation :
- Étant donné la page Comptes, quand la DG ouvre l’onglet « Rôles et droits », alors elle voit la matrice des permissions du cahier des charges (§3.2), ligne à ligne et profil par profil, puis les précisions des règles métier avec leur source ; les droits pas encore développés sont marqués « À venir » ; rien n’y est modifiable.
- Chaque droit développé affiché est celui que le serveur applique : un test essaie l’action avec chaque profil et échoue si la matrice et le serveur divergent.
- Étant donné le formulaire d’invitation, quand la DG choisit un rôle, alors le périmètre et la mission de ce rôle s’affichent sous le choix (maquette de gestion, diapositive 2).
- Le téléphone est obligatoire pour les quatre profils de gestion (décision du maître d’œuvre du 17/11/2026) ; un mobile guinéen saisi librement est enregistré sous la forme +224 ; un numéro absent ou d’un autre format est refusé avec un message, sans rien enregistrer. L’identifiant de connexion reste l’adresse e-mail.

#### US-013 · Suspendre un compte en un clic
*Identité et accès* · **Must** · 2 points · cas : UC-65

> En tant que DG, je veux suspendre un compte en un clic, afin de couper immédiatement un accès.

Critères d’acceptation :
- Étant donné un compte connecté, quand la DG le suspend, alors ses sessions sont révoquées dans la minute et toute nouvelle connexion est refusée.
- La suspension est inscrite au journal d’audit.
- Ajout du lot A (6 novembre 2026, sans changement d’estimation) : la réactivation d’un compte suspendu, pendant naturel de la suspension, également inscrite au journal d’audit.

#### US-014 · Créer un compte gratuit avec mon numéro de téléphone
*Identité et accès* · **Must** · 5 points · cas : UC-10

Estimation portée de 3 à 5 points le 6 novembre 2026 (décision du maître d'œuvre, 05 §2.25) : le lot D comprend l'inscription et la connexion du citoyen au site public (UC-10). Reste à placer : le mot de passe oublié par SMS (avec US-031).

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

#### US-022 · Suivre un redécoupage administratif (rattacher, découper, fusionner)
*Référentiels* · **Must** · 8 points · cas : UC-65 · raffiné le 17 novembre 2026 (décision du maître d’œuvre) ; réponses du maître d’œuvre du 17 novembre : comptes préfectoraux d’une préfecture fusionnée suspendus jusqu’à réaffectation, découpage par sous-préfectures, territoire d’origine sur le certificat, pas d’annulation (opération inverse) ; choix techniques §2.59

> En tant que DG, je veux suivre un redécoupage administratif depuis l’écran Référentiels, afin que la plateforme reste à jour sans modification du code ni redéploiement.

Critères d’acceptation :
- Étant donné une préfecture, quand la DG la rattache à une autre région, alors l’administrateur de l’ancienne région ne voit plus ses praticiens et dossiers, celui de la nouvelle les voit, et l’opération est journalisée.
- Étant donné une sous-préfecture, quand la DG la rattache à une autre préfecture (découpage), alors ses praticiens et leurs dossiers suivent, et l’opération est journalisée.
- Étant donné deux préfectures fusionnées, quand on consulte les praticiens de la préfecture conservée, alors ceux de l’ancienne y figurent, l’ancienne reste en base, inactive, et l’opération est journalisée.
- Avant chaque opération, la DG voit ce qui bouge : comptes, praticiens, dossiers, administrateurs qui perdent ou gagnent des territoires ; elle confirme.
- Les certificats déjà émis et les statistiques passées gardent leur territoire d’origine.

#### US-023 · Charger le découpage administratif d’août 2026
*Référentiels* · **Must** · 2 points · cas : — · ajouté le 17 novembre 2026 (décision du maître d’œuvre), à faire en premier à la reprise

> En tant que DG, je veux que la plateforme suive le découpage en vigueur, afin que chaque compte et chaque praticien soit dans la bonne zone.

Source : liste fournie par le maître d’œuvre le 17 novembre 2026 (10 régions administratives, 44 préfectures ; décision du maître d’œuvre de la retenir).

Critères d’acceptation :
- Régions ajoutées : Siguiri (Haute Guinée, malinké par défaut), Beyla (Guinée Forestière, guerzé par défaut).
- Préfectures ajoutées (11) : Kamsar (Boké) ; Timbo (Mamou) ; Tokounou, Djalakoro, Sabadou-Baranama (Kankan) ; Doko, Siguirini, Kintinia (Siguiri) ; Sinko, Kouankan, Karala (Beyla).
- Préfectures rattachées à leur nouvelle région : Siguiri → Siguiri ; Beyla → Beyla.
- Conakry reste une région à une préfecture ; ses 13 communes seront traitées avec US-022 si besoin.
- Migration versionnée ; jeu d’exemple et tests de cloisonnement mis à jour (Siguiri n’est plus dans la région de Kankan) ; suite complète de la base verte.

#### US-030 · Un journal de toutes les décisions et connexions, non modifiable
*Audit et notifications* · **Must** · 3 points · cas : —

> En tant qu’auditeur, je veux un journal de toutes les décisions et connexions, non modifiable, afin d’assurer la traçabilité.

Critères d’acceptation :
- Étant donné une décision de workflow, quand elle est prise, alors une ligne d’audit (qui, quoi, quand, IP) est écrite dans la même transaction.
- Étant donné une tentative de modification ou de suppression du journal, quand elle s’exécute, alors elle est refusée.
- Décisions du maître d’œuvre du 6 novembre 2026 : les connexions sont journalisées par l’API (réussites, refus, déconnexions) et les événements de Keycloak (échecs, blocages, double facteur) relevés par un compte de service en lecture seule ; conservation sans limite en v1 (une purge future passera par une migration, jamais par l’application). **Reporté** : chaînage des empreintes (chaque ligne porte l’empreinte de la précédente), pour rendre visible une modification faite en contournant l’application ; à estimer au raffinement de S17 avec US-162.

#### US-015 · Un environnement de recette déployé automatiquement
*Fondations techniques* · **Must** · 2 points · cas : —

> En tant qu’équipe, je veux un environnement de recette déployé automatiquement, afin de montrer chaque sprint.

Critères d’acceptation :
- Étant donné une fusion sur la branche principale, quand le pipeline se termine, alors l’environnement de recette est mis à jour sans intervention.
- Réalisé en fin de S1, juste avant la revue du sprint (décision du maître d’œuvre du 3 novembre 2026). Questions à trancher avant de coder : hébergeur, adresse, accès, clé de déploiement.

### Sprint 2 — Un praticien soumet son dossier ; il est validé sur le terrain, consolidé et expertisé ; il reçoit un SMS à chaque étape.

#### US-016 · Une base de design commune et un tableau de bord d’accueil
*Socle* · **Must** · 5 points · cas : UC-65 · décision du maître d’œuvre du 8 novembre 2026

> En tant qu’administrateur, je veux une interface sobre et cohérente, avec un tableau de bord d’accueil, afin de m’orienter tout de suite et de retrouver les mêmes repères sur chaque écran.

Critères d’acceptation :
- Les fondations de la charte (CdC §10) sont posées une fois pour toutes : couleurs, typographie, espacements, rayons, ombres, grille ; et des composants réutilisables documentés : boutons, messages, champs de formulaire, tableaux, cartes, bandeau, navigation. Chaque futur écran les reprend sans retouche.
- Aucun emoji, aucun trait décoratif ; les messages sont des encadrés sobres avec une icône dessinée.
- Étant donné un administrateur connecté, quand il arrive dans l’application, alors il voit un tableau de bord : navigation selon son rôle, cartes de chiffres de sa zone (comptes, référentiels, dossiers soumis), activité récente, et les fonctions à venir annoncées.
- Étant donné un administrateur qui vient d’activer son double facteur, quand la configuration se termine, alors il saisit son code sans voir de message d’erreur.
- Les textes anglais ou techniques des pages de connexion (« Warning alert », « code-barres », « Soumettre ») sont remplacés ; le nom de l’utilisateur n’est plus coupé dans le bandeau.
- Chaque page passe axe (WCAG 2.2 AA) et Lighthouse CI (seuils de US-010), sur téléphone et sur ordinateur.

Écart accepté le 8 novembre 2026 : LCP de 4 s et score de 0,80 en 3G pour les pages qui attendent des données (mesuré : 3,2 à 3,9 s), le temps de US-017. Seuils de US-010 tenus partout ailleurs, et sur ordinateur.

#### US-031 · Être notifié par SMS à chaque étape de mon dossier
*Audit et notifications* · **Must** · 5 points · cas : UC-72

> En tant que praticien, je veux être notifié par SMS à chaque étape de mon dossier, afin de suivre ma certification.

Critères d’acceptation :
- Étant donné une transition validée, quand la transaction est confirmée, alors un SMS part dans les 5 minutes.
- Étant donné une transition annulée (erreur), quand la transaction échoue, alors aucun SMS ne part.
- Étant donné un échec d’envoi, quand le service SMS répond en erreur, alors 3 nouvelles tentatives ont lieu puis l’échec est visible.

Décisions du maître d’œuvre (12 novembre 2026) : API SMS d’Orange Guinée, branchée à la mise en service (envoi simulé d’ici là) ; l’échec est visible sur le tableau de bord de la DG ; le SMS de rejet ne contient pas le motif (05 §2.32).

#### US-040a · Soumettre mon dossier de certification (API et base)
*Certification et certificat* · **Must** · 5 points · cas : UC-20

> En tant que praticien, je veux soumettre mon dossier de certification, afin d’entrer dans le workflow.

Critères d’acceptation :
- Étant donné un dossier complet (identité, pièces, photo), quand je le soumets, alors il passe à l’étape 2 et je reçois un accusé de réception.
- Étant donné une pièce obligatoire manquante, quand je soumets, alors la soumission est bloquée avec la liste des pièces manquantes.
- Étant donné un rejet définitif datant de moins de 12 mois, quand j’ouvre un dossier, alors c’est refusé.

Décisions du maître d’œuvre (7 novembre 2026) : le praticien s’inscrit lui-même par son numéro, comme le citoyen ; pièces obligatoires : identité et photo ; recettes vocales ajoutées au dossier en S5 (écart à R-CER-06, voir 05 §2.26).

#### US-040b · Soumettre mon dossier depuis l’application mobile
*Certification et certificat* · **Must** · 5 points · cas : UC-20

> En tant que praticien, je veux remplir et soumettre mon dossier depuis mon téléphone, afin de ne pas dépendre d’un ordinateur.

Critères d’acceptation :
- Étant donné l’application Flutter, quand je me connecte avec mon numéro et mon mot de passe, alors j’accède à mon dossier (domaine `sabou-public`).
- Étant donné une photo prise avec le téléphone, quand je la joins, alors elle est compressée avant l’envoi et passe en 3G.
- Étant donné les critères de US-040a, quand je soumets depuis l’application, alors ils sont tenus de la même façon (pièces manquantes affichées, accusé de réception).
- Hors périmètre : saisie du dossier hors réseau (US-080, US-082).

Décisions du maître d’œuvre (8 novembre 2026) : connexion par la page de Keycloak dans le navigateur du téléphone, session de 30 jours d’inactivité, inscription par le site public (lien depuis l’application) ; estimation gardée à 5 points (voir 05 §2.29).

#### US-042 · Valider ou rejeter un dossier à l’étape 2
*Certification et certificat* · **Must** · 5 points · cas : UC-31

> En tant qu’admin préfectoral, je veux valider ou rejeter un dossier à l’étape 2, afin de faire avancer la certification.

Critères d’acceptation :
- Étant donné une visite réalisée avec compte rendu, quand je valide, alors le dossier passe à l’étape 3.
- Étant donné un dossier initial sans visite réalisée, quand je valide, alors c’est refusé.
- Étant donné un rejet, quand je ne saisis pas de motif, alors c’est refusé ; avec motif, le dossier revient à l’étape 1.
- Étant donné un dossier d’une autre préfecture, quand je tente de décider, alors c’est refusé.

Décision du maître d’œuvre (9 novembre 2026) : sans écran de saisie des visites, qui reste dans US-041 (S3) ; les visites des tests sont créées en base (voir 05 §2.31).

#### US-043 · Consolider un dossier à l’étape 3
*Certification et certificat* · **Must** · 3 points · cas : UC-40

> En tant qu’admin régional, je veux consolider un dossier à l’étape 3, afin de le transmettre au Comité.

Critères d’acceptation :
- Étant donné un dossier de ma région à l’étape 3, quand je valide, alors il passe à l’étape 4 ; quand je rejette avec motif, il revient à l’étape 2.

Décision du maître d’œuvre (12 novembre 2026) : seul l’admin régional décide à l’étape 3, pour les dossiers de sa région ; ni la DG ni un autre profil. Le motif est obligatoire au rejet (voir 05 §2.31).

#### US-044 · Expertiser un dossier à l’étape 4
*Certification et certificat* · **Must** · 3 points · cas : UC-50

> En tant que membre du Comité, je veux expertiser un dossier à l’étape 4, afin de garantir la non-toxicité.

Critères d’acceptation :
- Étant donné un dossier à l’étape 4, quand je valide, alors il passe à l’étape 5 ; quand je rejette avec motif, il revient à l’étape 3.

Décision du maître d’œuvre (12 novembre 2026) : un seul membre du Comité décide, pour les dossiers de toutes les régions (pas de décision collégiale) ; motif obligatoire au rejet (voir 05 §2.31).

### Sprint 3 — La DG approuve, le certificat signé est émis et le praticien apparaît comme certifié.

#### US-019 · Une application de gestion conforme à la maquette v1.3
*Socle* · **Must** · 8 points · ajout du 15 novembre 2026, demandé par le maître d'œuvre, placé avant la reprise de US-017 et la fin de S4

> En tant qu'administrateur, je veux des écrans sobres et bien organisés, conformes à la maquette de l'application de gestion (`Plateforme/docs/maquettes/`), afin de trouver tout de suite ce que j'ai à faire.

Critères d'acceptation :
- Connexion en deux panneaux : vert forêt à gauche (marque, illustration, accès), garanties de sécurité à droite ; empilés sur téléphone.
- Navigation latérale pleine hauteur sur fond « brume », rubriques en petites capitales, élément actif plein vert.
- Titres de page sobres, introduction courte, actions principales à droite du titre ; tableaux à en-tête vert et lignes alternées ; chiffres clés en tuiles.
- Files de dossiers (étapes 2 à 5) : une ligne par dossier (code, praticien, repères, état), ouverte d'un clic pour le détail et la décision.
- Aucun écran ne régresse en accessibilité (WCAG 2.2 AA) ni en poids (illustration de 8 Ko).

#### US-019b · Pagination et gabarit de liste sur tous les écrans de gestion
*Socle* · **Must** · 3 points · ajout du 15 novembre 2026, demandé par le maître d'œuvre (suite de US-019, après les écrans du sprint 4)

> En tant qu'administrateur, je veux que chaque liste se présente et se parcoure de la même façon, afin de m'y retrouver tout de suite, quel que soit l'écran.

Critères d'acceptation :
- Files de dossiers (étapes 2 à 5) : nombre total de dossiers affiché, pages numérotées (10, 25 ou 50 par page, choix mémorisé par file) à la place de « Afficher les dossiers suivants » ; l'API renvoie le total.
- Fiches plantes, fiches maladies, noms locaux, voix des noms, langues et spécialités : pagination commune.
- Gabarit de liste de la page Comptes partout : action principale à droite du titre (formulaire ouvert à la demande), chiffres clés s'il y en a, une seule barre de recherche et de filtres (recherche sans bouton), tableau avec les actions à droite, puis la pagination.
- Aucune régression d'accessibilité (WCAG 2.2 AA) ni de vitesse (première page préchargée, US-017).

#### US-017 · Une application de gestion rapide en 3G sur chaque page
*Socle* · **Should** · 5 points (3 à l’origine, réestimé le 14 novembre 2026) · ajout du 8 novembre 2026, placé en S3 par le maître d’œuvre, hors fusion du sprint 3

> En tant qu’administrateur sur un téléphone d’entrée de gamme en 3G, je veux que chaque page de l’application de gestion s’affiche en moins de 3 s, afin de travailler sans attendre.

Critères d’acceptation :
- Tableau de bord, Comptes, Référentiels, Invitation, Vérification terrain (ajoutée par US-042) Consolidation régionale (ajoutée par US-043) et Expertise des dossiers (ajoutée par US-044) : LCP ≤ 3 s et score de performance ≥ 0,90 en 3G simulée (300 ms, 700 kbit/s, processeur divisé par 4), seuils de US-010 rétablis pour ces pages dans `apps/admin/lighthouserc.cjs`.
- Aucune page déjà dans les seuils ne régresse (accueil sans session : 2,84 s le 8 novembre 2026).

Constat du 8 novembre 2026 (US-016) : la chaîne page → bundle React (60 Ko compressés) → session → morceau de la page → données coûte un aller-retour de 300 ms par étape. Télécharger le morceau de la page en même temps que la session a aggravé la mesure (concurrence pour la bande passante). Pistes : bundle plus léger (Preact, à valider), ossature pré-générée à la compilation, données demandées dès la session connue.

Mesure du 14 novembre 2026 (pipeline complet, 5 mesures, téléphone) : session préchargée et données demandées dès la session connue ne suffisent pas. LCP médian de 3,5 s sur les pages connectées, y compris « Rejet définitif », qui ne charge aucune donnée à l’ouverture : le temps part dans l’enchaînement code principal → morceau de la page avant le premier affichage. Comptes : 4,1 s. Décision du maître d’œuvre (14 novembre 2026) : US-017 est retravaillé (ossature pré-générée à la compilation, code plus léger), estimation portée de 3 à 5 points, et sort de la fusion du sprint 3 ; le reste du sprint fusionne sans lui.

Retravail du 15 novembre 2026 (05 §2.46) : Preact (compatibilité React) au lieu de React, code principal ramené de 73 à 14 Ko compressés ; morceau de la page et données demandés dès le démarrage, d’après l’adresse, en même temps que la session ; réponses JSON compressées (serveur de test aligné sur le frontal). Mesure (3 par page, téléphone) : toutes les pages de gestion entre 2,90 et 3,07 s, Comptes de 4,1 à 2,95 s. Session préchargée dans `index.html` essayée de nouveau : dégrade, écartée. **Décision du maître d’œuvre (15 novembre 2026)** : seuil Lighthouse du LCP porté à 3,1 s sur toutes les pages (écart de 0,1 s au critère), l’ossature pré-générée devient le récit US-017b.

#### US-017b · Une ossature de page pré-générée pour l’application de gestion
*Socle* · **Should** · 3 points (à confirmer) · ajout du 15 novembre 2026 (décision du maître d’œuvre) ; avancé en fin de sprint 4 le 16 novembre 2026, à la demande du maître d’œuvre, car `/referentiels` dépassait le seuil de 3,1 s (05 §2.49)

> En tant qu’administrateur sur un téléphone d’entrée de gamme en 3G, je veux voir le cadre et l’en-tête de la page dès l’arrivée du HTML, afin de savoir tout de suite où je suis.

Critères d’acceptation :
- Chaque page dont l’en-tête ne dépend pas de la personne a son HTML pré-généré à la compilation (cadre et en-tête), servi par le frontal pour son adresse ; aucun décalage visuel au passage à l’application (CLS ≤ 0,1).
- LCP ≤ 3 s en 3G simulée sur toutes les pages ; le seuil de `apps/admin/lighthouserc.cjs` revient à 3 s.

#### US-018 · Un socle commun pour l’application mobile
*Application mobile de terrain* · **Must** · 3 points (environ 1 jour) · ajout du 9 novembre 2026, placé en S3 par le maître d’œuvre

> En tant que praticien ou agent préfectoral de terrain, je veux une application aux repères constants, qui ne me montre que ce qui me concerne, afin de m’y retrouver tout de suite.

Critères d’acceptation :
1. Le thème de la charte (CdC §10) est posé une fois pour toutes dans l’application : couleurs, typographie, espacements, rayons, repris des jetons de `packages/ui/src/tokens.css` (US-016) ; un test échoue si les deux divergent. Composants réutilisables documentés (`apps/mobile/README.md`) : message d’état, chargement, titre de section, écran vide.
2. L’application est réservée au praticien et à l’agent préfectoral : après la connexion, chacun ne voit que les rubriques de son profil (aujourd’hui : « Mon dossier » pour le praticien ; écran d’attente pour un profil sans rubrique).
3. Ajouter une rubrique (Studio en S7, numérisation et agenda en S8) revient à ajouter une entrée au registre des rubriques ; dès deux rubriques, une barre de navigation paraît en bas ; changer d’onglet garde la saisie en cours ; une rubrique n’est construite qu’à sa première ouverture.
4. Un compte citoyen qui se connecte n’accède à aucune rubrique : sa session est révoquée et il est renvoyé vers le site public.
5. Une session gardée s’ouvre sans réseau sur les rubriques du profil (rôles gardés sur le téléphone).
6. Accessibilité (WCAG 2.2 AA) : cibles de 48 px, libellés, contrastes, titres annoncés, vérifiés par les tests sur la barre du haut, la barre du bas et chaque écran du socle.
7. Les prototypes de S0 (US-004, US-005) n’apparaissent pas dans la version publiée, seulement en version de développement.

Décision du maître d’œuvre du 9 novembre 2026 : la navigation des deux profils est construite et testée ; la connexion des agents (client mobile dans le domaine Keycloak interne) attend leur première rubrique (US-082), pour n’ouvrir aucun accès inutile.

#### US-041 · Planifier et réaliser les visites terrain
*Certification et certificat* · **Must** · 5 points · cas : UC-30

> En tant qu’admin préfectoral, je veux planifier et réaliser les visites terrain, afin de vérifier les praticiens.

Critères d’acceptation :
- Étant donné une visite planifiée, quand la veille arrive, alors un rappel part au praticien.
- Étant donné une visite réalisée, quand je l’enregistre, alors un compte rendu signé est obligatoire.

Décision du maître d’œuvre (12 novembre 2026) : compte rendu saisi en ligne par l’admin préfectoral, texte figé avec empreinte SHA3-256, auteur et heure au journal d’audit ; photo de la fiche papier facultative (voir 05 §2.33).

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
*Certification et certificat* · **Must** · 5 points · cas : UC-61

> En tant que DG, je veux prononcer un rejet définitif, afin d’écarter un praticien frauduleux ou dangereux.

Critères d’acceptation :
- Étant donné un autre rôle que la DG, quand il tente un rejet définitif, alors c’est refusé.
- Étant donné un rejet définitif motivé, quand il est prononcé, alors le praticien passe « rejeté », son certificat est révoqué et il est informé de son recours de 30 jours.

*Précisions du maître d’œuvre (12 et 14 novembre 2026)* : le rejet se prononce sur un dossier en cours ou sur un praticien déjà certifié sans dossier en cours (R-QR-06), d’où 5 points au lieu de 3 ; motif « pratique dangereuse » : date et référence de l’avis du Comité obligatoires ; les traitements certifiés passent « suspendus » (réversible si le recours aboutit), ceux en cours d’examen gardent leur statut mais sortent des files ; jusqu’aux litiges (US-101), le SMS donne la date limite du recours (date du rejet + 30 jours) et oriente vers l’administration de la préfecture.

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
*Reporté hors de S3 le 12 novembre 2026 (décision du maître d’œuvre), en attente de l’hébergeur souverain.*

*Fondations techniques* · **Must** · 3 points · cas : —

> En tant qu’équipe, je veux basculer le dépôt et le pipeline de GitHub vers le GitLab auto-hébergé, afin que le code et la chaîne de livraison soient souverains avant toute donnée réelle (E7).

Critères d’acceptation :
- Étant donné le GitLab installé chez l’hébergeur souverain, quand le dépôt y est poussé, alors tout l’historique, les branches et les étiquettes sont présents.
- Étant donné les pipelines de US-001, US-007 et US-015, quand ils sont portés sur GitLab CI, alors le lint, les tests, la compilation et le déploiement en recette passent comme sur GitHub.
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

Réalisation (15 novembre 2026, 05 §2.44) : référent = droit d’enregistrer dans la langue ; écran « Noms locaux » ouvert à tout administrateur (lecture), écriture limitée à ses langues ; voix facultative à la saisie, dépôt traité du même compte, consentement demandé dès qu’une voix est jointe.

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

Réalisation (15 novembre 2026, 05 §2.47) : brouillon = enregistrée par le référent ; traduit = présentée à la validation par celui qui a enregistré (ou un traducteur de la langue) ; validé = un valideur de la langue, jamais celui qui a enregistré, l’a écoutée (renvoi en brouillon avec motif possible) ; publié = la DG. Écran « Voix des noms » avec écoute (Opus, secours AAC).

### Sprint 5 — Un traitement saisi au Studio web suit tout le circuit jusqu’à la certification.

#### US-060 · Créer un traitement depuis le Studio web
*Traitements et circuit* · **Must** · 8 points · cas : UC-21

> En tant que praticien, je veux créer un traitement depuis le Studio web, afin de préparer sa certification.

Critères d’acceptation :
- Maladie, 1 à n plantes ordonnées avec partie utilisée, cycle (durée, prises, pause).
- 4 sections obligatoires + conservation facultative, texte français (et anglais facultatif).
- Consentement et niveau de visibilité obligatoires avant soumission.
- Étant donné un traitement resté « expertisé » à la publication de mon dossier (US-046), quand j’ouvre le Studio, alors je vois la raison : formule gratuite limitée à 3 traitements certifiés, ou plante ou section à compléter. La raison est lue sur le traitement (colonne `recette.attente_raison`, écrite par US-046), pas dans le journal d’audit. *Ajout du 13 novembre 2026, demandé par le maître d’œuvre à la livraison de US-046 ; le SMS est déjà envoyé par US-046. Estimation maintenue à 8 points par le maître d’œuvre (13 novembre 2026), à condition que la raison soit enregistrée sur le traitement.*

Réalisation (16 novembre 2026, 05 §2.50) : Studio dans le site (`/studio`) ; un traitement d’un praticien pas encore certifié est joint à son dossier en cours à la soumission (décision du maître d’œuvre du 16 novembre 2026) ; texte seulement, la voix vient avec le Studio mobile (S7).

#### US-061 · Faire avancer un traitement (soumettre, transmettre, expertiser, certifier, rejeter)
*Traitements et circuit* · **Must** · 5 points · cas : UC-22, UC-42, UC-51, UC-62

> En tant qu’acteur du circuit, je veux faire avancer un traitement (soumettre, transmettre, expertiser, certifier, rejeter), afin qu’il soit publié.

Critères d’acceptation :
- Seul le rôle prévu, dans sa zone, peut faire chaque transition.
- Un rejet exige un motif et renvoie à l’étape précédente.
- Chaque transition est historisée et notifiée.
- Étant donné un praticien rejeté définitivement, quand un régional ou le Comité ouvre sa file, alors les traitements de ce praticien n’y figurent pas (ils ne peuvent déjà plus progresser, US-047). *Ajout du 14 novembre 2026, décision du maître d’œuvre à l’analyse de US-047.*

Réalisation (16 novembre 2026, 05 §2.51) : page de gestion « Traitements à décider » (`/traitements`) commune au régional, au Comité et à la DG ; décision contre le statut vu ; SMS de renvoi sans motif.

#### US-062 · Que la certification d’un traitement soit bloquée s’il est incomplet
*Traitements et circuit* · **Must** · 3 points · cas : UC-62

> En tant que DG, je veux que la certification d’un traitement soit bloquée s’il est incomplet, afin de ne publier que des traitements sûrs.

Critères d’acceptation :
- Refus si une plante n’est pas validée, si une section obligatoire manque ou si le praticien n’a pas de certificat actif.
- Refus au-delà de 3 traitements certifiés en formule gratuite (après les 30 jours de grâce).

Réalisation (16 novembre 2026, 05 §2.52) : motifs de blocage calculés par une seule fonction (`recette_blocages`), lue par le contrôle de certification et affichée à la DG avant sa décision.

#### US-063 · Indiquer les contre-indications structurées
*Traitements et circuit* · **Should** · 3 points · cas : UC-21

> En tant que praticien, je veux indiquer les contre-indications structurées, afin qu’elles s’affichent en alerte.

Critères d’acceptation :
- Liste paramétrable (grossesse, allaitement, enfant de moins de 5 ans…).
- Affichage en alerte sur la page traitement.

Réalisation (16 novembre 2026, 05 §2.53) : liste paramétrable dans l’onglet « Contre-indications » des Référentiels (DG), choisie au Studio, affichée en alerte dans le Studio et la file des administrateurs ; la page publique du traitement la reprendra (sprints du site).

#### US-064 · Annoter un traitement ou une plante
*Traitements et circuit* · **Should** · 3 points · cas : UC-51

> En tant que membre du Comité, je veux annoter un traitement ou une plante, afin de motiver mes avis.

Critères d’acceptation :
- Annotation datée avec avis (favorable, réserve, défavorable).
- Historique consultable par la DG.

Réalisation (16 novembre 2026, 05 §2.54) : annotations repliées dans la file des traitements (Comité sur les traitements transmis, DG en lecture sur les expertisés) et sur la fiche plante ; jamais modifiées ni effacées.

### Sprint 5b — Un praticien s’inscrit et saisit un traitement depuis l’application mobile ; le site ne sert plus que le grand public.

Alignement sur le cahier des charges, étape 1 (décision du maître d’ouvrage du 17 novembre 2026, **écart assumé au §1.3 et au §6.6**) : le site public sert le visiteur et le citoyen ; l’application mobile porte tout le profil Tradipraticien du §6.6 ; l’application de gestion sert la DG, le régional, le préfectoral et le Comité. Justification : le §2.10 et le §8 exigent l’enregistrement depuis le téléphone, y compris hors réseau. Texte seulement dans ce sprint ; la voix et le hors-ligne restent au sprint 7 (US-080, US-081). Ordre : l’inscription et le Studio mobiles d’abord, le retrait du site ensuite, pour que le praticien ne perde jamais l’accès (l’application renvoie aujourd’hui vers l’inscription du site).

#### US-066 · M’inscrire comme praticien depuis l’application mobile
*Application mobile de terrain* · **Must** · 5 points · cas : UC-20 · §6.6

> En tant que praticien, je veux créer mon compte depuis l’application mobile, afin de commencer ma certification sans passer par le site.

Critères d’acceptation :
- Numéro de mobile guinéen, code reçu par SMS, prénom et nom, mot de passe : mêmes règles et même API que l’inscription du site (US-014, US-040a) ; erreurs sous le champ concerné.
- À la fin, le praticien est connecté dans l’application et arrive sur son dossier (US-040b).
- Sans réseau, l’écran le dit et ne perd pas la saisie.
- Textes en français et en anglais ; accessibilité vérifiée par les tests de l’application.

#### US-067 · Saisir un traitement au Studio SABOU mobile (texte)
*Application mobile de terrain* · **Must** · 8 points · cas : UC-21 · §6.6

> En tant que praticien, je veux créer, modifier et soumettre un traitement depuis l’application mobile, afin de ne plus dépendre du site.

Critères d’acceptation :
- Mêmes règles et même API que le Studio web (US-060 à US-064) : maladie, plantes ordonnées avec partie utilisée, cycle, 4 sections obligatoires, conservation facultative, consentement et visibilité avant soumission.
- Liste « Mes traitements » avec l’état de chacun et, pour un traitement en attente, sa raison (US-046).
- Motif du dernier renvoi visible sur le traitement ; les annotations du Comité restent internes (décision du maître d'œuvre du 18 novembre 2026, 05 §2.54 et §2.63).
- Texte seulement ; la voix et le brouillon hors réseau viennent avec US-080 et US-081.

#### US-068 · Retirer le praticien du site public
*Site public* · **Must** · 5 points (2 + 3 : fermeture de l'API au cookie du site, décision du maître d'œuvre du 18 novembre 2026) · §1.3, §6.6

> En tant que maître d’ouvrage, je veux que le site ne serve que le grand public, afin que chaque public ait une seule application.

Critères d’acceptation :
- L’inscription du site ne propose plus le profil « praticien » ; un praticien qui arrive sur le site est invité à installer l’application.
- Le Studio web et son lien sont retirés du site ; l’API et la base, qui servent le Studio mobile, sont conservées.
- Un compte praticien qui se connecte au site n’a accès qu’aux fonctions du citoyen. L’API n’accepte plus, sur les routes du praticien, que le jeton de l’application mobile : le cookie de session du site y est refusé.

Répartition du reste du §6.6 (profil Tradipraticien, désormais dans l’application mobile) : tableau de bord du praticien → US-090 ; profil public (édition par le praticien ; affichage public sur le site, US-114) → US-114 ; mes recettes → US-067, US-081 ; demandes de plantes → US-121 ; certification → US-040b, US-153 ; boutique → US-142 ; abonnement → US-140, US-141 ; formation et forum → US-122 ; témoignages reçus → US-120. Chacun de ces récits livre la partie praticien dans l’application mobile.

### Sprint 5c — Le compte DG est unique et récupérable sous contrôle ; praticien et citoyen retrouvent leur mot de passe par SMS ; plantes, dossiers terrain et langues suivent le cahier des charges.

Alignement, étape 2 (décisions du maître d’ouvrage du 17 novembre 2026). Le point 2.1 (garder une page de connexion intermédiaire) est annulé et remplacé par la décision sur la demande #60 : la page de Keycloak est la page de connexion du §5.2 ; le mot de passe oublié des comptes de gestion passe par e-mail (`05_Choix_Techniques.md` §2.60).

#### US-024 · Un seul compte DG, récupérable par l’administrateur technique
*Identité et accès* · **Must** · 5 points · §3

> En tant que maître d’ouvrage, je veux un seul compte DG et une procédure de récupération contrôlée, afin qu’une perte de téléphone ne bloque pas la plateforme sans ouvrir de porte dérobée.

Critères d’acceptation :
- La DG ne peut plus inviter un compte DG ; la base refuse un second compte DG actif.
- Si la DG perd son téléphone ou son accès, le rôle technique `administrateur` de Keycloak réinitialise son double facteur ou son mot de passe ; il ne peut ni agir à sa place dans SABOU ni créer un second compte DG.
- Chaque réinitialisation est journalisée : qui, quand, pourquoi, motif obligatoire.
- La DG est alertée par e-mail et par SMS (téléphone obligatoire, US-012b).
- La procédure tient en une page dans la documentation d’exploitation.

Décisions du maître d’œuvre du 19 novembre 2026 : sur une base qui porte plusieurs comptes DG actifs, la migration garde le plus récent et suspend les autres (rien n’est supprimé) ; la première exécution réelle de `dg:reinitialiser` se fait avec le maître d’œuvre, sur son poste.

#### US-069 · Mot de passe oublié par SMS (praticien et citoyen)
*Identité et accès* · **Must** · 5 points · §5.2

> En tant que praticien ou citoyen, je veux retrouver l’accès à mon compte par un code reçu par SMS, afin de ne pas dépendre d’un administrateur.

Critères d’acceptation :
- Numéro, code reçu par SMS, nouveau mot de passe (règles de US-014) ; réponse identique que le numéro existe ou non.
- Code à usage unique, durée limitée, tentatives limitées ; chaque réinitialisation est journalisée.
- Un compte qui a activé le double facteur doit toujours le présenter à la connexion suivante.

#### US-054 · Proposer une plante depuis l’application mobile
*Dictionnaire Impérial* · **Must** · 4 points (3 + 1 : nom scientifique facultatif, décision du maître d'œuvre du 18 novembre 2026) · §6.5, §6.6

> En tant que praticien, je veux proposer une plante qui manque au Dictionnaire, afin de pouvoir l’utiliser dans mes traitements.

Critères d’acceptation :
- La plante proposée est créée « en revue », avec le praticien comme auteur.
- Elle ne peut pas entrer dans un traitement certifié tant que le Comité ne l’a pas validée (US-051).
- Le praticien saisit le nom français ; le nom scientifique, la famille et une description sont facultatifs. Le Comité complète le nom scientifique et la famille avant de valider.

#### US-055 · Validation des plantes réservée au Comité
*Dictionnaire Impérial* · **Must** · 2 points · §6.5

> En tant que maître d’ouvrage, je veux que seul le Comité scientifique valide une fiche plante, afin de respecter le cahier des charges.

Critères d’acceptation :
- La validation d’une plante est refusée à tout autre rôle, par l’application, par l’API et par la base.
- Les droits de création et de modification de la DG sur les fiches plantes sont alignés sur la matrice du §6.5.

Réalisation (18 novembre 2026, 05 §2.65) : la validation était déjà réservée au Comité depuis US-051, à chaque niveau (`plante_valider`, écriture directe retirée au rôle de l'API, bouton absent hors Comité) ; ajout de la preuve au niveau de l'application (`App.test.tsx`). Décision du maître d'œuvre du 18 novembre 2026 : la DG garde l'ajout, la modification et l'export des fiches, sans la validation (écart au §6.2).

#### US-040c · Créer un dossier terrain (Admin Préfectoral)
*Certification des praticiens* · **Must** · 5 points · §6.4

> En tant qu’administrateur préfectoral, je veux créer le dossier d’un nouveau praticien rencontré sur le terrain, afin qu’un praticien sans smartphone puisse être certifié.

Critères d’acceptation :
- Identité, téléphone, spécialité, préfecture de l’agent, pièces : le dossier entre dans le circuit habituel (US-042 à US-047).
- Le dossier mentionne qu’il a été créé par l’agent, journalisé ; le praticien reçoit un SMS.
- L’agent qui a créé le dossier ne le vérifie pas lui-même à l’étape 2 : un autre agent de la préfecture le fait (décision du maître d’œuvre du 19 novembre 2026, séparation des tâches).

#### US-040d · Désigner l’agent de vérification d’un dossier terrain (Admin Régional)
*Certification des praticiens* · **Must** · 3 points · §6.4 · *Ajouté le 19 novembre 2026 (décision du maître d’œuvre)*

> En tant qu’administrateur régional, je veux désigner l’agent qui vérifie un dossier terrain quand la préfecture n’a qu’un agent, afin que le dossier ne reste pas bloqué à l’étape 2.

Critères d’acceptation :
- L’administrateur régional désigne, pour un dossier terrain de sa région, un agent préfectoral actif de sa région autre que l’auteur ; la désignation est journalisée.
- L’agent désigné voit ce seul dossier (praticien, pièces, visites, historique) et le vérifie à l’étape 2 comme un agent de la préfecture ; il ne voit rien d’autre de cette préfecture.
- Une fois un agent désigné, lui seul vérifie le dossier ; l’auteur reste refusé.

#### US-012c · Droits de langue par défaut selon le rôle
*Identité et accès* · **Should** · 2 points · §2.8, §3.2

> En tant que DG, je veux que les droits sur les langues soient préremplis selon le rôle, afin d’éviter les oublis à l’invitation.

Critères d’acceptation :
- Par défaut : le praticien et le préfectoral enregistrent ; le préfectoral résume et traduit ; le régional valide la langue de sa région ; la DG publie.
- Le réglage langue par langue reste possible.

Réalisation (18 novembre 2026, 05 §2.67) : à l'invitation, le choix du rôle et de la zone préremplit les droits dans la langue vocale de la région (sa région naturelle) : préfectoral = enregistrer et traduire, régional = valider. La DG publie par son rôle et le Comité n'a pas de droit de langue : rien n'est coché pour eux. « Résumer » arrivera avec US-072 (S6). Le praticien ne passe pas par l'invitation : ses droits d'enregistrement suivront avec US-080.

### Écarts au cahier des charges et décisions de l’alignement (17 novembre 2026)

| Sujet | Décision | CdC |
|---|---|---|
| Séparation des applications | Site = visiteur et citoyen ; mobile = tout le profil Tradipraticien ; gestion = DG, régional, préfectoral, Comité (écart assumé) | §1.3, §6.6 ; justifié par §2.10, §8 |
| Page de connexion | La page de Keycloak est la page de connexion, sans page intermédiaire (point 2.1 annulé) | §5.2 |
| Démo sans compte | Reportée, récit à planifier | §5.2 |
| Mot de passe oublié | Gestion : par e-mail, double facteur exigé ; praticien et citoyen : par SMS (US-069) | §5.2 |
| Alertes de sécurité | E-mail à chaque changement de mot de passe ou de double facteur des comptes de gestion | §5.2 |
| Téléphone des comptes de gestion | Obligatoire (alertes et notifications par SMS) | Fiche U-001, §9 |
| Compte DG | Un seul ; récupération par l’administrateur technique, journalisée, alerte par e-mail et par SMS (US-024) | §3 |
| Fiches plantes | Le praticien propose (en revue), seul le Comité valide (US-054, US-055) | §6.5, §6.6 |
| Nouveau praticien | Dossier terrain créé par l’Admin Préfectoral (US-040c) | §6.4 |
| Langues | Droits par défaut selon le rôle, réglage par langue conservé (US-012c) | §2.8, §3.2 |
| Rejet définitif par la DG | Absent du §4 ; conservé, noté comme écart | §4 |
| Découpage administratif | Découpage d’août 2026 retenu (US-023) ; le §1.2 (8 régions, 33 préfectures) est dépassé | §1.2 |

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

Réalisation (19 novembre 2026, 05 §2.83) : page publique `/signaler` (sans compte, code prérempli par lien, contact facultatif visible du seul Comité et effacé 12 mois après la clôture, limite par adresse IP et leurre) ; écrans « Signalements » (graves en tête, échéance de 24 h) et « Traitements suspendus » (levée avec motif) du Comité ; une plante signalée peut revenir à la revue du Comité.

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

Constat du 6 novembre 2026 (lot D, 05 §2.25) : en 3G simulée, le socle de Next.js et React donne un LCP d'environ 4,5 s sur les pages du compte citoyen. Lighthouse le signale sans bloquer (`apps/site/lighthouserc.cjs`) ; ce récit rend les seuils de vitesse bloquants.

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
- Étant donné des traitements restés « expertisés » à cause du quota de la formule gratuite (`attente_raison` = `quota`, US-046), quand le praticien passe en GOLD, alors ils sont certifiés, comme l’annonce le SMS « certifiés au passage à GOLD ». *Ajout du 13 novembre 2026, demandé par le maître d’œuvre.*

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
| Sécurité | Contrôle d’accès par rôle et par zone vérifié ; aucune donnée nominative exposée. Analyse des dépendances, du code et des images sans faille critique : en fin de sprint et avant toute mise en production, pas à chaque fusion (décision du maître d’œuvre du 19 novembre 2026) |
| Langues | Textes en français (et anglais si prévu), aucun texte en langue nationale ; repli sur la voix française vérifié |
| Accessibilité | Contraste AA, focus visible, cibles de 40 px, textes alternatifs (écrans concernés) |
| Performance | Écrans publics concernés affichés en moins de 3 s en 3G simulée ; mesuré par Lighthouse en fin de sprint et avant toute mise en production, pas à chaque fusion (décision du maître d’œuvre du 19 novembre 2026) |
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
