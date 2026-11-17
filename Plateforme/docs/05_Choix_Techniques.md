# SABOU — Choix techniques (version 2, analyse)

Statut : **validé par le maître d'œuvre (novembre 2026)**. Rien n'est installé ni développé ; la mise en œuvre commence en phase de développement.

Principe : chaque technologie est choisie **uniquement pour son adéquation aux exigences de SABOU** (cahier des charges v1.3 et `04_Regles_Metier.md`), pas selon les habitudes d'une équipe. Pour chaque couche : le choix, pourquoi il est le meilleur ici, et les alternatives écartées.

---

## 1. Exigences qui décident

| # | Exigence | Source | Ce qu'elle impose |
|---|---|---|---|
| E1 | Pages < 3 s sur réseau mobile faible | CdC §8 | Pages rendues côté serveur, très peu de JavaScript, cache agressif, audio très compressé |
| E2 | Audio d'abord : 5 voix par section, écoute hors réseau | CdC §2, §8 | Chaîne audio optimisée pour la parole ; mise en cache sur le téléphone |
| E3 | Enregistrement vocal sur téléphone, réduction du bruit, saisie **hors réseau** des agents | CdC §2.10, §8 | Application mobile native, base locale, synchronisation fiable avec PostgreSQL |
| E4 | 6 rôles, zones (préfecture, région), MFA, moindre privilège | CdC §3 | Fournisseur d'identité robuste + cloisonnement des données au niveau de la base |
| E5 | Workflows tracés, notifications à chaque transition | CdC §4, §9 | Transactions fortes ; notifications envoyées de façon fiable même si un service tombe |
| E6 | QR signé, vérifiable **hors ligne** | CdC §9 | Format de preuve signé, compact, standard |
| E7 | Hébergement **souverain** en Afrique de l'Ouest, 99,9 % | CdC §8 | Logiciels libres auto-hébergeables, redondance, aucune dépendance à un cloud étranger |
| E8 | API partenaires (JWT RS256, quotas), données anonymisées | CdC §9 | OAuth2 « client credentials », limitation de débit, API documentée |
| E9 | « Praticien le plus proche », déserts thérapeutiques | CdC §2.7, §6.3 | Calculs géographiques |
| E10 | Indicateurs pour les autorités sanitaires | CdC §1.2 | Interopérabilité avec le système d'information sanitaire national |
| E11 | Maintenance sur 10 ans par une institution publique | Contexte | Technologies matures, très répandues, documentées, sans licence coûteuse |

---

## 2. Pile retenue

### 2.1 Données

| Choix | Pourquoi c'est le meilleur pour SABOU | Écarté |
|---|---|---|
| **PostgreSQL 17** | Row-Level Security pour cloisonner par zone (E4) ; recherche floue multilingue sans accents (pg_trgm, unaccent) ; transactions et contraintes qui portent déjà les règles métier (scripts v2) | MySQL : pas de RLS ; MongoDB : pas de contraintes relationnelles, alors que le modèle est fortement relationnel |
| **PostGIS** | Praticien certifié le plus proche, déserts thérapeutiques par préfecture, cartes (E9) | Calcul de distance dans l'application : imprécis et lent |
| **PostgreSQL « nu »**, exploité par CloudNativePG (ou PostgreSQL managé d'un hébergeur souverain, s'il offre PostGIS, pg_trgm, unaccent, RLS et restauration à un instant donné) | Le schéma v2 est du PostgreSQL standard : il reste portable chez n'importe quel hébergeur | **Supabase** : son offre en ligne n'a pas de région en Afrique de l'Ouest (E7) ; la version auto-hébergée regroupe une dizaine de services sans haute disponibilité fournie (E7) ; son API générée expose directement le schéma, alors que l'API partenaires doit être versionnée et que les workflows doivent rester côté serveur ; son module d'authentification ne gère pas l'accès OAuth2 des partenaires (E8) |
| **Recherche dans PostgreSQL** (pas de moteur séparé) | Le volume (quelques milliers de plantes et maladies, des dizaines de milliers de traitements) est largement à la portée de pg_trgm ; un composant de moins à opérer | Elasticsearch / Meilisearch : utiles à des millions de documents, ici surdimensionnés |
| **Kysely** (SQL typé) + migrations SQL versionnées (**Atlas**, voir §2.15) | Le schéma est « SQL d'abord » (triggers, fonctions, RLS) : on écrit le SQL, on garde le typage | ORM (Prisma, TypeORM) : masque le SQL, gère mal triggers, RLS et fonctions |

### 2.2 Back-end (API)

| Choix | Pourquoi | Écarté |
|---|---|---|
| **TypeScript + NestJS** | Un seul langage du serveur aux interfaces web : les schémas de validation (Zod), les types et les messages d'erreur sont **partagés** entre l'API, le site public et l'application de gestion, ce qui réduit les incohérences sur un projet à ~60 tables. NestJS impose une architecture modulaire (un module par domaine : certification, dictionnaire, traitements…), gère les gardes d'accès et génère la documentation OpenAPI (E8) | **Django** : excellent pour un back-office, mais son ORM et ses migrations vont contre un schéma SQL d'abord, et on perd le partage de types avec le front. **Spring Boot / .NET** : très solides mais plus lourds pour une équipe produit, sans gain ici. **Go** : performant mais beaucoup de code à écrire pour un domaine riche en formulaires et en règles ; la performance brute n'est pas le facteur limitant |
| **Architecture : monolithe modulaire** | Un seul déployable, des modules isolés par domaine ; le bon niveau pour 15 000 praticiens et un trafic national. Découpage en services plus tard seulement si un module l'exige | Microservices : complexité d'exploitation injustifiée, surtout en hébergement souverain |

### 2.3 Identité et accès

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Keycloak** (auto-hébergé) | Couvre d'emblée le CdC : MFA TOTP obligatoire pour les administrateurs, jetons JWT RS256 avec rotation des clés, OAuth2 « client credentials » pour les partenaires API, protection contre la force brute, suspension en un clic, journal des connexions (E4, E8). Logiciel libre, souverain, standard OIDC | Authentification maison : risque de sécurité et beaucoup de travail pour un résultat inférieur. Auth0, Firebase Auth : cloud étranger (E7) |
| **Autorisation par zone dans PostgreSQL (RLS)** + gardes NestJS | Le cloisonnement préfecture / région est garanti par la base même en cas d'erreur dans le code | Filtrage uniquement dans l'application : une requête oubliée suffit à fuiter des données |

### 2.4 Site public

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Next.js** (rendu serveur, pages statiques régénérées) en **PWA** | Les pages traitement, plante et maladie sont générées à l'avance et servies depuis le cache : affichage immédiat sur 3G (E1). Les composants serveur limitent le JavaScript envoyé au téléphone. Service worker pour l'écoute hors réseau (E2). Partage des types avec l'API | **Astro** : encore plus léger pour du contenu pur, mais le site public est aussi interactif (forum, témoignages, demandes, compte citoyen, vérification de certificat) : Next.js couvre les deux sans changer d'outil. SPA React classique : lente au premier affichage, mauvaise sur réseau faible |
| **Serwist** (service worker) | Mise en cache des audios et des pages consultées, file d'attente des formulaires envoyés hors ligne | — |
| **Tailwind CSS** + composants accessibles (Radix) | Charte verte du CdC appliquée par des variables ; contraste AA, focus visible, cibles 40 px (CdC §8) | Bibliothèques lourdes (MUI) : trop de CSS et de JS pour E1 |

### 2.5 Application de gestion

| Choix | Pourquoi | Écarté |
|---|---|---|
| **React + Vite** (application à page unique) avec **TanStack Router, Query et Table**, **shadcn/ui** | Derrière la connexion, pas besoin de référencement ni de rendu serveur : une application à page unique est plus simple à déployer (fichiers statiques) et plus fluide pour les listes, filtres, tableaux et formulaires des 5 profils (CdC §6). Mêmes types partagés que l'API | Next.js aussi pour l'administration : possible, mais le rendu serveur n'apporte rien ici et complique le déploiement |
| **Graphiques : Apache ECharts** | Tableaux de bord DG, régionaux et préfectoraux (histogrammes, anneaux, évolutions) | — |

### 2.6 Application mobile (praticiens et agents de terrain)

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Flutter** (Android en priorité) | Les téléphones visés sont surtout des Android d'entrée de gamme : Flutter compile en natif et reste fluide sur ces appareils. Enregistrement audio natif (suppression de bruit du téléphone), lecteur à vitesse réglable, une seule base de code Android et iOS (E3) | **PWA seule** : enregistrement et stockage hors ligne moins fiables (le navigateur peut effacer les données), pas de synchronisation en arrière-plan solide. **React Native** : bon choix aussi, mais moins régulier sur les appareils d'entrée de gamme ; le partage de types avec TypeScript est compensé par un client Dart généré depuis OpenAPI. **Natif Kotlin** : deux bases de code si iOS est demandé |
| **PowerSync** (édition auto-hébergée) | Synchronisation PostgreSQL ↔ SQLite sur le téléphone, conçue pour le hors réseau : l'agent saisit dossiers, recettes et voix sans réseau ; tout remonte à la reconnexion avec la règle de conflit R-DON-04 | Synchronisation maison : c'est la partie la plus difficile et la plus risquée d'une application hors ligne. **À valider par un prototype** en phase 1 |

### 2.7 Audio (cœur du produit)

| Choix | Pourquoi |
|---|---|
| **Opus mono 24 kbit/s, en WebM** (trames de 60 ms, index en tête de fichier ; prototype US-005, §2.17) | Format conçu pour la parole : une section de 90 s pèse environ 270 Ko, contre plus d'1 Mo en MP3 de qualité équivalente (E1, E2). Le conteneur WebM permet de commencer la lecture dès les premiers octets |
| **FFmpeg** côté serveur : réduction de bruit (filtre RNNoise `arnndn`, à mi-force), normalisation du volume (`loudnorm`), conversion Opus | Qualité homogène quel que soit le téléphone ; durée et empreinte calculées automatiquement |
| **Fichier de secours AAC** | Pour les rares navigateurs (anciens iPhone) qui lisent mal Opus |
| **Stockage objet compatible S3, auto-hébergé** : **SeaweedFS** (ou Garage) | Audio et images hors base, réplication, souverain (E7). MinIO est écarté à cause des restrictions récentes de son édition libre (à revérifier au moment du choix) |

### 2.8 Tâches de fond, cache, notifications

| Choix | Pourquoi | Écarté |
|---|---|---|
| **pg-boss** (file de tâches dans PostgreSQL) | Les workflows écrivent déjà la notification **dans la même transaction** que la décision (tables `notification`, `journal_audit`) : la file dans PostgreSQL garantit qu'aucune notification n'est perdue ni envoyée pour une décision annulée (E5). Sert aussi pour le transcodage audio, les rapports PDF/XLSX, l'expiration des certificats | Redis + BullMQ : la file vit hors de la transaction, risque d'incohérence ; un composant critique de plus |
| **Valkey** (cache, limitation de débit API) | Cache des pages et des résultats de recherche, limite de 100 requêtes/min/IP (CdC §9). Valkey est le successeur libre de Redis | Redis : licence devenue restrictive |
| **SMS** : agrégateur local (API Orange / MTN) ; **e-mail** : serveur SMTP souverain | Notifications à chaque transition (CdC §9) | — |

### 2.9 Certificats et QR Code

| Choix | Pourquoi |
|---|---|
| **Ed25519 + SHA3-256** (bibliothèque crypto native de Node.js) | Signature courte, rapide, très sûre ; SHA-3 comme demandé par le CdC |
| **Format du QR : CBOR signé (COSE) encodé en Base45** | Modèle éprouvé par le certificat sanitaire numérique européen : QR compact, lisible par un téléphone d'entrée de gamme, vérifiable **hors ligne** avec la clé publique (E6) |
| **Clé privée dans un coffre** (HashiCorp Vault ou OpenBao, libre) | La clé de la DG ne quitte jamais le coffre ; rotation et révocation (R-QR-04) |

### 2.10 Documents, statistiques, interopérabilité

| Choix | Pourquoi |
|---|---|
| **Gotenberg** (PDF), **ExcelJS** (XLSX) | Rapports, certificats imprimables, exports (CdC §9) |
| **Matomo** auto-hébergé | Visites et écoutes pour les statistiques de la DG, sans envoyer de données à un tiers (CdC §6.2, §8) |
| **Intégration DHIS2** (à confirmer avec le ministère) | DHIS2 est le système d'information sanitaire national le plus répandu en Afrique de l'Ouest : envoyer les indicateurs anonymisés de SABOU vers DHIS2 est plus utile aux autorités qu'une API isolée (E10) |
| **MapLibre** + tuiles OpenStreetMap auto-hébergées | Cartes de l'annuaire et des déserts thérapeutiques, sans service cartographique étranger |

### 2.11 Exploitation

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Kubernetes léger (k3s)** sur au moins 3 serveurs chez un hébergeur souverain | Redondance pour 99,9 % (E7), redémarrage automatique, déploiements sans coupure | Un seul serveur avec Docker Compose : suffisant en développement, pas pour 99,9 % |
| **CloudNativePG** | PostgreSQL en haute disponibilité (primaire + réplica), bascule automatique, sauvegarde continue et restauration à un instant donné (CdC §8) | Gestion manuelle de la réplication : fragile |
| **Traefik** + cache HTTP | TLS 1.3 automatique, micro-cache des pages publiques | — |
| **Prometheus, Grafana, Loki, GlitchTip, Uptime Kuma** | Supervision, journaux, erreurs, disponibilité publiée pour les partenaires (SLA) | Services de supervision en cloud : données hors du pays |
| **GitLab auto-hébergé** (dépôt, intégration et déploiement continus) + **Trivy** (analyse des images) + **Renovate** (mises à jour) | Code et chaîne de livraison souverains ; failles détectées avant production | GitHub et GitHub Actions comme référence en production : cloud étranger (E7) |

**Décision (novembre 2026) : dépôt en deux temps.**

1. **Conception et développement sans données réelles : GitHub** (dépôt privé `sansysparta-alt/sabou-plateforme`). Gratuit, sans serveur à exploiter ; aucune donnée de praticien, de patient ni de voix n'y transite, donc E7 n'est pas encore en jeu. Les pipelines des récits US-001, US-007 et US-015 tournent sur GitHub Actions et ne déploient que la recette avec des données fictives.
2. **Dès que l'hébergeur souverain est disponible (avant S3) et avant toute donnée réelle : GitLab auto-hébergé**, installé sur cette infrastructure. Le dépôt y est poussé avec tout son historique, le pipeline est porté sur GitLab CI et le backlog importé (récit US-008). GitLab devient la seule référence ; GitHub passe en miroir en lecture seule ou est archivé.

Pour faciliter la bascule, la logique du pipeline (lint, tests, compilation, déploiement) vit dans des scripts du dépôt ; les fichiers propres à GitHub Actions se contentent de les appeler. Aucun secret de production n'est jamais stocké sur GitHub.

**Décision (novembre 2026) : pas de GitHub Pro, fusion bloquée par convention jusqu'à US-008.** Le dépôt reste privé sur un compte gratuit, qui n'autorise ni protection de branche ni règles de fusion. Jusqu'à US-008, toute modification passe par une branche de récit et une demande de fusion, et le maître d'œuvre ne fusionne que si le pipeline est vert. Le blocage automatique sera configuré sur GitLab, où il est disponible sans frais (critère reporté de US-001 à US-008).

**Décision du maître d'œuvre (12 novembre 2026) : pipeline en local jusqu'au 1er décembre 2026.** Le quota gratuit de GitHub Actions (2 000 minutes par mois pour un dépôt privé) est épuisé : GitHub ne lance plus les tâches. Plutôt qu'une dépense, un runner sur le poste de développement ou une bascule anticipée vers GitLab, le pipeline complet (`pnpm ci:local`, y compris le bout en bout, axe et Lighthouse) tourne en local, et sa preuve est jointe à chaque demande de fusion. La règle « vert sur GitHub » reprend dès le renouvellement du quota.

**Décision du maître d'œuvre (12 novembre 2026) : pipeline rapide pendant le récit, complet avant la fusion.** `pnpm ci:recit` (`infra/ci/recit.sh`) ne vérifie que ce que le récit touche depuis `origin/main` : lint, typage, tests et compilation des paquets modifiés et de leurs dépendants (filtre `...[base]` de Turbo), tests de la base au complet, format des fichiers touchés, seuls les specs de bout en bout modifiés (ou `RECIT_SPECS`), Lighthouse à **une** mesure sur téléphone pour les pages de `RECIT_PAGES`, Semgrep sur les fichiers touchés, application mobile si elle a changé, audit des dépendances et des images si le verrou, un Dockerfile ou Compose a changé. **Il ne vaut jamais preuve** : `pnpm ci:local` (pipeline complet, Lighthouse à 5 mesures par page, refus de passer à 3) est lancé avant chaque demande de fusion et sa preuve y est jointe. `all.sh` efface les réglages de `ci:recit` avant de commencer, pour qu'aucun n'allège la preuve. Chaque étape est horodatée (début, fin, durée) ; les contrôles qui n'ont pas besoin de l'environnement local (application mobile, audit, Semgrep, variables d'environnement) tournent en parallèle. Semgrep reçoit ses règles et le code par des flux `tar` (`docker cp`) au lieu d'un dossier partagé : sous Windows, la lecture à travers le partage prenait environ 10 minutes.

### 2.12 Qualité

| Choix | Usage |
|---|---|
| **Vitest** | Tests unitaires des règles métier |
| **Testcontainers** | Tests sur un vrai PostgreSQL (triggers, RLS, workflows) |
| **Playwright** | Critères de recette du CdC §11.3 automatisés de bout en bout |
| **k6** | Tests de charge (pic de trafic national, 3G simulée) |
| **OWASP ZAP** + audit externe | « Aucune vulnérabilité critique » (CdC §11.3) |

### 2.13 Outillage du dépôt et intégration continue (décision de novembre 2026, récit US-001)

| Choix | Pourquoi | Écarté |
|---|---|---|
| **pnpm workspaces + Turborepo** | Un seul dépôt pour l'API, l'administration, le site et le code partagé ; Turborepo ne relance le lint, les tests et la compilation que sur ce qui a changé, et les met en cache | Nx : plus complet mais plus lourd à apprendre et à maintenir (E11). npm workspaces : pas de cache ni d'exécution ciblée |
| **ESLint + Prettier** | Les outils les plus répandus et documentés de l'écosystème TypeScript (E11) | Biome : plus rapide, mais moins répandu et moins de règles disponibles |
| **Trivy en mode fichiers** | Analyse des dépendances dès US-001 ; le même outil analysera les images Docker (US-002) | `pnpm audit` : dépendances JavaScript seulement |
| **Scripts Bash dans `infra/ci/`** | Exécutés tels quels par GitHub Actions, GitLab CI (US-008) et, en local, par Git Bash | Scripts Node : possibles, mais plus longs pour enchaîner des commandes |
| **Semgrep, édition communautaire** (analyse du code, avant S2, récit US-007) | Outil libre, lancé par un script et une image épinglée : il tourne tel quel sur GitLab CI | CodeQL : payant sur un dépôt privé (GitHub Advanced Security) |
| **axe (Playwright) + Lighthouse CI** (à partir de US-010) | Vérifient dans le pipeline WCAG 2.2 AA et les performances en 3G bridée, avec des seuils bloquants | Contrôles manuels : non reproductibles |
| **Flutter hors de Turborepo** | Pas d'application mobile avant US-005 (squelette Flutter, réestimation du 2 novembre 2026) ; ensuite un job séparé, déclenché seulement par les changements dans `apps/mobile/`, pour économiser les minutes d'intégration continue | — |

**Version de Node : Node 26 LTS.**

| Critère | Node 24 | Node 26 |
|---|---|---|
| Statut (2 novembre 2026) | Maintenance depuis le 20 octobre 2026 : correctifs de sécurité seulement | LTS active depuis le 28 octobre 2026 (v26.13.0) |
| Fin de support | 30 avril 2028 | 30 avril 2029 |
| Compatibilité de la pile (versions annoncées par chaque outil, novembre 2026) | Complète | NestJS 12.3 et sa CLI, Next.js 16.4, Vite 8.3, Vitest 5.0, ESLint 10, Testcontainers 12.2, pnpm 12, Prettier 3, TypeScript : tous acceptent Node 26 ; aucun blocage relevé |

Justification : avec environ 39 semaines de développement, le pilote et la généralisation tombent fin 2027 et début 2028. Sur Node 24, il faudrait changer de version de Node juste après la mise en production, au moment où l'exploitation doit être la plus stable. Node 26 couvre une année de plus (E11).

Risque : la LTS a quelques jours ; les versions de Node acceptées par un outil ne prouvent pas qu'il a été testé sur Node 26 (Next.js ne publie pas de matrice de tests). Parade : le pipeline de US-001 sert de vérification ; si un outil casse, on revient à Node 24 en changeant `.nvmrc` et le champ `engines`, le temps que l'outil soit corrigé. Les modules natifs ajoutés plus tard sont vérifiés à leur arrivée. Depuis Node 25, Corepack n'est plus livré avec Node : pnpm est installé explicitement et sa version est fixée dans le champ `packageManager`.

**Épinglage par SHA.** Chaque action GitHub est référencée par le SHA complet de son commit (avec la version en commentaire), et l'image Trivy par son empreinte `sha256`, et non par une étiquette qu'un tiers pourrait déplacer vers un code malveillant. Trivy est lancé depuis un script de `infra/ci/` : le même script et la même empreinte serviront sur GitLab CI. Sur un poste sans Docker, la variable `TRIVY_BIN` permet d'utiliser un binaire Trivy local de la même version, à vérifier par sa somme de contrôle ; l'intégration continue utilise toujours l'image épinglée. Renovate tiendra ces empreintes à jour quand il sera mis en place.

**TypeScript 6.0, pas 7.** TypeScript 7 (le compilateur réécrit en Go) est sorti, mais typescript-eslint n'accepte pas encore de version au-delà de 6.0 (novembre 2026). On reste en 6.0, épinglé en `~6.0.3`, jusqu'à ce que l'outillage suive.

### 2.14 Environnement local (décision de novembre 2026, récit US-002)

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Docker Compose** (`infra/local/compose.yaml`), lancé par `pnpm env:up` (script Node `infra/local/up.mjs`) | Une commande, identique sous PowerShell, Git Bash et dans l'intégration continue ; attend que chaque contrôle de santé soit vert (`--wait`) | k3s en local : trop lourd pour un poste de développement ; la production reste sur k3s (§2.11). Script Bash : ne tourne pas depuis PowerShell |
| **Mêmes logiciels qu'en production** : PostgreSQL 17 + PostGIS 3.6, Keycloak 26 (sur sa propre base PostgreSQL), Valkey 9, SeaweedFS 4 (passerelle S3), et l'API dans son image Docker | On développe dans les conditions de production ; l'image de l'API est celle qui sera déployée et analysée | Base embarquée de Keycloak (H2) : différente de la production |
| **Images épinglées par empreinte `sha256`**, contrôlées par `infra/ci/check-pins.sh` (fichiers Compose et Dockerfile) | Même règle que les actions GitHub et Trivy (§2.13) | Étiquettes (`17-3.6`, `latest`) : déplaçables par un tiers |
| **Mots de passe locaux tirés au hasard** au premier lancement, dans `.env` (non versionné) ; ports ouverts sur `127.0.0.1` seulement ; aucun accès anonyme (S3, Valkey) | Aucun mot de passe utilisable dans le dépôt, aucun service exposé au réseau du poste (ASVS V14) | Mots de passe par défaut dans `.env.example` : réutilisés partout, et un jour en recette |
| **Rôles PostgreSQL séparés dès le poste local** : `sabou_migrator` (propriétaire, migrations), `sabou_app` (API, sans droit de structure), `keycloak` (sa base seulement) | Le moindre privilège de `00_Conception_BDD_SABOU.md` est vérifié dès le développement | Super-utilisateur pour l'API : masque les erreurs de droits jusqu'à la production |
| **PostGIS installé à l'initialisation du serveur**, pas par les migrations | PostGIS n'est pas une extension « de confiance » : il faut le super-utilisateur, que les migrations n'ont pas ; en production, l'hébergeur ou CloudNativePG l'installe de la même façon | — |
| **Contrôles de santé de l'API** : `GET /health` (l'API répond) et `GET /health/ready` (l'API lit la base, PostGIS compris), réponses sans version ni message d'erreur | Utilisables tels quels par Kubernetes (sondes) ; aucune information utile à un attaquant (ASVS 14.3.3) | — |

**Analyse des images Docker par Trivy** (`infra/ci/audit-images.sh`) : l'image de l'API et chaque image tierce de l'environnement local. Décision du maître d'œuvre (novembre 2026) : le pipeline échoue sur toute faille **critique qui a un correctif disponible** ; les failles critiques sans correctif sont listées sans bloquer, car on ne peut pas corriger soi-même une image tierce.

**Exceptions** (`infra/ci/trivyignore.yaml`) : chacune vise une faille précise dans un fichier précis, porte sa justification, expire, et est validée par le maître d'œuvre. Passé la date, le pipeline rebloque.

| Faille | Image et fichier | Justification | Expire le |
|---|---|---|---|
| CVE-2025-68121 (Go, `crypto/tls`) | `postgis/postgis` 17-3.6, `usr/local/bin/gosu` | `gosu` ne fait que changer d'utilisateur au démarrage et n'ouvre aucune connexion TLS : faille non atteignable. Aucune image PostGIS corrigée en novembre 2026 | 1er février 2027 |

### 2.15 Migrations de la base (décision de novembre 2026, récit US-003)

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Atlas, édition communautaire** (Apache 2), image épinglée par empreinte | Migrations en SQL pur (le schéma est « SQL d'abord ») ; chaque migration dans sa transaction, arrêt à la première erreur ; empreintes des fichiers (`atlas.sum`) | **dbmate** : ne garde que le nom des migrations appliquées, sans empreinte, donc ne voit pas une migration modifiée (critère de US-003) |
| **Contrôle des empreintes appliquées** (`packages/db/src/verify.ts`), avant chaque application | L'édition communautaire refuse une migration modifiée tant que `atlas.sum` n'est pas recalculé, mais l'accepte après `atlas migrate hash`. La base garde l'empreinte d'origine de chaque migration appliquée : on la compare au fichier, ce qui protège aussi la recette et la production | Contrôle seulement dans le pipeline (comparaison Git avec `main`) : ne protège pas une base déjà migrée |
| **Paquet `packages/db`** : migrations, jeu d'exemple, requêtes d'exemple, tests | La base a son propre cycle (lint, tests, compilation) dans Turborepo ; l'API en dépendra pour ses types Kysely | Migrations dans `apps/api` : mêleraient le schéma et le code d'une seule application |
| **Tests sur un vrai PostgreSQL avec Testcontainers** (même image et même script d'initialisation que l'environnement local) | Contraintes, déclencheurs et workflows ne se testent que sur la vraie base (§2.12) ; aucun serveur partagé | Base de test partagée : états qui se mélangent entre tests |
| **Scripts en TypeScript exécutés directement par Node 26** (suppression des types) | Pas d'étape de compilation pour les commandes `db:*` | `tsx` ou `ts-node` : une dépendance de plus |
| **Rôles** : migrations par `sabou_migrator` ; droits de `sabou_app` donnés par une migration (lecture, écriture, exécution ; journal d'audit en ajout seul) ; PostGIS et rôles créés par l'infrastructure | Moindre privilège dès le premier jour (00_Conception §6) | — |

Les scripts v2 de `Plateforme/database/` passaient tels quels sur PostgreSQL 17. Ils ont été remplacés par ce paquet (décision du maître d'œuvre), avec deux corrections : un motif obligatoire ne peut plus être vide ou fait d'espaces, et l'exemple « rejet sans motif » visait un traitement déjà en brouillon, refusé pour une autre raison. Les scripts de l'intégration continue n'appellent pas Atlas directement : `pnpm test` lance les tests de la base.

### 2.16 Prototype du QR signé (récit US-006, novembre 2026)

**Décision du maître d'œuvre (2 novembre 2026) : validé.** Le format retenu au §2.9 (CBOR signé COSE, Base45, Ed25519, empreinte SHA3-256) est confirmé, sur la foi des tests automatiques et de l'essai sur téléphone, hors ligne. Les choix ci-dessous ont été tranchés en cours de récit.

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Texte du QR : `SB1:` + Base45 (RFC 9285) d'un COSE_Sign1 (RFC 9052)**, algorithme EdDSA (Ed25519), identifiant de la clé dans l'en-tête protégé, en-tête non protégé vide | Le préfixe porte la version du format : un format futur changera de préfixe sans casser les anciens certificats. La signature couvre l'en-tête protégé et toute la charge utile, donc les données, l'empreinte et l'identifiant de la clé (R-QR-03, R-QR-04) | Compression zlib, comme le certificat sanitaire européen : la signature et l'empreinte (96 octets aléatoires) ne se compressent pas, le gain serait faible pour un décompresseur de plus dans le navigateur |
| **Charge utile : table CBOR à clés entières** (version, numéro, praticien, dates d'émission et d'expiration, autorité) **+ empreinte SHA3-256** de ces données, encodées de façon déterministe (R-QR-02) | Compacte : 380 à 420 caractères, QR de version 12 (65 × 65 modules) en correction M, lisible par un téléphone d'entrée de gamme. L'empreinte recalculée est un second contrôle : avec la signature désactivée (contre-épreuve), un QR modifié reste rouge | — |
| **Décodage strict** : encodages minimaux, pas de clé en double, UTF-8 valide, pas de longueur indéfinie, seule l'étiquette COSE_Sign1 admise, texte limité à 1 024 caractères | Une même donnée n'a qu'un encodage accepté ; un QR hostile est refusé avant tout calcul (ASVS V5) | — |
| **Signature : `node:crypto`** (comme prévu au §2.9) ; **vérification : `@noble/curves` et `@noble/hashes`**, bibliothèques auditées, sans dépendance, identiques dans le navigateur et dans Node | WebCrypto ne connaît pas SHA-3 : il faut de toute façon une bibliothèque côté navigateur. Ed25519 vérifié selon les règles strictes de la RFC 8032, comme OpenSSL | WebCrypto Ed25519 : récent, absent des navigateurs Android anciens |
| **CBOR : `cborg`** | Bibliothèque orientée stricte et déterministe, sans évaluation de code | `cbor-x` : plus rapide, mais moins strict au décodage |
| **Clés publiques publiées en JWKS** (`/cles-certificats.json`), avec un indicateur de révocation par clé | Format standard (RFC 7517, 8037) ; une clé compromise rend rouges tous ses certificats, même hors ligne une fois la liste à jour (R-QR-04) | — |
| **Vérification dans le site public**, page `/verifier` : lecture du QR par la caméra (**jsQR**), service worker limité à cette page | UC-06 est un cas du visiteur, qui n'a pas l'application des agents. Le service worker garde la page, son code et les clés : la vérification marche sans réseau, en moins d'une seconde dans le pipeline | Service worker Serwist : son intégration avec Turbopack n'est encore qu'un contournement (compilation du service worker avec esbuild au moment de servir la page). Le choix de Serwist pour le site entier est repris avec les récits hors ligne du site public (S11) |
| **Clés de test éphémères**, créées en mémoire à chaque exécution, identifiant `test-…` ; seules les clés publiques sont écrites | Aucune clé privée n'existe sur disque ni dans le dépôt ; aucun coffre (Vault, OpenBao) pour le prototype, décision du maître d'œuvre | Clé de test dans `.env` : inutile, et une clé privée de moins à protéger |
| **Tests de bout en bout Playwright** (Chromium, fausse caméra), lancés par `infra/ci/e2e.sh` | La page est chargée une fois, puis le serveur est arrêté et le réseau coupé : le verdict ne peut venir que du téléphone. Le délai du verdict est mesuré (R-QR-05 : moins de 5 s) | — |
| **Accessibilité vérifiée par axe** (`@axe-core/playwright`, WCAG 2.2 AA) sur chaque écran de `/verifier`, dans le même test, en avance sur US-010 | Une exigence n'est tenue que si le pipeline la vérifie : contraste des verdicts, libellés, structure. Contre-épreuve : un verdict ambre trop pâle fait échouer le test | Contrôle à l'œil seulement |
| **Empreinte SHA-3 repliée sous « Détails techniques »**, en blocs de 4 caractères (décision du maître d'œuvre après l'essai sur téléphone) | Le CdC (§5.2) demande l'empreinte ; 64 caractères hexadécimaux encombraient le verdict sans aider le citoyen. Repliée, elle reste disponible pour comparer au certificat papier | Ne plus l'afficher : écart au CdC |

**Résultats mesurés** (pipeline, Chromium de bureau) : QR authentique vert, QR modifié rouge, QR signé par une autre clé rouge, QR expiré ambre, chacun sans réseau en moins d'une seconde. Code propre à la page : 73 Ko compressés (lecteur de QR et vérification), 248 Ko pour un premier chargement complet, gardés ensuite par le service worker. Le prototype a été essayé sur un téléphone le 2 novembre 2026 : REDMI Note 15, Android 16, 8 Go de mémoire vive, Chrome 156 (milieu de gamme, donc plus rapide qu'un entrée de gamme). Le site était arrêté sur le poste : les 4 verdicts sont exacts, le vert s'affiche en moins de 3 s, le QR étant affiché sur un écran. L'essai a relevé un défaut, corrigé aussitôt : l'aperçu noir de la caméra restait affiché au-dessus du verdict. Il reste à essayer un appareil d'entrée de gamme (2 à 3 Go de mémoire vive).

**Limites et suites.**
- Révocation d'un certificat : connue en ligne seulement (UC-06 2a) ; le verdict hors ligne le dit.
- Annonce du verdict à la voix (UC-06) et version anglaise de la page : avec le site public.
- Base de données : `certificat.signature` stocke la signature COSE, qui couvre l'en-tête protégé et la charge utile (le commentaire de la colonne dit « signature de l'empreinte ») ; `cle_signature` devra porter l'identifiant de clé (`kid`) publié. Migration à faire avec le récit d'émission du certificat.
- En production : clé privée dans le coffre (§2.9), identifiant de clé de la DG distinct du préfixe `test-`.

### 2.17 Prototype de la chaîne audio (récit US-005, novembre 2026)

**Décision du maître d'œuvre (2 novembre 2026) : validé**, après l'essai sur téléphone (mi-force retenue). Partie serveur : les choix ci-dessous ont été tranchés en cours de récit, sur mesure.

| Choix | Pourquoi | Écarté |
|---|---|---|
| **FFmpeg 9.0.2, image « scratch »** (FFmpeg seul, sans système d'exploitation), épinglée par empreinte, lancée sans réseau par `packages/audio/src/ffmpeg.ts` | Même logique qu'Atlas (§2.15) ; analysée par Trivy dans le pipeline ; quasiment rien d'autre que FFmpeg à tenir à jour | Image Ubuntu de FFmpeg 7.1 : 13 mois sans mise à jour ; image linuxserver : 1 Go |
| **RNNoise à mi-force** (`arnndn` avec `mix=0.5`), modèle **`cb`** du dépôt GregorR/rnnoise-models | Mesuré : à pleine force, RNNoise retire presque tout le bruit mais abîme la voix (STOI 0,799, contre 0,847 pour la voix simplement compressée), sur un brouhaha comme sur un bruit continu. À mi-force, la perte n'est que de 0,012 : une recette doit être comprise mot pour mot. Les 5 modèles du dépôt ont été comparés : `cb` est le meilleur à pleine force, ils se valent à mi-force | Pleine force : moins de bruit, moins d'intelligibilité. Le choix final se fait à l'écoute pendant l'essai sur téléphone (un seul réglage) |
| **Volume normalisé à -16 LUFS** (crête -1,5 dBTP) | Niveau usuel de la parole écoutée sur téléphone | -23 LUFS (radiodiffusion) : trop faible sur un haut-parleur de téléphone |
| **Conteneur WebM, index en tête** (`cues_to_front`), **trames Opus de 60 ms** | Mesuré en 3G : avec Ogg, qui n'indique pas sa durée, Chromium ouvre une seconde connexion pour lire la fin du fichier avant de jouer (5,3 à 6,8 s). Avec WebM, la lecture démarre en 2,3 s, après 52 Ko reçus sur 268. Les trames de 60 ms réduisent les en-têtes du conteneur : 268 Ko au lieu de 307 Ko avec des trames de 20 ms | Ogg Opus : trop lent à démarrer en 3G. Le fichier de secours AAC (§2.7) reste prévu |
| **Métadonnées retirées** (nom de l'appareil, date, position) | Une voix enregistrée sur un téléphone peut porter sa position : rien de tel ne doit être publié (ASVS V8) | — |
| **Échantillon versionné et reproductible** : 90 s de lecture LibriVox (domaine public) dans un brouhaha de trois autres voix et un bruit grave, à 5 dB | Toujours le même cas difficile, sur tous les postes ; sources et droits dans `packages/audio/fixtures/SOURCES.md` | Voix de synthèse : RNNoise a été entraîné sur de vraies voix, la mesure serait faussée |
| **Indice STOI** (Taal et al., 2011) écrit en TypeScript, vérifié contre l'implémentation de référence pystoi (écart inférieur à 1e-4) | Mesure objective et reproductible de « reste compréhensible », sans Python dans le pipeline | Écoute seule : non reproductible |
| **Relais 3G** (`packages/audio/src/relay.ts`, en ligne de commande par `infra/local/relay-3g.ts`) : 400 kbit/s, 400 ms d'aller-retour, 2 allers-retours d'établissement de connexion | L'établissement de la connexion (TCP puis TLS 1.3) est compté, ce que le bridage de Chromium ne fait pas (décision du maître d'œuvre). Le relais est lui-même testé : premier octet après 3 allers-retours, débit tenu | Bridage du navigateur |

**Règle de preuve de « reste compréhensible »** : STOI d'au moins 0,75 par rapport à la voix propre, et perte d'au plus 0,02 par rapport à la même voix compressée sans traitement. La règle envisagée avant de coder (« jamais en dessous de la voix bruitée ») est intenable : la compression Opus seule coûte déjà 0,005.

**Résultats mesurés** (pipeline) : 90 s traitées → **268 Ko**, 90,0 s, **STOI 0,836** (voix bruitée brute : 0,853 ; compressée sans traitement : 0,847). Lecture en 3G : **2,3 s** du clic au son, après 52 Ko reçus.

**Essai sur téléphone (2 novembre 2026)** : REDMI Note 15 (2510DRA23G), Android 16, application Flutter de débogage, relais 3G du banc d'essai. Voix réelle de 66,6 s enregistrée sur le téléphone : **323 Ko envoyés en 14,2 s**, rendus en 189 Ko (mi-force) et 190 Ko (pleine force). Téléchargement mesuré au travers du même relais 3G : premier octet reçu en **1,5 s**, fichier complet en 5,2 s, pour les deux versions. **Décision du maître d'œuvre (2 novembre 2026)** : le son est jugé bon, **RNNoise à mi-force est retenu**.

**Règles de tout lecteur audio de la plateforme** (application et site ; posées après l'essai, à appliquer dans les récits qui affichent un lecteur) :

| Règle | Référence |
|---|---|
| Lecture et pause toujours visibles, jamais de lecture automatique | WCAG 2.2, critère 1.4.2 |
| Vitesse réglable : 0,75×, 1×, 1,25×, 1,5×, 2×, sans changer la hauteur de la voix ; la vitesse choisie est gardée d'une écoute à l'autre | Backlog (lecteur par section) ; pratique des lecteurs de podcast |
| Recul et avance de 10 s, barre de progression déplaçable, temps écoulé et durée totale | Pratique courante (Android Media3, lecteurs de podcast) |
| Reprise là où l'écoute s'est arrêtée | Pratique courante |
| Cibles tactiles d'au moins 48 dp, chaque bouton nommé pour le lecteur d'écran, commandes au clavier sur le site | WCAG 2.2 (2.5.8, 4.1.2, 2.1.1) ; Material |
| Lecture qui démarre avant la fin du téléchargement, et indicateur de chargement en 3G | E1, mesures ci-dessus |
| Transcription en français seulement ; aucune transcription écrite en langue nationale | Règle du projet (langues nationales en voix uniquement) |

**Application mobile (seconde partie du récit)**

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Flutter 3.47.7**, épinglé par version et par l'empreinte SHA-256 de l'archive officielle (`infra/ci/mobile.sh`) ; sur le poste, installé à part (`FLUTTER_BIN`) | Même règle que les actions et les images (§2.13). 3.47.9, la plus récente, avait 4 jours : trop jeune | Action Flutter tierce : une dépendance de plus à épingler et à surveiller |
| **Job Flutter dans son propre workflow** (`mobile.yml`), déclenché seulement par `apps/mobile/` et ses fichiers de pipeline ; APK de débogage publié 14 jours | Critère de US-005 et économie de minutes (§2.13). La règle est vérifiée par `check-repo.sh`, avec contre-épreuve | Job dans `ci.yml` avec un test interne : il démarrerait à chaque demande |
| **`record`** (enregistrement) et **`just_audio`** (lecture progressive) | Paquets les plus utilisés de l'écosystème Flutter pour ces besoins ; `record` écrit l'Opus d'Android 10 en Ogg et l'AAC en MP4, formats acceptés par le serveur | — |
| **Enregistrement et lecture derrière deux interfaces** (`lib/audio_io.dart`) | L'écran se teste sans micro ni haut-parleur, avec les règles d'accessibilité de Flutter (cibles tactiles, libellés, contraste) | — |
| **HTTP en clair vers `localhost` seulement, en version de débogage** (`network_security_config`) | Le banc d'essai est relié par `adb reverse`. La version publiée n'a pas ce fichier : HTTPS partout | Autoriser le HTTP en clair partout |
| **Banc d'essai** (`packages/audio/src/essai-server.ts`), derrière le relais 3G : reçoit la voix, la traite à mi-force et à pleine force, sert les deux versions par morceaux. Pour l'essai seulement | La chaîne de production passera par l'API (tâche pg-boss, SeaweedFS). Types, taille (3 Mo) et chemins contrôlés et testés ; voix effacées à l'arrêt, jamais dans le dépôt | Ajouter FFmpeg à l'image de l'API dès maintenant : prématuré |
| **Compilation Kotlin incrémentale désactivée, mémoire de Gradle à 4 Go** | Sous Windows, la compilation incrémentale échoue quand le projet et le cache des paquets sont sur deux lecteurs ; les 8 Go du modèle Flutter dépassent la mémoire d'un poste de 8 Go | — |

### 2.18 Analyse du code par Semgrep (récit US-007, novembre 2026)

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Semgrep 1.181.0, édition communautaire**, image `semgrep/semgrep` épinglée par empreinte, lancée par `infra/ci/semgrep.sh` | Le script tourne tel quel sur GitLab CI (US-008) ; `--metrics=off` : aucune donnée envoyée à Semgrep, le code n'est jamais transmis | CodeQL : payant sur un dépôt privé. Semgrep AppSec Platform : service externe, compte requis |
| **Règles du dépôt `semgrep/semgrep-rules`, épinglées par commit**, téléchargées à chaque analyse (bash, dockerfile, generic, html, javascript, typescript, yaml) | Le même code donne toujours le même verdict. La licence des règles (Semgrep Rules License v1.0) permet l'usage interne mais pas la redistribution : elles ne sont pas copiées dans le dépôt | Jeux du registre (`p/default`) : changent sans prévenir, non épinglables |
| **Seule la gravité haute bloque** (ERROR, ou HIGH et CRITICAL) ; les autres résultats sont affichés | Critère de US-007. Les avertissements restent visibles sans arrêter le travail | Tout bloquer : trop de bruit (règles de style, portabilité) |
| **Exceptions ligne par ligne, justifiées** (`// nosemgrep: <règle> -- raison`), et règle i18next écartée (le projet n'utilise pas i18next) | Une exception se lit dans le diff, à côté du code concerné | Exclure des dossiers entiers : cacherait les vrais problèmes |
| **Contre-épreuve** `infra/ci/semgrep-selftest.sh` : un `fetch` en HTTP clair doit bloquer, le même en HTTPS doit passer | Preuve que le blocage fonctionne vraiment | — |

### 2.19 Prototype de synchronisation hors réseau (récit US-004, novembre 2026)

**Proposition à confirmer par le maître d'œuvre : validé.** Preuves : cloisonnement par zone contre le vrai service PowerSync, règle R-DON-04 contre un vrai PostgreSQL, file d'envoi sans perte en cas de coupure, base du téléphone chiffrée et illisible sans la clé, mesures sur le téléphone d'essai (ci-dessous).

**Si la licence FSL de PowerSync devenait bloquante.** La FSL n'interdit que de proposer un service concurrent de PowerSync ; chaque version devient Apache 2.0 deux ans après sa sortie. Si elle bloquait quand même : 1) rester sur la dernière version utilisable, qui deviendra libre au bout de deux ans ; 2) remplacer le seul sens descendant. Le prototype est construit pour limiter la dépendance : les écritures passent par l'API et la fonction `saisie_terrain_recevoir`, jamais par PowerSync ; la règle de conflit et le cloisonnement vivent dans notre base et nos règles ; le téléphone garde une base SQLite ordinaire. Le remplaçant le plus proche est ElectricSQL (Apache 2.0, lecture de PostgreSQL par réplication logique, filtrage par requête), à prototyper avant de basculer ; estimation : un récit de 5 points.

**Mesure du surcoût de SQLCipher** (téléphone d'essai Xiaomi 2510DRA23G, Helio G99, 8 Go, Android 16 ; mode profil ; médiane de 3 passages ; 300 dossiers d'environ 2 Kio ; test `integration_test/chiffrement_test.dart`, mesure du 7 novembre 2026, les trois variantes dans le même passage) :

| Mesure | SQLite en clair | SQLCipher, phrase dérivée (PBKDF2) | SQLCipher, clé brute (retenue) |
|---|---|---|---|
| Ouverture de la base | 58 ms | 1 382 ms | 61 ms |
| Enregistrement d'un dossier | 2,5 ms | 3,6 ms | 3,5 ms |
| Lecture de 300 dossiers | 8,7 ms | 12,5 ms | 12,2 ms |
| Réouverture (300 dossiers) | 12,5 ms | 1 336 ms | 15,0 ms |
| Taille de la base | 1,9 Mio | 2,5 Mio | 2,5 Mio |

Lecture : avec la clé brute, le chiffrement coûte environ 3 ms à l'ouverture et 1 ms par dossier enregistré, imperceptible pour l'agent ; la phrase dérivée aurait imposé 1,4 s à chaque ouverture, d'où le choix de la clé brute. Le téléphone d'essai est de milieu de gamme : les durées seront plus longues sur un appareil d'entrée de gamme (2 à 3 Go), sans changer l'écart entre les variantes. La première mesure (3 novembre, phrase dérivée seule) donnait des ordres de grandeur identiques.

Méthode, quand l'installation par USB est refusée (MIUI : `INSTALL_FAILED_USER_RESTRICTED`) : compiler le test en application (`flutter build apk --profile --target=integration_test/chiffrement_test.dart`), la déposer sur le téléphone (`adb push`), l'installer depuis le gestionnaire de fichiers, puis lire la ligne `SABOU_MESURE` dans `adb logcat`.

**Essai de bout en bout de la synchronisation sur le téléphone** (7 novembre 2026, `integration_test/synchro_test.dart`, même méthode, services du poste joints par `adb reverse`) : réussi. Le dossier saisi hors réseau est arrivé au serveur au retour du réseau (ligne `saisie_terrain` de la préfecture 4, version 1, vérifiée en base) ; aller-retour téléphone → API → PostgreSQL → PowerSync → téléphone : 720 ms en réseau local. Tous les critères de US-004 sont ainsi vérifiés sur le téléphone d'essai.


| Choix | Pourquoi | Écarté |
|---|---|---|
| **PowerSync 1.27.2, édition auto-hébergée** (image épinglée par empreinte) dans Docker Compose ; sa base de travail est une base PostgreSQL séparée (`powersync`), pas MongoDB | Un seul moteur de base à exploiter ; télémétrie coupée (`disable_telemetry_sharing`) | Stockage MongoDB : un moteur de plus à sauvegarder et surveiller |
| **Le dossier saisi sur le téléphone est un seul document** (`saisie_terrain` : contenu JSON de 256 Kio au plus, identifiant UUID tiré sur le téléphone, numéro de version attribué par le serveur dans l'ordre d'arrivée) ; les tables métier ne sont remplies qu'à la soumission, côté serveur | R-DON-04 règle le conflit sur le **dossier entier**, sans fusion champ par champ : un document unique rend la règle simple et vérifiable. Les contraintes de la base (langues, zones, transitions) restent appliquées au serveur, jamais contournées par le téléphone | Synchroniser directement `recette`, `dossier_certification`… : identifiants `bigint` impossibles à créer hors réseau, conflits ligne par ligne contraires à R-DON-04 |
| **Rôles dédiés** : `sabou_sync` (réplication logique, lecture des seules tables publiées) et `powersync_storage` (propriétaire de la base de PowerSync) ; publication `powersync` limitée aux tables utiles | Moindre privilège : PowerSync ne lit rien d'autre que ce qui part vers les téléphones | Le super-utilisateur, ou `FOR ALL TABLES` : PowerSync lirait les mots de passe hachés et le journal d'audit |
| **Cloisonnement par zone dans les règles de synchronisation** (`packages/db/sync/sync-rules.yaml`), avec une zone lue dans le **jeton signé**, jamais dans les paramètres envoyés par le téléphone | PowerSync lit la table entière, sans RLS : seules ses règles décident de la diffusion. Le test `sync-zone.test.ts` le prouve contre le vrai service, avec deux contre-épreuves (zone figée, rôle non contrôlé) | Zone envoyée par le téléphone : falsifiable |
| **Jetons HS256 en développement et dans les tests** ; en production, clés publiques de Keycloak (`jwks_uri`, RS256), branchées avec US-010 | Pas de dépendance à Keycloak pour prouver le cloisonnement | — |
| **Règle de conflit R-DON-04 dans une fonction SQL** (`saisie_terrain_recevoir`), seule porte d'entrée des écritures venues des téléphones ; l'API (`POST /sync/upload`) vérifie le jeton puis l'appelle, un point de sauvegarde par opération | Verrou sur le dossier, agent et zone revérifiés en base, ordre d'arrivée garanti par la transaction ; règle prouvée sur un vrai PostgreSQL | Règle dans l'API : deux agents simultanés pourraient se croiser sans verrou commun |
| **Renvoi idempotent** : un contenu identique déjà reçu ne crée ni version ni copie | Une coupure entre l'enregistrement au serveur et la réponse fait renvoyer le lot : il ne doit rien dupliquer | Numéro d'opération stocké par téléphone : plus lourd, même effet ici |
| **Avis de conflit synchronisés vers leur seul destinataire** (`saisie_terrain_avis`) | R-DON-04, point 4 : l'agent dont la version n'a pas été retenue l'apprend à la synchronisation suivante, même sans notification | Notification poussée : demande le réseau au bon moment |
| **PowerSync 2.5.0 (Dart) et SQLCipher** choisi à la compilation (`hooks: user_defines: sqlite3: source: sqlcipher`) ; le paquet `powersync_sqlcipher` est abandonné par l'éditeur depuis la 2.0 | Une seule bibliothèque SQLite dans l'application, chiffrement natif de chaque page (AES-256, HMAC) | SQLite3MultipleCiphers : le maître d'œuvre a retenu SQLCipher |
| **Clé brute de 256 bits** (`x'…'`), tirée au hasard au premier lancement et gardée dans le magasin sécurisé (`flutter_secure_storage` 11.2.0, Keystore Android) | La dérivation PBKDF2 d'une phrase ne renforce pas une clé déjà aléatoire et coûtait 1,6 s à chaque ouverture | Clé dans le code ou dérivée d'un identifiant du téléphone : récupérable |
| **Sauvegardes Android désactivées** (`allowBackup`, règles d'extraction) | La clé du Keystore ne quitte pas le téléphone : une copie restaurée serait illisible ; les dossiers ne doivent pas sortir du téléphone | — |
| **Défaut relevé dans le schéma de US-003** : les fonctions et déclencheurs existants résolvent leurs tables par le `search_path` de l'appelant ; l'API ouvre donc ses connexions avec `search_path=sabou,public`. Les nouvelles fonctions fixent leur propre `search_path` | Sans cela, une écriture de l'API échouait (« relation langue does not exist ») | Corriger toutes les fonctions existantes : à faire dans un récit dédié (sécurité : un `search_path` fixé protège aussi des objets homonymes) |

---

### 2.20 Connexion et double facteur (récit US-010, novembre 2026)

Décisions validées par le maître d'œuvre le 5 novembre 2026 (questions de sécurité posées avant le développement).

| Choix | Pourquoi | Écarté |
|---|---|---|
| **API intermédiaire (« BFF »)** : l'API NestJS échange le code d'autorisation (OIDC, PKCE S256, `state` lié au navigateur par un cookie, `nonce`), vérifie le jeton d'identité (`openid-client` 6.8.8) et garde les jetons ; le navigateur n'a qu'un cookie `__Host-sabou_session` HttpOnly, Secure, SameSite=Lax. Sessions dans Valkey (`ioredis` 5.11.1) : seule l'empreinte SHA-256 de l'identifiant est stockée | Un script injecté ne peut pas voler de jeton ; la révocation (US-013) se fait côté serveur. Recommandation actuelle pour les applications dans le navigateur (OAuth 2.0 for Browser-Based Apps) | Jetons dans l'application React : exposés à toute faille XSS |
| **Pages de connexion servies par Keycloak**, thème `sabou` (gabarits de base, une feuille CSS de quelques Ko, français et anglais) | Le mot de passe ne transite jamais par notre code ; page légère en 3G | Formulaire maison avec « direct grant » : déconseillé (OAuth 2.1), contourne le double facteur conditionnel ; thème `keycloak.v2` (PatternFly) : trop lourd en 3G |
| **Double facteur** : code TOTP d'une application (FreeOTP, Google ou Microsoft Authenticator), obligatoire pour le rôle technique `administrateur` (porté par `dg`, `admin_regional`, `admin_prefectoral`, `comite`), proposé aux autres. Un administrateur sans second facteur doit configurer le TOTP puis ses codes de secours avant tout accès. Téléphone perdu : code de secours, ou réinitialisation par la DG | R-ACC-03 ; pas de SMS (détournement de carte SIM, coût, agrégateur pas encore prêt) | SMS ; passkeys (plus tard) |
| **Défense en profondeur** : l'API refuse la session d'un administrateur dont le jeton ne contient pas `otp` dans le claim `amr`. Juste après l'activation, le code est demandé aussitôt, sans retaper le mot de passe (§2.28 ; avant le 8/11/2026, il fallait se reconnecter) | Une erreur de configuration de Keycloak ne suffit pas à ouvrir l'accès | — |
| **`prompt=login`** à chaque connexion (sauf la relance de niveau 2, §2.28) | `amr` décrit toujours les facteurs réellement saisis ; l'activation du double facteur exige de retaper le mot de passe ; pas de course entre la déconnexion et le cookie SSO de Keycloak | Reprise silencieuse de la session Keycloak |
| **Blocage** : 5 échecs, compte bloqué 15 minutes (compteur remis à zéro après 12 h sans échec), sans blocage définitif ; tentatives à moins d'une seconde d'intervalle : 1 minute | CdC §3.1. Limite connue : un tiers qui connaît un identifiant peut le bloquer 15 minutes | Blocage définitif : déni de service trop facile |
| **Sessions** : 30 minutes d'inactivité, 10 heures au plus (Keycloak et API) ; jeton d'accès de 5 minutes | ASVS V3 | — |
| **Journal** : événements de connexion de Keycloak (dont `LOGIN_ERROR` et `USER_DISABLED_BY_TEMPORARY_LOCKOUT`) conservés 90 jours ; versés au journal d'audit par US-030 (§2.21) | R-ACC-05 | — |
| **Domaine Keycloak versionné** : `infra/local/keycloak/realm-sabou.json`, importé à la création du domaine ; `pnpm env:realm` le réimporte en local | Configuration relue et reproductible, la même en recette et en production | Réglage à la main dans la console |
| **Mot de passe oublié** : « Contactez votre administrateur » ; réinitialisation par e-mail plus tard (service SMTP à choisir) | Pas de service externe ajouté sans accord | — |

**Particularités de Keycloak 26.8 relevées** (à garder en tête si l'on modifie le parcours) : une étape ALTERNATIVE n'est pas inscrite dans le claim `amr` ; chaque méthode est donc placée dans son propre sous-parcours, où elle est REQUIRED. Une référence AMR sans `default.reference.maxAge` n'est gardée que si le jeton est émis dans la même seconde : la durée est fixée à 10 heures. Le code saisi pendant la configuration du TOTP ne compte pas dans `amr`.

**Contrôles du pipeline** (job « Application de gestion de bout en bout », `infra/ci/e2e-admin.sh`) : tests Playwright des critères contre le vrai Keycloak, axe (WCAG 2.2 AA) sur chaque écran traversé ; Lighthouse CI sur la page d'accueil et la page de connexion Keycloak, 3G normale (300 ms, 700 kbit/s, processeur divisé par 4), médiane de 3 mesures. Seuils bloquants : performance ≥ 0,90, accessibilité = 1, bonnes pratiques ≥ 0,90, LCP ≤ 3 s, CLS ≤ 0,1, TBT ≤ 200 ms, poids ≤ 150 Ko. Mesures du 5 novembre 2026 : application 0,92 / 1 / 0,96, LCP 2,8 s, 61 Ko ; Keycloak 0,97 / 1 / 1, LCP 2,1 s, 29 Ko. Le LCP de l'application (2,8 s) dépasse l'objectif de 2,5 s : le contenu attend React (60 Ko compressés). Piste : pré-générer la page de connexion à la compilation. Les pages sont servies comme en production (`apps/admin/scripts/serve.mjs` : Brotli, cache long, CSP).

### 2.21 Journal d'audit des décisions et connexions (récit US-030, novembre 2026)

Décisions validées par le maître d'œuvre le 6 novembre 2026 : relève des événements de Keycloak par un compte de service, conservation sans limite en v1, chaînage des empreintes reporté (backlog, US-030).

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Une seule table `journal_audit`, en ajout seul** : déclencheur qui refuse `UPDATE` et `DELETE` (par ligne) et `TRUNCATE` (par instruction), même pour le propriétaire de la table ; droits retirés au rôle de l'API | R-DON-02 ; défense en profondeur : une erreur de droits ne suffit pas à effacer le journal | Journal dans les fichiers de log : ni requêtable ni transactionnel |
| **Même transaction que la décision** : les fonctions de workflow (`dossier_transition`, `recette_transition`) écrivent leur ligne elles-mêmes ; l'API ouvre la transaction par `AuditLog.decide(ip, …)`, qui pose l'IP par `audit_contexte()` (`set_config` local à la transaction, jamais transmis d'une requête à l'autre par le pool) | Décision et ligne d'audit sont confirmées ou annulées ensemble ; aucun appel de fonction à modifier | Paramètre IP ajouté à chaque fonction : signature changée partout ; écriture après coup par l'API : perdue si l'API tombe entre les deux |
| **Heure imposée par la base** (`created_at := now()` par déclencheur) | L'application ne choisit pas le « quand » | — |
| **Connexions** : l'API journalise `connexion.reussie` (avant d'ouvrir la session : sans ligne d'audit, pas de session), `connexion.refusee` (administrateur sans second facteur) et `deconnexion`. Les échecs, blocages et changements de second facteur, qui ne passent que par Keycloak, sont relevés toutes les 60 s par le compte de service `sabou-audit` (rôle `view-events` seul, secret `SABOU_AUDIT_CLIENT_SECRET`), avec un recouvrement d'une minute et un dédoublonnage par l'identifiant de l'événement | R-ACC-05 : « toute connexion ». Keycloak garde ses événements 90 jours : une panne plus courte de l'API ne perd rien | Extension Java de Keycloak (« event listener ») : à maintenir à chaque version de Keycloak ; client `sabou-admin` réutilisé : il aurait des droits d'administration |
| **IP du client** : `trust proxy` d'Express limité aux réseaux privés (`TRUST_PROXY`) ; le premier mandataire (serveur de l'application, proxy de Vite, et en recette ou production le serveur frontal) **remplace** `X-Forwarded-For` par l'adresse de la connexion, il ne l'allonge pas | Sinon le client choisirait l'IP inscrite au journal (contre-épreuve de bout en bout avec un en-tête falsifié) | — |
| **Identifiant saisi** gardé pour un échec de connexion (champ `details.identifiant`, 255 caractères au plus) | Utile pour reconnaître une attaque visant un compte. Limite connue : un utilisateur qui tape son mot de passe dans le champ de l'identifiant l'y laisse, comme dans Keycloak | — |

**À reprendre au déploiement (US-015, US-162)** : le serveur frontal doit écraser `X-Forwarded-For` comme `apps/admin/scripts/serve.mjs`, et `TRUST_PROXY` désigner son seul réseau. Le lien entre le compte Keycloak (`compte`) et l'utilisateur de la plateforme (`utilisateur_id`) vient avec la gestion des comptes.

**Contrôles du pipeline** : `packages/db/test/journal-audit.test.ts` (vrai PostgreSQL, rôle de l'API et propriétaire), `apps/api/src/audit/audit.test.ts` et `auth.controller.test.ts` (relève et connexions), test de bout en bout « journal d'audit » de `apps/admin/e2e/connexion.spec.ts` (vrai Keycloak, lecture du journal en base).

### 2.22 Gestion des comptes (lot A : US-012 et US-013, novembre 2026)

Décisions validées par le maître d'œuvre le 6 novembre 2026 (les trois dernières en réponse aux questions posées au début du lot).

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Keycloak seule source** des mots de passe et du double facteur ; la table `utilisateur` garde le rôle, la zone, les langues et l'identifiant Keycloak (`keycloak_id`). Une migration retire `mot_de_passe_hash`, `mfa_actif`, `mfa_secret_chiffre` et leurs contraintes (aucune donnée réelle) | Un secret n'existe qu'à un endroit ; le double facteur est déjà imposé par Keycloak et vérifié par l'API (§2.20) | Copie des empreintes dans PostgreSQL : deux sources à garder d'accord |
| **Invitation par lien à usage unique, valable 72 h**, que la DG transmet elle-même ; seule l'empreinte SHA-256 du jeton est gardée en base | Aucun service d'envoi à ajouter ; un vol de la base ne donne aucun lien utilisable | Envoi par e-mail ou SMS : service externe pas encore choisi |
| **Réactivation** d'un compte suspendu, journalisée comme la suspension | Pendant naturel de la suspension (US-013) | — |
| **Choix du mot de passe sur une page de SABOU** : le lien d'invitation ouvre une page de l'application de gestion ; l'API transmet le mot de passe une seule fois à Keycloak (dans la création du compte, règles de mot de passe de Keycloak), sans le garder ni le journaliser. Ensuite, connexion normale par Keycloak (double facteur imposé aux administrateurs, §2.20) | Sans service d'e-mail, Keycloak ne fournit pas de lien « choisir son mot de passe ». **Écart assumé à §2.20** (« le mot de passe ne transite jamais par notre code »), limité à l'acceptation d'une invitation | Mot de passe provisoire montré à la DG : un secret connu d'un tiers et deux canaux ; envoi par Keycloak (`execute-actions-email`) : service SMTP à choisir |
| **Compte de service `sabou-comptes`**, avec les seuls rôles `manage-users` et `view-users` du domaine `sabou` (secret `SABOU_COMPTES_CLIENT_SECRET`), distinct de `sabou-audit` | Un compte par usage, avec les droits strictement nécessaires | Compte d'administration du domaine |
| **Langues de travail** = table existante `utilisateur_langue` : pour chaque langue attribuée, droit d'enregistrer, de traduire, de valider (R-GOV-06). La langue d'interface (texte : français ou anglais) et la langue d'écoute (voix) restent des préférences du compte | Schéma et conception déjà validés (00_Conception_BDD §utilisateur_langue) ; la question posée au début du lot l'avait omis à tort, corrigé le jour même | Langues réduites aux deux préférences |

Décisions techniques prises pendant le lot (règles de l'art, sans question au maître d'œuvre) :

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Un seul parcours « créer ou inviter »** : la DG prépare le compte (statut `invite`, sans compte Keycloak), l'API renvoie le lien ; le compte Keycloak naît à l'acceptation, avec le mot de passe choisi et le rôle attribué. Identifiant de connexion = adresse e-mail | Le mot de passe n'est jamais connu de la DG ; la zone et les langues sont contrôlées dès l'invitation (contraintes de la base) | Compte Keycloak créé à l'invitation, désactivé : un compte sans mot de passe à surveiller |
| **Rôles invitables** : DG, admin régional, admin préfectoral, Comité scientifique. Gestion réservée à la DG connectée avec son second facteur (UC-65, R-ACC-04) | Les praticiens (15 000) et les citoyens ont leurs propres parcours d'inscription | — |
| **Zone exigée par le rôle** dans le schéma de validation partagé (`@sabou/types`) et par la contrainte `ck_zone_role` de la base : une région et une seule pour l'admin régional, une préfecture et une seule pour l'admin préfectoral, aucune pour la DG et le Comité | R-ACC-02 ; la base reste le dernier rempart | — |
| **Lien d'invitation** : jeton de 256 bits dans le fragment de l'adresse (`/invitation#…`), retiré de la barre d'adresse dès la lecture, envoyé à l'API dans le corps d'une requête POST ; seule son empreinte SHA-256 est en base ; un nouveau lien ferme les précédents | Le fragment n'est jamais envoyé au serveur : le jeton n'apparaît ni dans les journaux des mandataires ni dans l'en-tête Referer | Jeton dans le chemin ou la requête |
| **Suspension** : dans une seule transaction avec sa ligne d'audit, (1) marque « suspendu » et fermeture des sessions de l'API dans Valkey (index des sessions par compte), (2) compte désactivé dans Keycloak, (3) sessions Keycloak fermées. Un échec de Keycloak annule tout et rend les sessions. La marque refuse aussi une session ouverte par une connexion en cours au moment de la suspension. La connexion refuse en plus un compte suspendu en base (défense en profondeur). La DG ne peut pas suspendre son propre compte | Critère « sessions révoquées dans la minute » tenu immédiatement, sans dépendre de l'expiration des jetons (5 min) | Attendre l'expiration des jetons |
| **Lien connexion ↔ utilisateur** : à chaque connexion, l'API retrouve l'utilisateur par `keycloak_id`, note `derniere_connexion` et inscrit `utilisateur_id` dans le journal d'audit | Suite annoncée au §2.21 | — |
| **Compte de service** : sans `view-realm`, le rôle se lit dans la liste des rôles que le compte peut recevoir (`role-mappings/realm/available`) ; vérifié sur Keycloak 26.8 | Droits strictement nécessaires | `view-realm` : lecture de toute la configuration du domaine |
| **Client des comptes de service partagé** (`apps/api/src/keycloak/service-account.ts`) par `sabou-audit` et `sabou-comptes` | Une seule implémentation du jeton et des erreurs | — |
| **`/api` relayé vers l'API** sous la même origine que l'application, comme `/auth` (Vite en développement, `scripts/serve.mjs` en recette) ; décisions protégées par le contrôle de l'en-tête `Origin` | Cookie de session `SameSite=Lax`, même origine ; protection contre la falsification de requête | — |
| **Application sans zod** : elle n'importe que des types de `@sabou/types` ; libellés des rôles définis côté application | Paquet téléchargé léger en 3G ; l'API valide chaque requête | Validation zod dans le navigateur (+ ~15 Ko compressés) |
| **Jeu d'exemple pour les tests de bout en bout** : `pnpm db:seed --if-empty` dans `infra/ci/e2e-admin.sh` | Régions, préfectures et langues nécessaires aux invitations ; base locale du développeur déjà chargée | Référentiels en migration : objet du lot C (US-020, US-021) |

**Limites connues et suites** : le premier compte DG de la recette et de la production est à créer par une procédure d'amorçage (US-015, déploiement) ; le vol du secret `sabou-comptes` permettrait de créer un compte DG (secret à protéger comme une clé d'administration) ; les liens d'invitation ne sont pas limités en nombre de tentatives (jeton de 256 bits, deviner est impossible en pratique).

**Contrôles du pipeline** : `packages/db/test/comptes.test.ts` (contraintes, vrai PostgreSQL), `packages/types/src/accounts.test.ts` (validation), `apps/api/src/accounts/accounts.test.ts` (enchaînement des décisions, accès réservé à la DG, origine), `apps/api/src/auth/session.store.test.ts` (révocation par compte), `apps/api/src/auth/auth.controller.test.ts` (compte suspendu refusé, lien avec l'utilisateur), `apps/admin/e2e/comptes.spec.ts` (critères de US-012 et US-013 de bout en bout, axe sur chaque écran).

### 2.23 Cloisonnement par zone (lot B : US-011, novembre 2026)

Décisions validées par le maître d'œuvre le 6 novembre 2026, en réponse aux questions posées au début du lot. Elles mettent en œuvre la ligne « Autorisation par zone dans PostgreSQL (RLS) » du §1.

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Contexte ouvert par l'API dans chaque transaction** (`sabou.contexte_ouvrir(sub)`, fonction `SECURITY DEFINER`) : rôle, compte, préfecture et région sont **lus en base** pour le compte Keycloak actif, puis posés en portée locale (`set_config(..., true)`). Côté API, tout accès passe par `inZone` (`apps/api/src/database/zone.ts`) | La zone ne vient jamais de la requête ni du jeton ; elle disparaît avec la transaction et ne passe pas d'une requête à l'autre par le pool. Un compte suspendu n'ouvre plus de contexte | Zone lue dans le jeton : figée jusqu'à son expiration, même après un changement de zone |
| **Règles RLS sur `praticien`, `dossier_certification`, ses pièces, visites et historique, `saisie_terrain`, ses versions et ses avis** : DG et Comité scientifique nationaux ; admin préfectoral : sa préfecture ; admin régional : les préfectures de sa région ; praticien : sa fiche et ses dossiers ; citoyen et requête sans contexte : rien. Les tables filles suivent leur dossier | Critères de US-011 ; une requête oubliée ne fuit pas, elle ne renvoie rien. Le filtre « dossiers à l'étape d'expertise » du Comité viendra avec le workflow (S2) | Toutes les tables à zone dès ce lot : règles écrites sans leurs récits |
| **Garde-fous vérifiés par le pipeline** (`packages/db/test/zones.test.ts`) : toute table qui porte une zone (`prefecture_id`, `praticien_id`, `dossier_id`, `saisie_id`) a son RLS, sauf celles listées avec le récit qui l'ajoutera ; toute fonction `SECURITY DEFINER` fixe son `search_path` (`pg_temp` en dernier) et n'est pas ouverte à `PUBLIC` ; seules les vues publiques s'exécutent avec les droits du propriétaire | Un récit qui ajoute une table ou une fonction ne peut pas oublier le cloisonnement sans faire échouer le pipeline | Revue manuelle seule |
| **Traitements internes par fonctions `SECURITY DEFINER` étroites**, qui contrôlent elles-mêmes l'acteur : réception de la synchronisation (`saisie_terrain_recevoir`), recalcul des notes après un témoignage, vérification publique d'un certificat. Les fonctions de workflow (`dossier_transition`, `recette_transition`) restent soumises au RLS, dans le contexte de l'acteur | Ni nouveau rôle de base ni nouveau secret ; double contrôle sur les décisions | Rôle `BYPASSRLS` : un secret de plus, et un rôle qui voit tout s'il est mal utilisé |
| **PowerSync (`sabou_sync`) lit toutes les saisies** (règle de lecture dédiée) et garde son propre filtre par zone (§2.19) | Sans cette règle, sa copie initiale serait vide ; son filtre reste prouvé par `sync-zone.test.ts` | — |
| **Vue interne `v_dossiers_bloques` aux droits de l'appelant** (`security_invoker`) ; les vues publiques (`v_annuaire_public`, `v_temoignage_public`, `v_couverture_langue`) gardent les droits du propriétaire | Une vue ignore le RLS par défaut : la vue interne aurait montré les dossiers de toutes les zones | — |
| **Listes en lecture seule** `GET /api/praticiens` et `GET /api/dossiers` (administrateurs avec second facteur), pagination par curseur (`limite` ≤ 100, `apres`), aucun paramètre de zone accepté ; les écrans arrivent en S2 | Preuve des critères par appel direct à l'API ; pages courtes en 3G | Écrans dès ce lot : hors des 5 points |

### 2.24 Référentiels : langues, territoires, spécialités (lot C : US-020 et US-021, novembre 2026)

Décisions validées par le maître d'œuvre le 6 novembre 2026, en réponse aux questions posées au début du lot.

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Référentiel initial chargé par une migration** (`20261106180000_referentiels`) : rôles, 6 langues, 4 régions naturelles, 8 régions, 33 préfectures et la zone spéciale de Conakry (gérée comme une préfecture), 8 spécialités. Il n'est plus dans le jeu d'exemple. Les sous-préfectures sont ajoutées par la DG ou par un import de la liste officielle, plus tard | Une base de recette ou de production a ses référentiels sans jeu d'exemple ; données publiques, non personnelles. Liste des préfectures à relire par le maître d'œuvre | Liste complète des sous-préfectures sans source officielle |
| **Règles tenues par la base** : une langue nationale n'a pas d'usage texte (R-LNG-02) ; le français reste actif en texte et en voix ; code, type et usage d'une langue sont fixés à sa création ; la langue par défaut d'une région naturelle ne peut pas être désactivée ; une langue ou une spécialité désactivée ne peut plus être choisie, mais les lignes qui la portent restent modifiables | L'API n'est pas le seul rempart (§2.23) ; une langue retirée par erreur ne bloque pas les fiches existantes | Contrôles dans l'API seule |
| **Nouvelle langue créée inactive**, activée par la DG quand ses contenus sont prêts ; elle sert aussitôt partout où une langue est choisie (comptes, voix), sans modifier le code (R-LNG-01) | Critère de US-020 ; pas de langue vide montrée au public | — |
| **Territoires : création et renommage** (régions, préfectures, sous-préfectures), journalisés avec l'ancien nom. **Fusion reportée** à un récit à part (US-022), car elle rattache praticiens, dossiers et comptes à une autre zone ; **pas de désactivation de territoire** (un territoire disparaît par fusion) | Opération difficile à défaire, hors des 5 points du lot | Fusion dans US-020 |
| **Spécialités : ajout, modification des libellés et désactivation libres** ; jamais de suppression d'une spécialité (clé étrangère des praticiens) | Réponse du maître d'œuvre ; la liste de 8 n'est que la liste initiale | Liste figée à 8 |
| **API `GET/POST/PATCH /api/referentiels/…`** réservée à la DG avec second facteur (même garde que les comptes, origine vérifiée) ; chaque décision et sa ligne d'audit dans une même transaction (`referentiel.*`). **Écran `/referentiels`** de l'application de gestion, chargé à la demande (3,4 ko compressés, sans zod) | Paramétrage « sans code » ; page légère en 3G | Formulaires générés à partir des schémas zod : +29 ko compressés |

### 2.25 Compte citoyen par numéro de téléphone (lot D : US-014, novembre 2026)

Décisions validées par le maître d'œuvre le 6 novembre 2026 (questions posées au début du lot).

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Interface d'envoi des SMS unique**, avec un **faux fournisseur** (`SMS_PROVIDER=journal`) : le message est écrit dans le journal de l'API, rien n'est envoyé. Aucune valeur par défaut : la production devra choisir. L'agrégateur réel arrive avec US-031, derrière la même interface | Aucun service externe ni dépense avant le contrat d'agrégateur | Fournisseur réel dès maintenant |
| **Connexion par téléphone + mot de passe** (8 caractères au moins, chiffres seuls acceptés) ; un SMS seulement à l'inscription (et plus tard pour un mot de passe oublié) | Coût des SMS ; usage simple sur un téléphone d'entrée de gamme | Code SMS à chaque connexion |
| **Périmètre : inscription et connexion** (API, pages `/inscription`, `/connexion`, `/compte` du site public, session par l'API intermédiaire comme pour l'administration). Estimation de US-014 portée de 3 à 5 points | UC-10 couvre les deux ; le critère 2 propose de se connecter | Inscription seule ; API seule |
| **Domaine Keycloak séparé `sabou-public`** (citoyens, plus tard les praticiens ?) : 8 caractères, blocage après 5 échecs (15 min), pas de double facteur. Le domaine `sabou` garde les administrateurs (12 caractères, double facteur) | Une seule politique de mot de passe par domaine dans Keycloak ; les comptes d'administration restent isolés des inscriptions ouvertes à tous | Même domaine, 8 caractères pour tous |
| **« Déjà inscrit » révélé seulement après le bon code** : le code est envoyé dans tous les cas, avec la même réponse | Personne ne peut tester si un numéro a un compte (comptes liés à des demandes de plantes et des témoignages de santé) ; coût : un SMS de plus | Message dès la saisie du numéro |
| **Données minimales** : mobile guinéen seulement (+224, 9 chiffres commençant par 6), prénom (affiché sur les témoignages) et mot de passe ; ni nom ni e-mail | Minimisation des données ; numéros étrangers plus chers en SMS | Numéros internationaux |

Décisions techniques prises pendant le lot (règles de l'art, sans question au maître d'œuvre) :

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Trois étapes** : (1) numéro → code ; (2) code → ticket d'inscription (256 bits, 15 min, usage unique) ou « déjà inscrit » ; (3) ticket + prénom + mot de passe → compte. Le mot de passe n'est demandé qu'après le code | Aucun mot de passe gardé en attente côté serveur ; rien n'est révélé avant le code | Mot de passe saisi avec le numéro (secret à garder 10 min) |
| **Code à 6 chiffres, 10 minutes, 5 essais** ; un nouveau code remplace le précédent ; vérification atomique (script Lua dans Valkey). Seules des empreintes SHA-256 du code (liée au numéro) et du ticket sont écrites | ASVS V2.7 ; deviner un code est impossible en pratique (3 codes par heure × 5 essais sur 10⁶) | Code en clair dans Valkey |
| **Limites** : 3 codes par numéro et par heure, 20 codes et 60 vérifications par adresse IP et par heure ; refus en 429 avec `Retry-After` | Coût des SMS et envoi en masse vers des numéros payants ; limites larges par IP car beaucoup d'abonnés mobiles partagent une adresse (NAT des opérateurs) | Captcha : service externe, lourd en 3G |
| **Mot de passe** : en plus de la règle du maître d'œuvre, refus de son propre numéro, d'un chiffre répété et des suites (12345678, 98765432) ; même fonction dans le site et l'API (`@sabou/types/phone`, sans zod) | Mots de passe essayés en premier ; aucun JavaScript inutile envoyé au téléphone | Liste de mots de passe compromis : plus tard, si besoin |
| **Compte créé par l'API** avec le compte de service `sabou-inscription` (manage-users, view-users du seul domaine public, secret `SABOU_INSCRIPTION_CLIENT_SECRET`), comme au lot A : le mot de passe transite une fois par l'API, sans être gardé ni journalisé. Inscription dans Keycloak désactivée (`registrationAllowed=false`) | La vérification du numéro par SMS doit précéder la création ; Keycloak ne sait pas envoyer de SMS sans extension | Formulaire d'inscription de Keycloak : pas de vérification du numéro |
| **Ordre de création** : compte Keycloak (rôle `citoyen`), puis utilisateur et ligne d'audit `compte.inscription` dans une transaction ; un échec de la base retire le compte Keycloak. Un compte déjà existant (Keycloak 409 ou index unique) répond « déjà inscrit » | Ni compte orphelin, ni compte sans audit | — |
| **Identifiant Keycloak = 9 chiffres nationaux** ; en base, numéro international (`+224…`, comme les praticiens), unique parmi les citoyens. Profil utilisateur déclaratif du domaine : ni e-mail ni nom exigés | Ce que le citoyen tape ; sans profil adapté, Keycloak réclamerait e-mail et nom à la connexion | — |
| **Page de connexion** : thème `sabou-public` dérivé de `sabou` (champ téléphone, aide, lien « Créer un compte gratuit » vers le site) ; un script de 15 lignes retire espaces et indicatif avant l'envoi ; sans JavaScript, la saisie des 9 chiffres fonctionne. Numéro pré-rempli après l'inscription (`login_hint`, seulement s'il est valide) | Saisie naturelle sur téléphone | Copie complète du gabarit de connexion |
| **Connexion du citoyen** : même contrôleur que l'administration (classe commune `OidcAuthController`), route `/auth/citoyen`, client `sabou-site`, cookies `__Host-sabou_citoyen` et `__Host-sabou_citoyen_login` | Les cookies ne distinguent pas les ports : sur un même hôte, les deux sessions restent séparées ; un seul code pour le parcours OIDC | Second contrôleur copié |
| **Échecs de connexion des citoyens au journal d'audit** (R-ACC-05) : la relève de US-030 lit aussi le domaine `sabou-public`, par un compte de service `sabou-audit` propre à ce domaine (view-events seul, secret `SABOU_PUBLIC_AUDIT_CLIENT_SECRET`). Source `keycloak-public` dans le journal, avec son propre point de reprise ; un domaine injoignable n'arrête pas la relève de l'autre | Toute connexion est journalisée, y compris les échecs des citoyens | Même source « keycloak » : un seul point de reprise pour deux domaines ferait perdre des événements |
| **Site public** : `/api` et `/auth` relayés vers l'API par Next.js (poste local et tests) ; en recette et en production, le serveur frontal route ces chemins vers l'API et remplace `X-Forwarded-For` (§2.21). Requêtes d'inscription refusées sans l'en-tête `Origin` du site | Même origine : cookie `SameSite=Lax` ; une autre page ne peut pas déclencher d'envoi de SMS | — |

**Limites connues et suites** :
- **Vitesse du site public en 3G** : le socle de Next.js et React (~140 Ko de JavaScript) donne en 3G simulée un LCP d'environ 4,5 s et un TBT de 400 à 600 ms, même pour une page sans code client (mesure du 6 novembre 2026). Le pipeline le mesure et l'affiche en avertissement ; il ne bloque pas. Exigence E1 **non tenue** pour le site public à ce jour : à traiter par US-118 (S13), où les seuils deviennent bloquants.
- **Mot de passe oublié** (par SMS, décision du maître d'œuvre) : pas encore réalisé ; la page de connexion l'annonce comme « bientôt disponible ».
- Relais de Next.js en local : il allonge `X-Forwarded-For` au lieu de le remplacer, donc la limite par IP peut être contournée sur le poste local. Ce n'est pas le cas en recette ni en production, où passe le serveur frontal.

**Contrôles du pipeline** : `packages/db/test/citoyens.test.ts` (contraintes, vrai PostgreSQL), `packages/types/src/citizens.test.ts` (numéro, code, mot de passe, prénom), `apps/api/src/signup/signup.store.test.ts` (code, essais, ticket et limites contre un vrai Valkey), `apps/api/src/signup/signup.test.ts` (critères et protections à travers l'API), `apps/api/src/auth/citizen-auth.test.ts` (session du citoyen séparée de l'administration), `apps/api/src/audit/audit.test.ts` et `packages/db/test/journal-audit.test.ts` (relève par domaine), `apps/site/app/inscription/SignupFlow.test.tsx` (écran), `apps/site/e2e-compte/inscription.spec.ts` (critères de bout en bout, axe sur chaque écran, pages Keycloak comprises ; échec et réussite de connexion lus dans le journal d'audit), `apps/site/lighthouserc.cjs` (page Keycloak : seuils bloquants ; pages du site : accessibilité et bonnes pratiques bloquantes, vitesse signalée).

### 2.26 Dossier de certification soumis par le praticien (US-040a, novembre 2026)

Décisions validées par le maître d'œuvre le 7 novembre 2026 (questions posées au début du récit).

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Le praticien s'inscrit lui-même**, par le parcours du citoyen (code SMS, ticket, mot de passe) avec le profil « praticien » et son nom ; rôle `praticien` du domaine `sabou-public` ; e-mail facultatif ; **un compte par numéro** (citoyen ou praticien, index `ux_utilisateur_telephone_public`). La saisie par l'agent préfectoral (UC-32) vient en S8 | Le cahier des charges ne dit pas comment le praticien obtient son compte (manque comblé) ; l'identifiant de connexion du domaine public est le numéro | Invitation par le préfectoral : il faudrait d'abord le rencontrer |
| **Découpage** : US-040a (API et base, 5 points) puis US-040b (application Flutter : connexion, écrans, photo compressée pour la 3G, 5 points). S2 passe de 26 à 31 points | US-040 avec l'application mobile pesait environ 10 points | Un seul récit de 10 points |
| **Recettes vocales hors du dossier de S2** : elles s'y ajoutent avec le Studio (S5). **Écart à R-CER-06 et UC-20**, assumé jusqu'en S5 | Le Studio des recettes n'existe pas encore | Voix de présentation provisoire |
| **Pièces obligatoires : identité et photo** ; justificatifs facultatifs, contrôlés à la visite | Un praticien traditionnel n'a pas toujours de justificatif écrit | Trois pièces obligatoires |

Décisions techniques prises pendant le récit (règles de l'art, sans question au maître d'œuvre) :

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Règles tenues par la base** (migration `20261107120000_dossier_praticien`) : codes `PR-` et `DS-` attribués par des séquences ; le praticien ne crée qu'une fiche « en attente » et ne touche ni au statut, ni aux notes, ni au code ; il n'ouvre qu'un dossier initial à l'étape 1 ; il ne dépose ou ne retire ses pièces qu'à l'étape 1, jamais un compte rendu de visite ; **fiche figée pendant l'examen** (un changement de préfecture ferait sortir le dossier de la zone du préfectoral) **et une fois le praticien certifié ou suspendu** (fiche publiée, migration `20261107130000_fiche_praticien_certifie`) ; soumission refusée sans identité ni photo (trigger sur `dossier_historique`, fonction `dossier_pieces_manquantes`) | L'API n'est pas le seul rempart (§2.23) | Contrôles dans l'API seule |
| **API** `GET /api/praticien/dossier`, `PUT /api/praticien/fiche`, `POST` et `DELETE /api/praticien/dossier/pieces/…`, `POST /api/praticien/dossier/soumission` ; session du domaine public (rôle `praticien`), écritures refusées sans l'origine du site ; aucun identifiant de praticien ni de dossier accepté | Toujours le dossier du compte connecté, lu en base | — |
| **Dépôt d'une pièce** : le fichier lui-même dans le corps de la requête (pas de multipart), **5 Mo au plus** (surplus lu et jeté, jamais gardé en mémoire), **format reconnu aux premiers octets** (JPEG, PNG, PDF) quel que soit l'en-tête ; clé S3 tirée au hasard (`pieces/<uuid>.<ext>`), sans nom de fichier ni identité ; empreinte SHA-256 en base ; fichier retiré si la base refuse la pièce | ASVS V12 (fichiers) ; aucun fichier actif (SVG, HTML) servi plus tard ; requêtes simples en 3G | Formulaire multipart : une bibliothèque de plus ; adresse S3 publique |
| **Client S3 : `aws4fetch` 1.0.20** (signature SigV4, aucune dépendance) ; seau `sabou-pieces` créé au démarrage sur le poste local seulement (`S3_CREATE_BUCKET`) | Un paquet de quelques kilo-octets plutôt que le SDK d'AWS et sa centaine de paquets à surveiller | `@aws-sdk/client-s3` |
| **Accusé de réception** : réponse de l'API (code, étape 2, date) et SMS « votre dossier DS-… est bien reçu », envoyé **après la validation de la transaction** par l'interface du lot D ; un échec d'envoi n'annule pas la soumission | Critère 1 de US-040 ; jamais de SMS pour une soumission annulée (US-031) | SMS dans la transaction |
| **Réponses** : 422 et liste des pièces manquantes (critère 2) ; 409 `rejection_delay` moins de 12 mois après un rejet définitif (critère 3, trigger existant de R-CER-04) ; 409 `locked` pendant l'examen ; 415 format refusé ; 413 trop gros | Messages en français, lisibles par l'application mobile | — |

**Limites connues et suites** :
- En local, l'API utilise la clé d'administration de SeaweedFS ; en recette et en production, une clé limitée au seau des pièces (US-015, US-162).
- Lecture des pièces par les administrateurs : avec les écrans de l'étape 2 (US-041), par l'API seulement, après contrôle des droits.
- Un fichier peut rester orphelin dans le seau si son retrait échoue (signalé dans le journal de l'API) : nettoyage périodique avec l'exploitation.
- Un citoyen déjà inscrit ne peut pas devenir praticien avec le même numéro : changement de rôle à prévoir si le besoin se présente.
- Le jeu d'exemple local n'est pas rechargé (`db:seed --if-empty`) : les photos ajoutées aux dossiers d'exemple n'apparaissent qu'après `pnpm env:reset`.

**Contrôles du pipeline** : `packages/db/test/dossier-praticien.test.ts` (règles de la base, vrai PostgreSQL), `apps/api/src/dossiers/dossiers.test.ts` (critères et protections à travers l'API), `apps/api/src/signup/signup.test.ts` et `packages/types/src/citizens.test.ts` (inscription d'un praticien), `apps/site/e2e-compte/dossier.spec.ts` (critères de bout en bout : Keycloak, PostgreSQL et SeaweedFS réels).

### 2.27 Base de design commune (US-016, novembre 2026)

Décisions du maître d'œuvre du 8 novembre 2026 : une base posée une fois pour toutes, d'après la charte (CdC §10) et la maquette v1.3, dans le style des consoles des grands acteurs du numérique (sobre, sans emoji ni trait décoratif). Mode d'emploi : `packages/ui/README.md`.

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Paquet `@sabou/ui`** : variables CSS de la charte (`tokens.css`), socle, composants CSS préfixés `ui-` et composants React (ossature, en-tête de page, boutons, messages, champs, cartes, chiffres clés, tableaux, pastilles, icônes). Source TypeScript exportée telle quelle, compilée par l'application qui l'emploie | Une seule source pour l'application de gestion, puis le site public ; aucun écran ne fixe de valeur en dur | Bibliothèque de composants (MUI, Chakra…) : poids en 3G, style étranger à la charte ; Storybook : outillage lourd pour une quinzaine de composants |
| **Polices non téléchargées** : titres `Cambria, Georgia, 'Times New Roman', serif` ; texte `Calibri, 'Segoe UI', Roboto, …, sans-serif` (validé par le maître d'œuvre) | La charte est exacte sur PC Windows ; sur Android, Roboto et la famille générique ; zéro octet en 3G | Polices web (≈ 150 Ko) |
| **Cambria pour le seul titre de page** (`h1`), Calibri pour le reste | Identité institutionnelle gardée, lisibilité d'une console | Cambria pour tous les titres |
| **Écart assumé à CdC §10** : la charte prévoit le Vert action (#1F9B72) pour les liens ; il n'atteint que 3,5:1 sur blanc, sous le seuil de 4,5:1 de WCAG 2.2 AA (1.4.3). Les liens sont en Vert institution (6,5:1) ; le Vert action sert aux graphiques et indicateurs (3:1 suffit, 1.4.11). L'Or (2,4:1 sur blanc) n'est employé en texte que sur Vert forêt (5,0:1) | Accessibilité exigée (WCAG 2.2 AA) ; validé par le maître d'œuvre le 8 novembre 2026 | Vert action foncé (couleur hors charte) |
| **Texte courant à 16 px**, légendes à 13 px (la charte dit 14 pt et 10 pt, unités d'impression) | Équivalent écran ; 16 px évite le zoom automatique des champs sur téléphone | 18,7 px (14 pt converti) : trop grand pour une console |
| **Icônes en SVG intégré**, au trait, décoratives par défaut | Pas d'emoji (y compris la cloche de la maquette), pas de police d'icônes à télécharger | Emoji ; police d'icônes |
| **Messages** : encadré fin tout autour, fond teinté, icône ; erreur en `role="alert"`, autres en `role="status"` | Sobriété demandée ; WCAG 4.1.3 | Trait latéral coloré (US-010 à US-014) |
| **Navigation latérale groupée par rubriques** (maquette), menu repliable sur téléphone ; lien d'évitement | Maquette v1.3 ; WCAG 2.4.1 | — |
| **Thème Keycloak sur les mêmes variables** : `sabou.css` reprend `tokens.css`, un contrôle du pipeline vérifie qu'ils restent identiques | Connexion et application ont le même aspect | Copie manuelle sans contrôle |

**Tableau de bord d'accueil** (`GET /api/tableau-de-bord`, administrateurs avec second facteur) :

| Choix | Pourquoi | Écarté |
|---|---|---|
| Praticiens, dossiers soumis (en cours, étape 2 ou plus) et activité récente lus dans le contexte de zone : les règles RLS filtrent | Le cloisonnement reste dans la base (US-011) ; un oubli ne fuit pas | Filtre de zone écrit dans l'API |
| Comptes : comptes d'administration actifs de la zone (national pour la DG et le Comité, région avec ses préfectures, préfecture), filtre écrit dans la requête | La table des comptes n'est pas sous RLS ; seul un nombre est renvoyé, aucune identité | Comptes réservés à la DG : la zone des autres profils resterait vide |
| Activité récente : les 5 dernières transitions de `dossier_historique` (cloisonnée) | Activité métier de la zone, sans données personnelles au-delà du nom du praticien déjà visible dans les listes | Journal d'audit : non cloisonné, contient adresses IP et événements de connexion |
| Fonctions à venir annoncées par une liste et une carte « Sprint 3 », sans lien dans la navigation | Aucun lien vers une page qui n'existe pas | Entrées de menu grisées |
| Refus de l'API (compte sans zone active) : message en français écrit par l'écran | Le message de l'API (« Forbidden ») est en anglais | — |

**Contrôles du pipeline** : `packages/ui/src/tokens.test.ts` (contraste AA de chaque couple employé, couleurs de la charte inchangées, aucun emoji, aucun trait latéral, aucune couleur en dur hors `tokens.css`, polices terminées par la famille générique) ; `packages/ui/src/components.test.tsx` (rôles, libellés, page courante, menu). Contre-épreuve faite : un trait latéral, une couleur en dur ou un gris trop clair font échouer les tests.

**Pages de connexion (Keycloak)** : `tokens.css` copié dans le thème et chargé avant `sabou.css`, qui n'emploie que ces variables ; messages en encadré fin avec icône dessinée (mêmes tracés que `Icon.tsx`), `role="alert"` pour les erreurs. Libellés de Keycloak remplacés dans les fichiers de messages du thème (« Soumettre » devient « Valider », « code-barres » devient « QR code ») ; la page des codes de secours est surchargée, car son gabarit d'origine écrit « Warning alert » en dur. Contrôles : copie exacte de `tokens.css`, aucune couleur en dur ni variable inconnue, aucun de ces textes dans le thème (`tokens.test.ts`). Bandeau de l'application : le nom de l'utilisateur passe à la ligne au lieu d'être coupé.

### 2.28 Code demandé aussitôt après l'activation du second facteur (US-016, novembre 2026)

Décision du maître d'œuvre du 8 novembre 2026 : « code seul ». Keycloak configure le TOTP sans le faire compter dans `amr` ; l'administrateur était donc refusé à sa première connexion et devait se reconnecter (mot de passe, puis code).

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Parcours Keycloak en deux niveaux** : `sabou-level-1` (mot de passe) porte une condition de niveau, valable 10 minutes ; `sabou-level-2` (second facteur) est toujours exécuté, sans condition de niveau | La relance reprend le niveau 1 tout juste acquis et ne demande que le code ; le second facteur ne dépend jamais du niveau demandé | Condition de niveau sur le second facteur aussi (montage habituel de Keycloak) : sans niveau demandé, Keycloak 26 n'exécute que le niveau 1 (lu dans `ConditionalLoaAuthenticator`), et une adresse forgée avec `acr_values=1` (console de compte intégrée, par exemple) sauterait le code |
| **Relance unique par l'API** : au retour d'une connexion sans `otp` dans `amr`, pour un administrateur ou après une activation demandée par l'application (`kc_action_status=success`), l'API ne ferme pas la session Keycloak : elle relance l'autorisation avec `acr_values=2` et sans `prompt=login`. Keycloak reprend le niveau 1 tout juste acquis et ne demande que le code. La transaction de relance est marquée ; au second retour sans `otp`, refus et fermeture de la session Keycloak comme avant | Une saisie au lieu de deux ; la défense en profondeur (§2.20) reste entière ; pas de boucle | Accepter l'administrateur sur le code de configuration : Keycloak ne le signale pas, il faudrait croire l'absence d'erreur |
| **« Allow access »** en fin de niveau 2 | Praticien sans second facteur : aucun sous-parcours ne s'applique, et Keycloak tiendrait le niveau pour échoué (« mot de passe invalide ») | — |
| L'application confirme « Double facteur activé » au retour de la relance | L'utilisateur sait que le code saisi a servi | — |

Le niveau atteint (claim `acr`) n'est pas lu par l'API : seul `amr` dit si un code a été saisi. Une description de parcours Keycloak ne doit pas dépasser 255 caractères (sinon Keycloak ne démarre plus à l'import).

**Lighthouse sur toutes les pages, téléphone et ordinateur** (`apps/admin/scripts/lighthouse.mjs`) : une préparation Playwright (`apps/admin/lighthouse/prepare.spec.ts`) ouvre les sessions de comptes de test jetables ; Lighthouse mesure chaque groupe de pages avec les cookies de sa session (en-tête `Cookie`), d'abord en 3G sur téléphone, puis avec le préréglage « ordinateur », seuils vérifiés format par format. Pages : accueil sans session, connexion Keycloak, acceptation d'une invitation, tableau de bord, Comptes, Référentiels, saisie du code, activation du code, codes de secours.

Seuils : ceux de US-010 (§2.20) pour chaque page, sauf, en 3G, les pages qui attendent des données (tableau de bord, Comptes, Référentiels, Invitation) : LCP ≤ 4 s et performance ≥ 0,80, décision du maître d'œuvre du 8 novembre 2026, jusqu'à US-017. Mesures du 8 novembre 2026, téléphone : pages Keycloak 0,96 à 0,97, LCP 2,1 à 2,2 s ; accueil sans session LCP 2,84 s ; Référentiels 3,2 s, Comptes 3,2 s, Invitation 3,8 s, tableau de bord 3,9 s. Ordinateur : 1 partout, LCP ≤ 0,7 s. Accessibilité : 1 partout. Décalages corrigés au passage : grille des chiffres affichée d'emblée (valeurs « … »), activité récente en fin de page, page Comptes affichée d'un bloc (CLS 0,33 et 0,61 ramenés à 0). Essai écarté : télécharger le morceau de la page en même temps que la session aggrave le LCP simulé (accueil 2,84 → 3,27 s).

**Bridage du processeur calé sur la machine** : `scripts/lighthouse.mjs` lit d'abord l'indice de performance de la machine (`benchmarkIndex` de Lighthouse, une mesure de calibrage), puis fixe le multiplicateur à 4 × indice / 2 000, entre 1 et 4 (méthode recommandée par Lighthouse : le multiplicateur fixe de 4 suppose un ordinateur rapide). Poste : indice 1 982, × 4 ; exécuteur GitHub : 1 917, × 3,8. Le temps de blocage plus élevé dans le pipeline (231 ms une fois sur l'accueil, 273 ms sur Référentiels, contre 0 à 24 ms sur le poste) ne vient donc pas d'une machine plus lente mais de l'exécuteur partagé, d'une mesure à l'autre : sur téléphone, la médiane porte sur 5 mesures au lieu de 3 (recommandation de Lighthouse contre la variabilité). Le site public (`apps/site`) garde × 4 fixe et 3 mesures : à reprendre avec US-118. Après la fusion, le pipeline de `main` a encore relevé 226 ms sur Comptes : avec « median-run », Lighthouse CI vérifie les valeurs de la seule mesure retenue pour son score de performance, qui peut être la plus lente. Les valeurs mesurées (LCP, TBT, CLS, poids) sont désormais jugées sur la médiane de leurs valeurs (« median ») ; les scores gardent « median-run ». Les valeurs de chaque mesure sont écrites dans le journal du pipeline.

### 2.29 Dossier du praticien dans l'application mobile (US-040b, novembre 2026)

Décisions validées par le maître d'œuvre le 8 novembre 2026 (questions posées au début du récit).

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Connexion par la page de Keycloak** ouverte dans le navigateur du téléphone (code + PKCE, RFC 8252, bibliothèque AppAuth par `flutter_appauth` 13.0.0) ; nouveau client **public** `sabou-mobile` du domaine `sabou-public`, retour par le schéma privé `gn.sabou.mobile:/oauth2redirect` | Le mot de passe n'est jamais saisi dans l'application ; même page, même politique et même blocage que le site ; norme des applications natives | Formulaire dans l'application (flux « mot de passe direct ») : déconseillé par OAuth 2.1 et ASVS |
| **Session de 30 jours d'inactivité** : jeton de rafraîchissement **hors ligne** (portée `offline_access`), gardé dans le magasin sécurisé du téléphone (Keystore, `flutter_secure_storage`) ; jeton d'accès de 5 minutes en mémoire seulement ; « Se déconnecter » révoque le jeton auprès de Keycloak (`/revoke`) puis l'efface, même hors réseau | Usage peu fréquent (un dossier se remplit en plusieurs fois) ; le praticien ne voit que son propre dossier | Session courte : mot de passe redemandé à chaque ouverture |
| **Inscription sur le site** : « Créer un compte » ouvre `/inscription` du site public (parcours de US-014 et US-040a) | Garde US-040b à 5 points ; un seul parcours d'inscription à tenir | Écrans d'inscription dans l'application (+2 à 3 points) |

Décisions techniques prises pendant le récit (règles de l'art, sans question au maître d'œuvre) :

| Choix | Pourquoi | Écarté |
|---|---|---|
| **L'API accepte un jeton « Bearer »** sur `/api/praticien/*`, en plus du cookie du site (`apps/api/src/auth/mobile-token.ts`) : signature RS256 par les clés publiques du domaine (`jose`, lues par l'adresse interne de Keycloak, cache de 10 minutes), émetteur, **audience `sabou-api`** (mappeur d'audience du client), **client `azp = sabou-mobile`**, type `Bearer` ; un en-tête présent mais refusé donne 401 sans retomber sur le cookie ; clés injoignables : 503 | Un jeton d'un autre client (le site) ou d'un autre domaine ne passe pas ; « none » et HS256 refusés | Introspection à chaque requête : un aller-retour de plus vers Keycloak |
| **Pas de contrôle d'origine pour le jeton** : rien n'est envoyé d'office par le navigateur, aucune requête forgée par une autre page ne le porte. Le compte est relu en base à chaque requête : un compte suspendu est refusé aussitôt, même avec un jeton encore valable | Le contrôle d'origine protège le cookie (§2.25), pas le jeton | — |
| **Listes de la fiche pour le praticien** : `GET /api/praticien/referentiels` (spécialités et langues actives, préfectures, sous-préfectures ; cache privé d'une heure). Les référentiels complets restent réservés à la DG | L'application doit proposer des listes, pas des identifiants à taper | Ouvrir `/api/referentiels` à tous |
| **Photo préparée sur le téléphone** (`apps/mobile/lib/dossier/photo.dart`) : réduction par le système à 2400 px (mémoire), puis en Dart (`image` 4.12.0, dans un isolat) : orientation appliquée, **plus grand côté 1600 px**, **JPEG qualité 80 abaissée jusqu'à 500 Ko au plus** (≈ 10 s à 400 kbit/s), **toutes les métadonnées retirées** (EXIF : position GPS, modèle, date) | Critère 2 (3G) ; la position du domicile ne quitte pas le téléphone ; calcul en Dart pur, donc prouvé par les tests du pipeline | `flutter_image_compress` : natif, non testable dans le pipeline |
| **Pièces en photo seulement** depuis l'application (appareil photo ou galerie, `image_picker` 1.2.4) ; les PDF restent possibles par l'API | Le praticien photographie sa pièce d'identité ; pas de sélecteur de fichiers à ajouter | Sélecteur de fichiers |
| **Poste local** : l'application parle à `localhost` (API 4000, Keycloak 8080, site 3000) relié au poste par `adb reverse` ; HTTP permis vers `localhost` dans la seule version de débogage (déjà le cas depuis US-005) | L'émetteur des jetons reste `http://localhost:8080/…`, celui qu'attend l'API | Adresse du poste sur le Wi-Fi : émetteur différent, jetons refusés |
| **`android:taskAffinity=""` retiré** de l'activité principale (valeur du modèle Flutter) | Essai sur le téléphone : le retour de la page de connexion arrivait dans une autre tâche, et AppAuth répondait « No stored state » ; la connexion ne se terminait jamais | — |
| **Garde-fou du pipeline** : `check-repo.sh` refuse un nom ou une description de plus de 255 caractères dans les domaines Keycloak | Keycloak 26 refuse alors de démarrer, sans message clair (rencontré deux fois) | — |

**Limites connues et suites** :
- Essai de bout en bout sur le téléphone (Redmi Note 15) : à faire par le maître d’œuvre (pas à pas dans `apps/mobile/README.md`) ; tant qu'il n'est pas fait, la connexion réelle depuis Android est **non vérifiée** (les tests prouvent l'API, Keycloak et les écrans séparément).
- En recette et en production : adresses passées à la compilation (`--dart-define=SABOU_API_URL=…`, `SABOU_PUBLIC_ISSUER`, `SABOU_SITE_URL`), en HTTPS ; application signée (US-015 et suivants).
- Le schéma privé peut, en théorie, être déclaré par une autre application du téléphone ; PKCE rend le code intercepté inutilisable. Liens d'application vérifiés (« App Links » en HTTPS) quand le domaine de production sera connu.

**Contrôles du pipeline** : `apps/api/src/auth/mobile-token.test.ts` (signature, émetteur, audience, client, type, algorithmes), `apps/api/src/dossiers/dossiers.test.ts` (accès par jeton, critère 3 à travers l'API), `apps/site/e2e-compte/mobile.spec.ts` (connexion par la vraie page de Keycloak avec PKCE, session hors ligne de 30 jours, rafraîchissement et révocation, dossier soumis avec le jeton), `apps/mobile/test/dossier/` (session, client de l'API, photo, écrans et accessibilité), `infra/ci/check-repo-selftest.sh` (garde-fou des textes Keycloak).

### 2.30 Socle de l'application mobile (US-018, novembre 2026)

Décision du maître d'œuvre du 9 novembre 2026 : l'application est réservée au praticien et à l'agent préfectoral (CdC §1.3) ; la navigation des deux profils est construite dès US-018, la connexion des agents (client mobile dans le domaine Keycloak interne `sabou`) attend leur première rubrique (US-082, S8).

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Jetons de la charte recopiés en Dart** (`apps/mobile/lib/ui/tokens.dart`), contrôlés par `test/ui/tokens_test.dart` contre `packages/ui/src/tokens.css` ; le job Flutter se déclenche aussi sur ce fichier CSS | Une seule source (la base de design de US-016), sans outil de génération à maintenir ; toute divergence fait échouer le pipeline | Génération de code depuis le CSS (outil de plus pour une trentaine de valeurs) ; valeurs propres à l'application (deux chartes qui dérivent) |
| **Polices du téléphone** : titres en police à empattements du système (Noto Serif sur Android), texte en police sans empattements du système (Roboto) | Cambria et Calibri ne sont pas sur Android et ne peuvent pas être embarquées (licence) ; aucune police téléchargée, en 3G ; même contraste titre et texte que la charte | Polices embarquées (poids de l'application, licences) |
| **Cibles tactiles de 48 px** (contre 44 px sur le web) | Repère Android, contrôlé par `androidTapTargetGuideline` ; CdC §8 : 40 px au moins | — |
| **Profil lu dans le jeton d'accès** (claim `roles` du client `sabou-mobile`), **gardé dans le magasin sécurisé** avec la session | L'application s'ouvre sans réseau sur les bonnes rubriques (exigence hors réseau, E3) ; le profil ne sert qu'à l'affichage, l'API vérifie le jeton et le rôle à chaque demande | Demander le profil à l'API à chaque ouverture (impossible hors réseau) |
| **Compte citoyen : session révoquée aussitôt**, renvoi vers le site public | Aucune raison de garder sur le téléphone une session qui n'ouvre rien (minimisation) | Garder la session jusqu'à « Se déconnecter » |
| **Registre de rubriques** (`apps/mobile/lib/app.dart`) : identifiant, libellé, icônes, profils, contenu ; barre de navigation du bas dès deux rubriques, `IndexedStack` construit à la première ouverture ; retour Android vers la première rubrique | Ajouter une rubrique = une entrée ; pas de requête pour un onglet jamais ouvert (3G) ; la saisie survit au changement d'onglet | Bibliothèque de routage (go_router) : utile pour des liens profonds, pas encore nécessaires ; à reconsidérer avec les notifications |
| **Prototypes de S0** (Studio d'essai, dossiers de terrain hors réseau) accessibles par un bouton de la barre du haut **en version de développement seulement** (`kDebugMode`) | Garder les outils de mesure de US-004 et US-005 sans les montrer aux utilisateurs | Les supprimer (outils encore utiles) |

**Contrôles du pipeline** : `test/ui/tokens_test.dart` (alignement sur la charte), `test/ui/widgets_test.dart` (composants, lecteurs d'écran, contrastes), `test/shell/app_shell_test.dart` (navigation selon le profil, registre de trois rubriques, accessibilité des barres), `test/shell/gate_test.dart` (citoyen, ouverture sans réseau, prototypes absents de la version publiée), `test/dossier/session_test.dart` (rôles gardés et effacés) ; `check-repo.sh` accepte `packages/ui/src/tokens.css` parmi les déclencheurs du job Flutter.

### 2.31 Décision sur un dossier aux étapes 2 à 5 (US-042, novembre 2026)

Décision du maître d'œuvre du 9 novembre 2026 : US-042 ne comprend pas la saisie des visites terrain, qui reste dans US-041 (S3). Les tests créent les visites directement en base ; un admin préfectoral ne pourra valider un dossier réel qu'une fois US-041 livré.

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Un seul appel pour toutes les étapes** : `POST /api/dossiers/:code/decision` (`valide` ou `rejete`, motif obligatoire au rejet), ouvert aux 4 profils d'administration | Qui décide, à quelle étape et dans quelle zone : la fonction `dossier_transition` le contrôle déjà (R-CER-01 à 03) ; US-043 et US-044 n'auront qu'un écran à ajouter | Un appel par étape (règles recopiées dans l'API, à garder alignées sur la base) |
| **L'étape vue à l'écran est envoyée** ; si le dossier a changé d'étape, refus 409 | Une décision ne s'applique jamais à une autre étape que celle examinée (deux onglets, deux personnes) | Appliquer la décision à l'étape courante, quelle qu'elle soit |
| **Dossier hors zone : 404**, sans dire s'il existe ; dossier visible mais hors de sa responsabilité (admin régional, DG à l'étape 2) : 403 | Le cloisonnement (RLS) rend le dossier invisible ; ne pas révéler l'existence d'un dossier d'une autre zone | 403 dans les deux cas (révèle l'existence du code) |
| **Refus de la base traduits par leur message** (`non habilité`, `visite terrain signée requise`), chaque message couvert par un test sur un vrai PostgreSQL et par le test de bout en bout | Pas de migration pour réécrire la fonction de workflow du schéma initial ; même procédé que la soumission (US-040a) | Codes SQLSTATE propres (réécriture complète de `dossier_transition`) : à reconsidérer si les messages changent |
| **SMS au praticien mis en file** (table `notification`, écrite par la fonction dans la même transaction) ; l'envoi relève de US-031 (§2.32) | Un SMS ne part jamais pour une décision annulée (critère de US-031) | Envoi direct depuis l'API |
| **Bouton « Valider » affiché seulement si la visite est réalisée** (ou non requise pour un renouvellement, R-QR-07) ; le rejet reste possible sans visite | Pas de bouton qui mène à coup sûr à un refus ; un dossier illisible peut être renvoyé sans déplacement | Bouton désactivé (raison non dite, peu accessible) |

**US-043 (consolidation à l'étape 3, 12 novembre 2026)** : même appel de décision, aucune migration ; la base contrôle déjà que seul l'admin régional de la région du praticien décide (R-CER-02). Décision du maître d'œuvre du 12 novembre 2026 : **ni la DG ni un autre profil** ne décide à sa place à l'étape 3 ; motif obligatoire au rejet, qui renvoie le dossier à l'étape 2 (vérification terrain). Ajouts : liste `GET /api/dossiers/consolidation` (étape 3, préfecture du praticien affichée, une région en comptant plusieurs), page « Consolidation régionale » réservée au profil régional. L'écran de vérification terrain et celui de consolidation partagent la file de dossiers et le bloc « Valider / Rejeter avec motif » (`apps/admin/src/DossierDecision.tsx`) ; US-044 n'aura qu'une page de plus.

**US-044 (expertise à l'étape 4, 12 novembre 2026)** : même appel, aucune migration. La base réserve l'étape 4 au profil « scientifique » ; le Comité étant national (`zone_visible`), il voit et décide les dossiers de toutes les régions. Décision du maître d'œuvre du 12 novembre 2026 : un seul membre du Comité décide (« un membre du Comité », critère de US-044) ; une décision collégiale (plusieurs avis, vote) serait un changement de périmètre. Ajouts : liste `GET /api/dossiers/expertise` (préfecture et région affichées), page « Expertise des dossiers » réservée au Comité. Les tests de bout en bout créent leurs dossiers par une fabrique commune (`apps/admin/e2e/dossiers.ts`).

**Contrôles du pipeline** : `packages/db/test/decision-etape-4.test.ts`, `apps/admin/src/ExpertisePage.test.tsx`, `apps/admin/e2e/expertise.spec.ts`, Lighthouse sur `/expertise` (US-044) ; `packages/db/test/decision-etape-3.test.ts` (US-043 : critère, motif, régional de la région seul), `apps/admin/src/ConsolidationPage.test.tsx`, `apps/admin/e2e/consolidation.spec.ts`, Lighthouse sur `/consolidation` ; pour US-042 : `packages/db/test/decision-etape-2.test.ts` (les 4 critères sur un vrai PostgreSQL), `apps/api/src/certification/certification.test.ts` (accès, origine, paramètres, traduction des refus), `apps/admin/src/FieldVerificationPage.test.tsx` (écran), `apps/admin/e2e/verification-terrain.spec.ts` (de bout en bout, accessibilité axe), Lighthouse sur `/verification-terrain` (seuils provisoires des pages de données, §2.28).

### 2.32 SMS au praticien à chaque étape (US-031, novembre 2026)

Décisions du maître d'œuvre (12 novembre 2026) : **API SMS d'Orange Guinée** retenue (nom d'expéditeur « SABOU » gratuit, environ 100 à 150 GNF par SMS, contre 1 500 à 2 800 GNF chez un agrégateur international), **branchée à la mise en service, sans achat d'ici là** : US-031 est livré avec l'envoi simulé. À confirmer par écrit auprès d'Orange avant le contrat : livraison vers MTN et Cellcom, contrat avec facture, accusés de réception, pays de transit. L'échec d'un SMS est **visible sur le tableau de bord de la DG** ; le SMS de rejet **ne contient pas le motif** (lu dans l'espace du praticien).

| Choix | Pourquoi | Écarté |
|---|---|---|
| **File en base** (table `notification`), écrite par `dossier_transition` dans la transaction de la décision, avec l'étape d'arrivée (`parametres`) ; **relevée par l'API** toutes les `SMS_POLL_SECONDS` (30 s par défaut, 4 min au plus ; 5 s sur le poste local) | Critère 2 tenu par construction : une décision annulée n'écrit rien ; aucun service de file à ajouter (E1, E9) | File Valkey ou service de tâches séparé ; envoi direct depuis l'API après la transaction |
| **Relève et résultat tenus par deux fonctions de la base** (`notification_sms_prendre`, `notification_sms_resultat`) : `FOR UPDATE SKIP LOCKED` et bail de 2 min, nouveaux essais après 1, 5 puis 15 min, échec au 4e essai ou sur erreur définitive, tracé au journal d'audit (`notification.echec`) | Plusieurs instances de l'API sans doublon ; un processus arrêté pendant l'envoi rend le message à la fin du bail (au pire un SMS en double, jamais perdu) ; règles testées sur un vrai PostgreSQL | Compteurs et délais dans le code de l'API |
| **Accusé de soumission passé par la même file** (texte « bien enregistré ») | Un seul chemin d'envoi, avec les nouveaux essais ; l'envoi direct de US-040a est retiré | Deux chemins d'envoi |
| **Textes en un seul SMS** : 160 caractères de l'alphabet GSM 7 bits, vérifiés par test (ni ç, ê, ô, ni apostrophe typographique) | Un caractère hors alphabet fait passer le message en UCS-2 (70 caractères) : 2 à 3 SMS facturés | Textes libres |
| **Fournisseur choisi par `SMS_PROVIDER`** (module `apps/api/src/sms`, global) ; le faux fournisseur `journal` refuse définitivement la plage d'essai `+224 669 99…` pour prouver l'échec de bout en bout | Orange s'ajoute à un seul endroit ; aucun domaine ne change | Un fournisseur par module |
| **SMS non remis : carte et liste (5 derniers) sur le tableau de bord de la DG seule** ; le numéro n'est jamais journalisé, le code du dossier suffit | Décision du maître d'œuvre ; la file n'est pas cloisonnée par zone, elle n'est lue que pour le niveau national | Page dédiée |

**Contrôles du pipeline** : `packages/db/test/notification-sms.test.ts` (file, délais, échec, SKIP LOCKED), `apps/api/src/sms/sms.test.ts` (textes, envoi), `apps/admin/src/App.test.tsx`, `apps/admin/e2e/sms.spec.ts` et `apps/site/e2e-compte/dossier.spec.ts` (de bout en bout).

### 2.33 Visites terrain et compte rendu signé (US-041, novembre 2026)

Décision du maître d'œuvre (12 novembre 2026) : le compte rendu est **saisi en ligne** par l'admin préfectoral (connecté avec son second facteur) ; le texte est **figé**, avec son **empreinte SHA3-256**, son **auteur** et l'**heure** de signature au journal d'audit ; la **photo de la fiche papier est facultative**.

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Compte rendu dans `visite_terrain`** (constats, avis favorable / avec réserves / défavorable, empreinte, signataire, heure) ; la contrainte `ck_visite_realisee` exige ces champs pour toute visite réalisée ; `compte_rendu_piece_id` devient la photo facultative | Critère 2 tenu par la base, quel que soit le chemin d'écriture | Compte rendu = pièce jointe obligatoire (schéma initial) |
| **Signature = attestation cochée + session à double facteur + empreinte SHA3-256 calculée par l'API** sur un texte canonique (version du format, dossier, visite, date, avis, auteur, constats en NFC) ; chaque donnée est gardée en base, l'empreinte se recalcule (preuve de bout en bout) | Même algorithme que les certificats (R-QR-02) ; pas de clé de signature par agent à gérer | Signature Ed25519 par agent (clés à distribuer et révoquer pour 33 agents) |
| **Compte rendu figé par un déclencheur** (`trg_visite_figee`) : une visite réalisée ou annulée ne change plus, propriétaire des tables compris, sauf l'ajout unique de la photo | Le texte signé ne peut pas être retouché après coup | Interdiction par les seuls droits de l'API |
| **Fonctions `visite_planifier`, `visite_realiser`, `visite_photo_joindre`** : préfectoral actif de la préfecture du praticien, dossier à l'étape 2 ; une seule visite planifiée par dossier (replanifier change la date) ; date prévue dans les **90 prochains jours** ; date réalisée entre la soumission et aujourd'hui | Le cloisonnement par zone seul laisserait planifier l'admin régional et la DG, qui voient le dossier | Contrôle du rôle dans l'API |
| **Rappel la veille à partir de 8 h** (heure de Conakry), une seule fois par date ; une visite planifiée moins d'un jour avant reçoit son rappel aussitôt ; replanifier le remet à zéro. Mis en file par `visite_rappels_mettre_en_file()` (SECURITY DEFINER, réservée à l'API), appelée avant chaque relève de la file des SMS (§2.32) | Aucun planificateur à ajouter ; pas de SMS la nuit ; le texte (date et code du dossier) tient en un SMS GSM 7 bits | Tâche planifiée séparée ; SMS à la planification (coût en plus, non demandé) |
| **Écran** : panneau « Visite sur place » dans chaque carte de la vérification terrain ; les annonces passent par la zone d'état unique de la page | Une seule file de travail pour le préfectoral ; une seule zone annoncée par les lecteurs d'écran | Écran d'agenda séparé (à voir avec US-083, visites hors réseau, S8) |

**Contrôles du pipeline** : `packages/db/test/visites-terrain.test.ts` (rappel, compte rendu, figement, habilitation, dates), `packages/types/src/visits.test.ts`, `apps/api/src/visits/*.test.ts` (empreinte, accès, refus), `apps/api/src/sms/sms.test.ts` (texte du rappel), `apps/admin/src/FieldVerificationPage.test.tsx`, `apps/admin/e2e/visites-terrain.spec.ts` (de bout en bout, empreinte recalculée).

### 2.34 Approbation et certificat signé par le coffre (US-045, novembre 2026)

Décision du maître d'œuvre (12 novembre 2026) : le certificat est une **page imprimable** de l'application de gestion (données, QR, empreinte) ; le PDF (Gotenberg) viendra en S9. Coffre : **OpenBao, moteur Transit, clé Ed25519 non exportable**.

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Signature par OpenBao Transit** (`transit/sign/sabou-dg`) : l'API envoie les octets de la structure `Signature1` de COSE et reçoit la signature ; clé créée avec `exportable=false` et `allow_plaintext_backup=false` | Critère 2 : la clé privée n'est jamais lue par l'application, même compromise | Clé dans un fichier ou une variable d'environnement de l'API |
| **Jeton de l'API limité** à deux droits (signer avec `sabou-dg`, lire ses clés publiques), lu dans un fichier monté (`OPENBAO_TOKEN_FILE`), relu à chaque appel ; le jeton racine ne sert qu'à préparer le coffre (`infra/local/openbao/init.sh`) | Moindre privilège ; un jeton renouvelé est pris sans redémarrer l'API | Jeton racine passé à l'API |
| **Partage base / API** : la base fixe le numéro et les dates (`certificat_preparer`), puis `certificat_emettre` vérifie ces données, enregistre la clé publique à sa première utilisation, fait passer l'ancien certificat actif à « expiré » (renouvellement, R-QR-07), écrit le certificat et le journal, et approuve le dossier (étape 5 → 6) **en une transaction** ; un déclencheur refuse toute approbation à l'étape 5 sans certificat actif | Pas de dossier approuvé sans certificat, ni de certificat sans approbation, quel que soit le chemin d'écriture | Logique dans l'API seule |
| **Identifiant de clé** (`kid`) = « dg- » + 8 caractères de l'empreinte SHA3-256 de la clé publique, dans l'en-tête signé du QR ; la version de clé du coffre est contrôlée à la signature | La rotation de clé (nouvelle version Transit) reste vérifiable hors ligne avec l'ancienne clé publique | Numéro de version seul (ambigu entre deux coffres) |
| **Coffre injoignable ou réponse inattendue : l'approbation n'a pas lieu** (délai de 5 s, corps d'erreur du coffre jamais recopié) | Aucun certificat non signé | Signature différée par une file |
| **Poste de développement** : OpenBao en mode développement (mémoire), clé et jeton recréés au démarrage | Simple ; aucune donnée réelle | Le stockage persistant, le scellement et la sauvegarde du coffre de production relèvent de l'hébergement souverain (US-008, US-162) |

**Contrôles du pipeline** : `packages/db/test/certificat-signe.test.ts` (dates, numéro, renouvellement, clé révoquée, approbation sans certificat refusée), `packages/qr/src/sign-with.test.ts` (signature par un signataire externe vérifiée hors ligne), `apps/api/src/certificates/certificates.test.ts` (approbation, coffre injoignable, droits), `apps/admin/src/ApprovalPage.test.tsx`, `apps/admin/e2e/approbation.spec.ts` (de bout en bout avec le vrai coffre, QR vérifié par la clé publique).

### 2.35 Publication du praticien à l'étape 6 (US-046, novembre 2026)

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Publication dans la transaction de l'approbation** : `certificat_emettre` enchaîne l'étape 5 → 6 puis la publication (`dossier_transition(…, 'publie')`) | Étape 6 « automatique » (R-CER-01) ; aucun dossier ne reste approuvé sans être publié, aucune file ni tâche planifiée à surveiller | Tâche planifiée qui relève les dossiers à l'étape 6 (délai, un composant de plus) |
| **Publication enregistrée au nom de la DG qui approuve, marquée automatique** : au journal d'audit, `dossier.publie`, `recette.certifiee` et `recette.certification_differee` portent `"automatique": true` (demande du maître d'œuvre, 13 novembre 2026) | L'historique exige un auteur (R-CER-05) ; la publication est la conséquence directe de sa décision ; le journal distingue ce qui a été décidé de ce qui a suivi | Compte « système » à créer dans `utilisateur` |
| **Un seul SMS** : l'approbation (5 → 6) n'en met plus en file, celui de la publication annonce la certification | Deux SMS à la même seconde coûtent double et disent la même chose | Garder les deux |
| **Traitements certifiés un par un** ; un traitement refusé par `trg_recette_publiable` (quota de la formule gratuite, R-REC-11 ; plante non validée ou section manquante, R-REC-06) reste « expertisé », la raison (`quota` ou `contenu`, classée d'après l'état et non d'après le texte de l'erreur) est enregistrée **sur le traitement** (`recette.attente_raison`, lue directement par le Studio, US-060 ; effacée par trigger dès que le statut change ; refusée hors « expertisé ») et au journal d'audit (`recette.certification_differee`) | La certification du praticien ne dépend pas d'un traitement ; **R-REC-11 prime sur R-REC-08** (validé par le maître d'œuvre, 13 novembre 2026) | Refuser toute l'approbation ; certifier sans contrôle |
| **Règle de choix en formule gratuite** : le quota de 3 compte les traitements **déjà certifiés** du praticien (cas du renouvellement) ; les places restantes vont aux traitements joints au dossier **dans l'ordre de leur création, le plus ancien d'abord** (identifiant croissant), quel que soit leur code ; les suivants restent « expertisés » | Règle simple, stable et vérifiable ; le traitement le plus ancien est celui que le praticien a préparé en premier ; aucune date de rattachement au dossier n'existe | Ordre des codes ; choix laissé au praticien (écran à créer, hors périmètre) |
| **Le praticien est informé par SMS** (`dossier.traitements_en_attente`, après celui de la publication) : nombre de traitements en attente et raison, en un seul SMS GSM 7 bits (« formule gratuite limitée à 3, certifiés au passage à GOLD », « plante ou section à compléter ») ; la promesse GOLD est tenue par un critère ajouté à US-141 (13 novembre 2026) ; le détail dans son espace relève du Studio (critère ajouté à US-060) | Le praticien sait aussitôt pourquoi un traitement n'apparaît pas ; un SMS de plus seulement dans ce cas | Ajouter la raison au SMS de publication (dépasse 160 caractères) ; écran dans l'espace du praticien dès US-046 (le Studio n'existe pas encore) |
| **Rattrapage** : la migration publie les dossiers déjà à l'étape 6 avec un certificat actif | Bases de développement où US-045 a approuvé des dossiers | — |

**Contrôles du pipeline** : `packages/db/test/publication-praticien.test.ts` (critère, quota, règle de choix par création et avec traitements déjà certifiés, raison sur le traitement et au journal, raison effacée au passage en GOLD, raison refusée hors « expertisé », SMS, marque « automatique », plante non validée, double publication refusée), `apps/api/src/sms/sms.test.ts` (texte du SMS, un seul SMS dans le cas le plus long), `packages/db/test/certificat-signe.test.ts` (un SMS de moins), `apps/admin/e2e/approbation.spec.ts` (praticien certifié et dossier clos après l'approbation).

### 2.36 Rejet définitif d'un praticien (US-047, novembre 2026)

Décisions du maître d'œuvre des 12 et 14 novembre 2026 : la DG peut rejeter un praticien déjà certifié sans dossier en cours (R-QR-06) ; les traitements certifiés passent « suspendus », ceux en cours d'examen gardent leur statut mais sortent des files ; le SMS donne la date limite du recours (date du rejet + 30 jours) et oriente vers l'administration de la préfecture, jusqu'aux litiges (US-101) ; pour une pratique dangereuse, la DG saisit la date et la référence de l'avis du Comité.

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Décision portée par le praticien** : table `rejet_definitif` (praticien, dossier clos et certificat révoqué s'il y en avait, motif, précision, avis du Comité, auteur, date, `recours_jusquau`) ; fonction `praticien_rejeter`, qui applique tous les effets dans une transaction | Le rejet vise un praticien, avec ou sans dossier en cours ; la décision et ses effets restent liés et consultables | Passer par `dossier_transition` (impossible sans dossier en cours) ; colonnes ajoutées à `praticien` (un praticien peut être rejeté de nouveau après 12 mois) |
| **Trois motifs codés** (`fraude_documentaire`, `usurpation_identite`, `pratique_dangereuse`) **et une précision écrite** obligatoire (1 000 caractères) ; l'avis du Comité (date, référence) est exigé pour la pratique dangereuse et refusé pour les autres ; il ne peut pas être daté après la décision | Motifs limités par R-CER-04 ; contraintes en base, valables quel que soit le client | Motif libre ; écran de saisie de l'avis par le Comité (écarté le 12 novembre) |
| **Décision non modifiable** : l'API n'a ni `UPDATE` ni `DELETE` sur `rejet_definitif` ; visibilité par zone (RLS, comme le dossier) | Décision grave, base du recours | Correction possible par la DG (le recours est la voie prévue) |
| **Le rejet d'un dossier ne passe plus par `dossier_transition`** : l'historique n'accepte la décision `rejet_definitif` que si elle est enregistrée dans `rejet_definitif` (trigger) | Aucun rejet sans motif encadré ni recours ; la fonction de transition, déjà redéfinie trois fois, n'est pas recopiée | Recopier `dossier_transition` sans la branche du rejet |
| **Certificat révoqué explicitement**, motif « Rejet définitif : … », avant le passage du praticien à « rejeté » ; le QR répond rouge (R-QR-05) | Le motif de révocation dit pourquoi ; le trigger générique (« Praticien rejete ») ne trouve plus rien à faire | Laisser le trigger générique |
| **Traitements certifiés « suspendus »**, historique et audit marqués automatiques ; la DG peut les recertifier si le recours rend au praticien son statut et un certificat actif | Réversible (décision du 14 novembre) ; transition déjà prévue dans `recette_transition` | Retrait (définitif) |
| **Traitements en cours d'examen arrêtés en base** : un trigger refuse toute progression (soumis, transmis, expertisé, certifié) d'un traitement d'un praticien rejeté ; retour en brouillon, suspension et retrait restent possibles. Les files de traitements n'existent pas encore : critère ajouté à US-061 pour qu'elles excluent ces traitements | Vaut pour tout client, y compris l'application mobile ; le trigger lit le praticien hors RLS (`SECURITY DEFINER` étroit) | Filtre seulement dans les écrans futurs |
| **Un seul SMS** (`praticien.rejet_definitif`) : « SABOU : rejet définitif de votre dossier DS-… » (ou « de votre certification ») « . Vous pouvez contester cette décision jusqu'au JJ/MM/AAAA auprès de l'administration de votre préfecture. » ; 157 caractères GSM 7 bits au plus ; le motif n'est pas envoyé (décision du 12 novembre) | Texte validé le 14 novembre ; tient en un SMS | Message du schéma initial (« voies de recours dans votre espace » : l'espace n'existe pas encore) |
| **Date limite du recours** : date du rejet à Conakry (UTC) + 30 jours, figée dans la décision (contrainte) | Une seule source pour l'écran, le SMS et le futur litige | Calcul à l'affichage |
| **Délai de 12 mois** compté depuis `rejet_definitif` (et, pour les bases antérieures, depuis les dossiers rejetés) | Vaut aussi pour un praticien rejeté sans dossier en cours | — |
| **API** : `GET /api/praticiens/recherche?q=` (code de praticien, de dossier ou numéro de certificat exact ; nom sans accents ; 20 résultats) et `POST /api/praticiens/:code/rejet-definitif`, réservés à la DG avec second facteur (`DirectorGuard`), puis contrôlés par la base ; le client envoie le dossier en cours vu à l'écran : s'il a changé, 409 `stale` | La DG retrouve un praticien par ce qu'elle a sous la main ; elle ne rejette jamais une situation qu'elle n'a pas vue | Liste de tous les praticiens |
| **Écran** : page « Rejet définitif » (menu Certification de la DG) ; recherche, fiche avec dossier, certificat et traitements, formulaire (motif, avis du Comité si besoin, faits), **liste des conséquences** avant une case de confirmation ; focus sur le premier champ en erreur, puis sur le message de réussite | Décision grave : la DG voit ce qu'elle va déclencher avant de confirmer (WCAG 3.3.4) | Simple bouton avec boîte de dialogue |

**Contrôles du pipeline** : `packages/db/test/rejet-definitif.test.ts` (critère 1 pour 4 rôles et par `dossier_transition` ; critère 2 sans dossier et avec dossier en cours : statut, certificat révoqué et QR rouge, annuaire, traitements suspendus puis recertifiables, SMS et date du recours, décision et audit ; motifs, avis du Comité, second rejet, traitements en examen bloqués, retrait encore possible, délai de 12 mois, décision non modifiable, RLS), `packages/types/src/rejections.test.ts`, `apps/api/src/rejections/rejections.test.ts` (accès DG seule, validation, traduction des refus), `apps/api/src/sms/sms.test.ts` (texte validé, un SMS), `apps/admin/src/RejectionPage.test.tsx`, `apps/admin/e2e/rejet-definitif.spec.ts` (dossier en cours et praticien certifié de bout en bout, axe ; régional refusé à l'écran et par l'API), Lighthouse (`/rejet-definitif`).

### 2.37 Échéance des certificats et invitation à renouveler (US-049, novembre 2026)

| Choix | Pourquoi | Écarté |
|---|---|---|
| **Une fonction de base `certificats_echeances_traiter`** (SECURITY DEFINER, réservée à l'API, toutes zones) appelée **avant chaque relève de la file des SMS** | Même mécanisme que les rappels de visite (§2.33) : pas de planificateur de plus ; chaque passage rattrape un arrêt de l'API ; elle n'agit qu'une fois par certificat | Tâche cron séparée (un service de plus), extension `pg_cron` |
| **Expiration au lendemain de l'échéance, à 0 h, heure de Conakry** : `expire_le` est le dernier jour valable ; statut « expiré », journal `certificat.expire` (automatique, sans auteur) | Le praticien sort de l'annuaire (`v_annuaire_public` ne montre que les certificats actifs), le QR répond ambre (R-QR-05) | Date du serveur (`current_date`) ; l'ancienne fonction `expirer_certificats`, jamais appelée et sans trace, est supprimée |
| **Statut du praticien inchangé** (« certifié ») | R-CER-09 n'a pas de statut « expiré » ; il retrouve l'annuaire dès son nouveau certificat | Passage à « en attente » |
| **Une seule invitation par certificat**, le 60e jour avant l'échéance à partir de 8 h (colonne `relance_renouvellement_le`), rattrapée tant que le certificat est actif ; aucune si un dossier de renouvellement est déjà en cours ou si le certificat est révoqué | Pas de SMS la nuit ni en double ; coût SMS maîtrisé | Relances répétées (J-30, J-7) : à décider avec le renouvellement |
| **SMS `certificat.renouvellement`** : « SABOU : votre certificat SAB-… expire le JJ/MM/AAAA. Renouvelez-le dans votre espace SABOU pour rester dans l'annuaire. » (un SMS GSM 7 bits) | Numéro et échéance figés à la mise en file | — |
| **L'ouverture du dossier de renouvellement** (R-QR-07, contenu proportionné) reste à son récit (sprint 14) | Le critère de US-049 est l'invitation ; d'ici là, aucune donnée réelle | — |
| **Une erreur sur les échéances est journalisée sans retenir les SMS** déjà en file | L'envoi des décisions ne dépend pas de cette tâche | — |

**Contrôles du pipeline** : `packages/db/test/echeance-certificats.test.ts` (critère 1 : dernier jour valable, expiration le lendemain, sortie de l'annuaire, QR ambre, journal unique, autres certificats intacts, révoqué intact ; critère 2 : rien à J-61 ni avant 8 h, un seul SMS au praticien, rattrapage, pas de relance si renouvellement en cours ou certificat révoqué, droits) ; `apps/api/src/sms/sms.test.ts` (texte, erreurs définitives, ordre échéances puis relève, erreur isolée) ; `packages/db/test/zones.test.ts` (liste des fonctions SECURITY DEFINER).

## 3. Architecture

```
  Visiteurs / citoyens          Administrateurs (5 profils)        Praticiens / agents de terrain
          │                                │                                   │
  Site public Next.js (PWA)     Application de gestion React        Application Flutter
  pages en cache, audio hors     (fichiers statiques)               SQLite local + PowerSync
  réseau                                   │                                   │
          └────────────── Traefik (TLS 1.3, cache) ──────────────┬─────────────┘
                                   │                             │
                         Keycloak (identité, MFA,          PowerSync (synchro)
                         OAuth2 partenaires)                     │
                                   │                             │
                          API NestJS (monolithe modulaire, OpenAPI)
                 ┌───────────┬──────────┼───────────┬──────────────┬──────────────┐
          PostgreSQL 17   pg-boss    Valkey     SeaweedFS       Vault/OpenBao    Services externes
          + PostGIS, RLS  (tâches)   (cache)    (audio, images) (clé de la DG)   SMS, e-mail, Mobile Money,
          (CloudNativePG)                                                          DHIS2
```

---

## 4. Points à valider par prototype (phase 1, cadrage)

1. **PowerSync auto-hébergé** : synchronisation hors ligne d'un dossier avec pièces et voix, puis conflit.
2. **Chaîne audio** : enregistrement sur un Android d'entrée de gamme, réduction de bruit, Opus 24 kbit/s, écoute en 3G simulée.
3. **QR COSE/Base45** : génération, lecture et vérification hors ligne sur un téléphone d'entrée de gamme.
4. **Hébergeur souverain** : disponibilité de 3 serveurs, stockage, sauvegarde hors site.
5. **DHIS2** : existence d'une instance nationale et format des indicateurs attendus par le ministère.

## 5. Ordre de réalisation (phases du CdC §11.2)

1. Cadrage : validation de 00, 04 et 05 ; prototypes ci-dessus ; test des scripts SQL v2.
2. Socle : Keycloak, rôles et zones (RLS), journal d'audit, workflow de certification.
3. Application de gestion et application mobile (Studio SABOU, numérisation, atelier linguistique).
4. Site public.
5. Services : boutique, abonnements, Mobile Money, API partenaires, DHIS2, exports.
6. Recette, audit de sécurité, pilote en Haute Guinée (malinké), puis généralisation.
