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

1. **Conception et développement sans données réelles : GitHub** (dépôt privé `sansysparta-alt/sabou-plateforme`). Gratuit, sans serveur à exploiter ; aucune donnée de praticien, de patient ni de voix n'y transite, donc E7 n'est pas encore en jeu. Les pipelines des récits US-001 et US-007 tournent sur GitHub Actions et ne déploient que la recette avec des données fictives.
2. **Dès que l'hébergeur souverain est disponible (avant S3) et avant toute donnée réelle : GitLab auto-hébergé**, installé sur cette infrastructure. Le dépôt y est poussé avec tout son historique, le pipeline est porté sur GitLab CI et le backlog importé (récit US-008). GitLab devient la seule référence ; GitHub passe en miroir en lecture seule ou est archivé.

Pour faciliter la bascule, la logique du pipeline (lint, tests, compilation, déploiement) vit dans des scripts du dépôt ; les fichiers propres à GitHub Actions se contentent de les appeler. Aucun secret de production n'est jamais stocké sur GitHub.

**Décision (novembre 2026) : pas de GitHub Pro, fusion bloquée par convention jusqu'à US-008.** Le dépôt reste privé sur un compte gratuit, qui n'autorise ni protection de branche ni règles de fusion. Jusqu'à US-008, toute modification passe par une branche de récit et une demande de fusion, et le maître d'œuvre ne fusionne que si le pipeline est vert. Le blocage automatique sera configuré sur GitLab, où il est disponible sans frais (critère reporté de US-001 à US-008).

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

---

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
