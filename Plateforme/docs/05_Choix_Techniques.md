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
| **Kysely** (SQL typé) + migrations SQL versionnées (**Atlas** ou dbmate) | Le schéma est « SQL d'abord » (triggers, fonctions, RLS) : on écrit le SQL, on garde le typage | ORM (Prisma, TypeORM) : masque le SQL, gère mal triggers, RLS et fonctions |

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
| **Opus mono 24 kbit/s** | Format conçu pour la parole : une section de 90 s pèse environ 270 Ko, contre plus d'1 Mo en MP3 de qualité équivalente (E1, E2) |
| **FFmpeg** côté serveur : réduction de bruit (filtre RNNoise `arnndn`), normalisation du volume (`loudnorm`), conversion Opus | Qualité homogène quel que soit le téléphone ; durée et empreinte calculées automatiquement |
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
| **Flutter hors de Turborepo** | Pas d'application mobile avant US-004 ; ensuite un job séparé, déclenché seulement par les changements dans `apps/mobile/`, pour économiser les minutes d'intégration continue | — |

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
