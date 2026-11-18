# SABOU — Règles métier (version 2, analyse)

Source de vérité : le **cahier des charges v1.3** (novembre 2026), qui intègre toutes les corrections ci-dessous. Ce document traduit le cahier des charges en règles numérotées, trace les incohérences corrigées par rapport à la v1.2, et détaille les points que le cahier des charges laisse ouverts « selon les règles de l'art ».

Statut : **analyse**. Les scripts SQL `01` à `03` (version 2) traduisent ces règles en contraintes, triggers et fonctions ; ils n'ont pas encore été exécutés.

Légende : **[CdC §x]** = règle reprise du cahier des charges · **[Correction]** = incohérence corrigée · **[Art]** = complément selon les règles de l'art · **[Tranché]** = décision prise en 2026-11 selon les bonnes pratiques et les réalités de la Guinée (voir la fin du document).

---

## 1. Langues

| N° | Règle | Origine |
|---|---|---|
| R-LNG-01 | Langues gérées : français, anglais, soussou, malinké, pular, guerzé. Ajouter une langue = une ligne de paramétrage, sans modifier le code. | [CdC §2.1, §8] |
| R-LNG-02 | **Aucun texte écrit en langue nationale.** Tout le contenu écrit est en français ; les libellés (« Nom en malinké », « Préparation »…) sont en français. | [Correction] décision du maître d'ouvrage |
| R-LNG-03 | Les langues nationales existent **uniquement en voix** : nom de la plante, nom de la maladie, préparation, consommation, cycle, effets indésirables. | [CdC §2.1] + R-LNG-02 |
| R-LNG-04 | La voix existe en **français + les quatre langues nationales** (5 voix). L'anglais n'a pas de voix. | [CdC §1.2, §2.1] |
| R-LNG-05 | L'anglais couvre **l'interface et les textes** : chaque texte français peut avoir sa version anglaise ; à défaut, le français est affiché. | [CdC §2.6] |
| R-LNG-06 | Chaque langue porte deux indicateurs : *texte* (fr, en) et *voix* (fr, sou, mal, pul, gue). Une voix ne peut être enregistrée que dans une langue « voix ». | [Art] |
| R-LNG-07 | Chaque région naturelle a une langue par défaut : Basse Guinée → soussou, Moyenne Guinée → pular, Haute Guinée → malinké, Guinée Forestière → guerzé. **Conakry est rattachée à la Basse Guinée (soussou)**, l'utilisateur pouvant toujours changer de langue. | [CdC §2.2] **[Tranché]** |
| R-LNG-08 | À la première visite, la langue de la région est proposée ; le choix est mémorisé et modifiable à tout moment. | [CdC §2.6] |
| R-LNG-09 | Si la voix d'une section n'existe pas dans la langue choisie : lecture de la voix française et message « traduction en cours ». | [CdC §2.6] |
| R-LNG-10 | Chaque ressource vocale suit quatre statuts **par langue et par section** : Brouillon → Traduit → Validé → Publié. Une recette peut être publiée en malinké avant le pular. | [CdC §2.8] |
| R-LNG-11 | Une voix n'est publiée que si le **consentement** du praticien (enregistrement et niveau de visibilité) est enregistré. | [CdC §2.10] |
| R-LNG-12 | La voix de la section *effets indésirables et contre-indications* n'est publiée qu'après **contrôle du Comité scientifique dans cette langue**. | [CdC §2.8, §6.5] [Correction] : absent du schéma v1 |
| R-LNG-13 | Recherche par nom local : la personne **dit** le nom (enregistrement vocal) ou l'écrit. Comme aucun nom n'est écrit en langue nationale (R-LNG-02), on conserve des **transcriptions de recherche** en alphabet latin, plusieurs orthographes possibles par nom, jamais affichées comme contenu. Le parcours principal reste la voix : la personne écoute les noms et reconnaît la plante. | [CdC §2.7] concilié avec R-LNG-02 **[Tranché]** |

## 2. Gouvernance linguistique (qui fait quoi)

| N° | Règle | Origine |
|---|---|---|
| R-GOV-01 | Le **tradipraticien** enregistre la voix de son traitement dans sa langue, pour chaque plante et chaque section. | [CdC §2.8] |
| R-GOV-02 | L'**Admin préfectoral** résume les recettes en français (écrit) et enregistre la voix en langue locale ; il peut aussi enregistrer la voix pour le praticien (numérisation). | [CdC §2.8, §3.2, §6.4] + R-LNG-02 |
| R-GOV-03 | L'**Admin régional** valide les voix de la langue de sa région (atelier linguistique) : écoute, comparaison avec le texte français, validation ou renvoi motivé. | [CdC §2.8, §6.3] |
| R-GOV-04 | Le **Comité scientifique** vérifie la plante et la fidélité des effets indésirables dans chaque langue (R-LNG-12). | [CdC §2.8] |
| R-GOV-05 | La **Direction Générale** publie les ressources validées et suit la couverture par langue. | [CdC §2.8] |
| R-GOV-06 | Un compte ne peut enregistrer, traduire ou valider que dans les langues qui lui sont attribuées. | [Art] |
| R-GOV-07 | Le traducteur et le valideur d'une même ressource sont deux personnes différentes. | [Art] séparation des tâches |

## 3. Plantes (Dictionnaire Impérial)

| N° | Règle | Origine |
|---|---|---|
| R-PLA-01 | Une plante = une fiche = un identifiant (PL-001), commun à toutes les langues. | [CdC §2.1, §2.3] |
| R-PLA-02 | Fiche : nom scientifique (unique, affiché en italique), famille, nom français, nom anglais (facultatif), **voix du nom** dans chaque langue nationale et en français, images, maladies liées, recettes, praticiens. | [CdC §2.3, §7] + R-LNG-02 |
| R-PLA-03 | Une plante peut avoir **plusieurs noms locaux** (synonymes), chacun avec sa voix ; un nom principal par langue. | [CdC §1.2 « reconnue sous tous ses noms »] [Correction] |
| R-PLA-04 | Au moins une photo principale par plante (une seule principale) ; texte alternatif obligatoire ; illustration par défaut si aucune image. | [CdC §2.4, §5.3] |
| R-PLA-05 | Statuts : En revue → Validée. Seul le Comité scientifique valide une fiche plante. | [CdC §6.5, §7] |
| R-PLA-06 | Une plante « En revue » ne peut pas entrer dans une recette certifiée. | [Art] |

## 4. Maladies

| N° | Règle | Origine |
|---|---|---|
| R-MAL-01 | Une fiche par maladie (MA-001) : nom français, nom anglais, **dénominations** (synonymes), **symptômes** (texte français/anglais), voix du nom dans chaque langue, plantes recommandées, traitements certifiés. | [CdC §2.4, §5.2, §7] [Correction] : schéma v1 limité à un code |
| R-MAL-02 | Les voix des noms de maladies suivent le même circuit que les plantes (Brouillon → Publié, validation régionale). | [Correction] question ouverte v1 tranchée par analogie |
| R-MAL-03 | Une maladie peut être soignée par plusieurs traitements. | [CdC §2.4] |

## 5. Traitements (recettes)

| N° | Règle | Origine |
|---|---|---|
| R-REC-01 | Un traitement = **une** maladie + **1 à n** plantes ordonnées (avec la partie utilisée) + un cycle + des sections. | [CdC §2.4] |
| R-REC-02 | **Sections** : 4 obligatoires — préparation, consommation, cycle de traitement, effets indésirables et contre-indications — et 1 facultative : **conservation**. | [Correction] §2.4/§2.5 (4 sections) concilié avec §7 (conservation) |
| R-REC-03 | Chaque section a un texte français (obligatoire), un texte anglais (facultatif) et une voix par langue. | R-LNG-02 à 05 |
| R-REC-04 | **Cycle** : durée en jours, prises par jour, **pause en jours** (colonnes du traitement) ; conditions de reprise décrites dans la section *cycle* (texte + voix). | [CdC §2.4, §7] [Correction] : pause absente du schéma v1 |
| R-REC-05 | Contre-indications **structurées** en plus du texte : grossesse, allaitement, enfant de moins de 5 ans, personne âgée, maladie chronique (liste paramétrable). Elles s'affichent en alerte sur la page traitement. | [Art] sécurité des patients |
| R-REC-06 | Un traitement ne peut pas être certifié sans au moins une plante validée, sans les 4 sections obligatoires, sans cycle. | [CdC §2.4, §2.5] |
| R-REC-07 | **Circuit d'un traitement** : Brouillon → Soumis (praticien) → Transmis au Comité (Admin régional) → Expertisé (Comité) → Certifié (Direction Générale) ; Retiré possible à tout moment après certification. Un rejet renvoie à l'étape précédente avec motif obligatoire. | [CdC §6.2, §6.3, §6.5] [Art] : lien recette/certification absent du CdC |
| R-REC-08 | Seul un praticien **certifié, avec certificat actif**, peut avoir un traitement certifié. Les recettes jointes au dossier de certification sont expertisées à l'étape 4 et certifiées à la publication du dossier (étape 6) ; les recettes créées après suivent le circuit R-REC-07. | [Art] |
| R-REC-09 | Le badge « Certifiée » n'apparaît qu'après approbation de la Direction Générale. | [CdC §5.2] |
| R-REC-10 | **Visibilité** (choisie par le praticien) : *publique* (site public), *restreinte* (utilisateurs connectés), *privée* (praticien et administrateurs). | [CdC §2.10, §8] [Art] : valeurs non définies dans le CdC |
| R-REC-11 | Formule gratuite : **3 traitements certifiés** au maximum ; GOLD et Institution : illimité. À l'expiration d'un GOLD : **délai de grâce de 30 jours** ; ensuite, les traitements déjà certifiés **restent publiés** (savoir validé, utile au public), mais aucun nouveau traitement n'est certifié au-delà de 3, et la boutique et la visibilité renforcée sont suspendues jusqu'au renouvellement. | [CdC §9.1] **[Tranché]** |
| R-REC-12 | Retrait d'un traitement = changement de statut, jamais suppression (historique conservé). | [Art] |
| R-REC-13 | La mention « SABOU informe, ne prescrit pas » figure sur chaque page traitement, plante et maladie. | [CdC §2.5, §5.2] |
| R-REC-14 | Durée cible de 90 s par voix de section ; lecture à vitesse réglable ; transcription française affichée sous le lecteur ; téléchargement pour écoute hors réseau. | [CdC §2.10, §2.5] |

## 6. Recherche

| N° | Règle | Origine |
|---|---|---|
| R-RCH-01 | Recherche de maladie par nom, dans toutes les langues écrites (français, anglais, dénominations, transcriptions), sans accents et tolérante aux fautes. | [CdC §2.4] + R-LNG-13 |
| R-RCH-02 | Résultat : la fiche de la maladie (nom + voix), puis une carte par traitement : photos et noms de **toutes** les plantes, durée du cycle, note moyenne. | [CdC §2.4, §11.3] |
| R-RCH-03 | Filtres : langue, région, nombre de plantes, note. Seuls les traitements certifiés et visibles pour l'utilisateur apparaissent. | [CdC §5.2] + R-REC-10 |
| R-RCH-04 | Accès : la recherche de maladie est la barre de recherche de l'accueil, de la page Recettes et du Dictionnaire (pas d'entrée de menu dédiée, le header étant limité à 7 entrées). | [Correction] page absente du menu |

## 7. Praticiens et certification

| N° | Règle | Origine |
|---|---|---|
| R-CER-01 | Six étapes, dans l'ordre, **aucune ne peut être sautée** : 1 Soumission (praticien) · 2 Vérification terrain (Admin préfectoral) · 3 Consolidation (Admin régional) · 4 Expertise (Comité) · 5 Approbation (DG) · 6 Publication (automatique). | [CdC §4] |
| R-CER-02 | Seul le responsable de l'étape, **dans sa zone**, peut décider : le préfectoral de la préfecture du praticien, le régional de sa région. | [CdC §3.1, §4] |
| R-CER-03 | Un **rejet renvoie à l'étape précédente** avec un motif obligatoire (au rejet de l'étape 2, le dossier revient au praticien). | [CdC §4] [Correction] : statut « rejeté » définitif dans le schéma v1 |
| R-CER-04 | **Rejet définitif** (praticien « Rejeté ») : réservé à la Direction Générale, motif obligatoire limité à la fraude documentaire, l'usurpation d'identité ou une pratique dangereuse avérée (après avis du Comité). Le praticien dispose d'un **recours de 30 jours** (litige) ; un nouveau dossier n'est possible qu'**après 12 mois**. | [Correction] : le statut « Rejeté » existe au §7 sans règle d'usage **[Tranché]** |
| R-CER-05 | Chaque transition est horodatée, signée par son auteur, consultable, et notifiée au praticien (e-mail et SMS). | [CdC §4, §8, §9] |
| R-CER-06 | Pièces du dossier : identité, justificatifs, photo, recettes vocales ; l'étape 2 exige un **compte rendu de visite signé**. | [CdC §4, §6.4] [Correction] : pièces et visites absentes du schéma v1 |
| R-CER-07 | Délai cible : 3 jours par étape ; un dossier sans décision depuis plus de 15 jours est signalé « bloqué » (indicateur calculé, pas un statut). | [CdC §4] |
| R-CER-08 | Seuls les praticiens Certifiés **avec un certificat actif** sont visibles dans l'annuaire public. | [CdC §5.2] [Art] |
| R-CER-09 | Statuts du praticien : En attente, Certifié, Rejeté, Suspendu. Spécialités (8, paramétrables par la DG) : phytothérapie, pédiatrie, os et fractures, nutrition, gynécologie et santé maternelle, **santé mentale**, **maladies de la peau**, **morsures et envenimations**. | [CdC §7] **[Tranché]** : pratiques traditionnelles très présentes en Guinée |

## 8. Certificat et QR Code

| N° | Règle | Origine |
|---|---|---|
| R-QR-01 | Le certificat est émis à l'étape 5 par la DG, **valable 12 mois**, un seul certificat actif par praticien. | [CdC §4] |
| R-QR-02 | Empreinte **SHA3-256** des données du certificat (numéro, praticien, dates, autorité). | [CdC §9] |
| R-QR-03 | Le QR contient les données + l'empreinte + une **signature numérique Ed25519** faite avec la clé privée de la DG. La clé publique est publiée sur le site ; la vérification hors ligne contrôle la signature. | [Art] : une empreinte SHA-3 seule peut être recalculée par n'importe qui, donc elle ne prouve rien hors ligne |
| R-QR-04 | Clés de signature avec rotation ; chaque certificat mémorise l'identifiant de la clé utilisée ; une clé compromise est révoquée. | [Art] |
| R-QR-05 | Verdict : **vert** authentique et actif · **ambre** expiré · **rouge** inconnu, signature invalide ou révoqué. Réponse en moins de 5 secondes. | [CdC §5.2, §11.3] |
| R-QR-06 | Suspension ou rejet définitif d'un praticien ⇒ révocation de son certificat (motif et date). | [Art] |
| R-QR-07 | **Renouvellement** : dossier de type « renouvellement », ouvert 60 jours avant l'expiration, qui passe par les **6 étapes** (aucune sautée) avec un contenu proportionné : étape 1 préremplie ; étape 2 contrôle documentaire, **visite sur place seulement** si la dernière visite date de plus de 3 ans, en cas de signalement, de litige ou de changement de lieu, ou par tirage au sort (20 %) ; étape 4 limitée aux recettes nouvelles ou modifiées et aux signalements ; étape 5 signature par lots. À l'émission du nouveau certificat, l'ancien passe à « expiré ». | [CdC §4, §6.6] **[Tranché]** : 15 000 renouvellements par an pour 33 admins préfectoraux rendent une visite systématique impossible |

## 9. Témoignages

| N° | Règle | Origine |
|---|---|---|
| R-TEM-01 | Réservés aux utilisateurs inscrits (compte citoyen gratuit) : note de 1 à 5, texte, voix facultative dans sa langue. | [CdC §2.9] |
| R-TEM-02 | Un témoignage par utilisateur et par traitement. Le praticien concerné est déduit du traitement. | [CdC §2.9] [Correction] : le CdC §7 parle d'avis sur le praticien |
| R-TEM-03 | Publication après modération par l'Admin préfectoral (de la zone du praticien) ou la DG. | [CdC §2.9, §3.2] |
| R-TEM-04 | Modifié par son auteur ⇒ repasse en modération. Retiré par son auteur ⇒ statut Retiré. Signalé ⇒ repasse en modération. | [CdC §2.9] |
| R-TEM-05 | Le praticien peut publier **une réponse** à un témoignage (soumise aux mêmes règles de modération). | [CdC §6.6] [Correction] |
| R-TEM-06 | Affichage : prénom + initiale du nom uniquement ; aucune donnée de santé nominative publique. | [CdC §2.9] |
| R-TEM-07 | Notes moyennes du traitement et du praticien recalculées à chaque publication, modification ou retrait. | [CdC §2.9] |

## 10. Demande de plante (parcours « je ne connais pas le nom en français »)

| N° | Règle | Origine |
|---|---|---|
| R-DEM-01 | Faite par un **utilisateur inscrit** (compte citoyen), ce qui permet « Suivre ma demande ». | [CdC §3, §5.2] [Correction] : pas de demandeur dans le schéma v1 |
| R-DEM-02 | Contenu : nom local **dit** (enregistrement vocal) et/ou écrit (transcription), langue, préfecture. | [CdC §2.7, §5.2] |
| R-DEM-03 | La demande est envoyée au tradipraticien certifié le plus proche (même préfecture, sinon même région), qui confirme la plante. | [CdC §2.7] |
| R-DEM-04 | Statuts : Reçue → À envoyer → Envoyée ; Annulée. Le praticien envoie la plante et la fiche vocale. | [CdC §6.6, §7] |
| R-DEM-05 | Le contact du demandeur n'est visible que du praticien destinataire. | [Art] protection des données |

## 11. Sécurité sanitaire

| N° | Règle | Origine |
|---|---|---|
| R-SAN-01 | Bouton « **Signaler un danger** » sur chaque page traitement et plante ; ouvert à tous, compte facultatif. | [CdC §2.5] [Correction] : absent du schéma v1 |
| R-SAN-02 | **Pharmacovigilance** : déclaration d'effets indésirables (traitement, description, gravité). | [CdC §6.5] [Correction] |
| R-SAN-03 | Tout signalement est routé vers le Comité scientifique, traité sous **24 h** pour un danger grave ; le Comité peut **suspendre** provisoirement un traitement. Décision motivée et tracée. | [Art] délai et suspension |
| R-SAN-04 | Les questions de toxicité du forum sont routées automatiquement vers le Comité. | [CdC §5.2, §6.5] |
| R-SAN-05 | Validation du dispositif par la tutelle (ministère de la Santé) avant mise en production. | [Art] |

## 12. Forum

| N° | Règle | Origine |
|---|---|---|
| R-FOR-01 | Lecture libre ; écriture réservée aux comptes. Catégories : certification, témoignages, phytothérapie, formation, comité. | [CdC §3, §5.2] |
| R-FOR-02 | Une discussion peut être nationale, régionale ou préfectorale ; la modération suit la zone : préfectoral (local), régional (région), Comité (questions scientifiques), DG (national). | [CdC §3.2, §6] |
| R-FOR-03 | Signalement traité sous **48 h** (date de signalement, de traitement, modérateur). | [CdC §5.2] |
| R-FOR-04 | Statuts : Actif, Épinglé, Résolu, À surveiller. Rôle de l'auteur affiché dans le fil. | [CdC §5.2, §7] |

## 13. Comptes, rôles et accès

| N° | Règle | Origine |
|---|---|---|
| R-ACC-01 | Rôles : Direction Générale (1), Admin régional (8), Admin préfectoral (33), Comité scientifique (7), Tradipraticien (15 000), Citoyen ; Visiteur sans compte. | [CdC §3] |
| R-ACC-02 | Une zone par compte : national, région, préfecture ou individuel ; chaque compte ne voit que les données de sa zone. | [CdC §3.1] |
| R-ACC-03 | Double facteur obligatoire pour tous les administrateurs (DG, régional, préfectoral, Comité). | [CdC §3.1] |
| R-ACC-04 | Moindre privilège : chaque action n'est permise qu'au rôle prévu par la matrice §3.2 du cahier des charges. La matrice se **consulte** (page Comptes, onglet « Rôles et droits ») et ne se modifie pas dans l'application : les rôles sont fixes. Elle est complétée par les précisions des règles métier, chacune avec sa source (expertise d'un dossier à l'étape 4, circuit d'un traitement, fiches plantes, annotations du Comité). | [CdC §3.2] [Précision 17/11/2026, US-012b] : « matrice des permissions » du menu Utilisateurs & rôles entendue en consultation |
| R-ACC-05 | Suspension en un clic par la DG ; toute connexion et toute décision sont journalisées. | [CdC §3.1] |
| R-ACC-07 | Téléphone **obligatoire** pour les quatre profils de gestion (DG, régional, préfectoral, Comité) : mobile guinéen, forme +224, pour les alertes et notifications par SMS du §9 ; il n'est jamais identifiant de connexion (l'adresse e-mail l'est). | [CdC fiche U-001, §9] [Décision MOE 17/11/2026, demande #61] |
| R-ACC-06 | Un praticien est rattaché à un compte et à une préfecture (sous-préfecture facultative, pour les statistiques locales). | [CdC §6.4] [Correction] : sous-préfecture absente |

## 14. Site public piloté

| N° | Règle | Origine |
|---|---|---|
| R-SIT-01 | Header : **7 entrées maximum** — Accueil, Annuaire, Dictionnaire Impérial, Recettes, Forum, Témoignages, Vérifier un certificat — et le bouton Connexion toujours visible. | [CdC §5.1] [Correction] : le seed v1 remplaçait « Vérifier » par « Maladies » |
| R-SIT-02 | Pied de page, colonne Institution : À propos, Le concept Yeleen Kènè, Devenir partenaire, Mentions légales. | [CdC §5.1] |
| R-SIT-03 | Menus et sliders modifiables par la DG seule : libellé (français + anglais), chemin, emplacement, ordre, visibilité ; aperçu avant publication ; **historique des publications**. | [CdC §6.7] [Correction] : historique absent |
| R-SIT-04 | Trois sliders, défilement toutes les 6 s, pause au survol, texte alternatif obligatoire, contraste AA. | [CdC §5.3] |
| R-SIT-05 | Demande de plante accessible depuis la fiche plante du Dictionnaire et depuis une porte d'entrée de l'accueil. | [Correction] page absente du menu |

## 15. Modules complémentaires (présents au CdC, absents du schéma v1)

| N° | Module | Règle | Origine |
|---|---|---|---|
| R-MOD-01 | **Litiges** | Ouverts par une préfecture ou un praticien ; pièces, échanges, décision motivée de l'Admin régional ; statuts Ouvert, En arbitrage, Résolu. | [CdC §6.3, §7] |
| R-MOD-02 | **Visites terrain** | Agenda du préfectoral : date prévue, rappel au praticien, date réalisée, compte rendu signé. | [CdC §6.4] |
| R-MOD-03 | **Alertes territoriales** | Hausse de pathologie, désert thérapeutique, dossier bloqué ; accusé de réception et relance par l'Admin régional. | [CdC §6.3] |
| R-MOD-04 | **Notifications** | E-mail et SMS à chaque transition, décision et alerte ; historique d'envoi. | [CdC §9] |
| R-MOD-05 | **Boutique** | Produits conditionnés (prix GNF, stock), **validation scientifique avant publication**, statuts Brouillon / Publié / Rupture ; commission SABOU 10 %. | [CdC §6.6, §9] |
| R-MOD-06 | **Paiements** | Orange Money et MTN MoMo pour GOLD et la boutique ; chaque paiement est tracé (référence opérateur, statut). | [CdC §9] |
| R-MOD-07 | **Partenaires et API** | Partenaire, clés en rotation, quota, limite 100 requêtes/min/IP, données anonymisées uniquement. | [CdC §6.2, §9] |
| R-MOD-08 | **Formation continue** | Modules (hygiène et conservation, botanique appliquée, gestion et éthique) et attestations. | [CdC §6.6] |
| R-MOD-09 | **Rapports et exports** | PDF, XLSX, CSV, JSON ; historique des exports ; rapport mensuel préfectoral → régional → DG. | [CdC §6, §9] |
| R-MOD-10 | **Annotations du Comité** | Annotation botanique et avis motivé sur chaque recette et fiche plante. | [CdC §4, §6.5] |

## 16. Données et traçabilité

| N° | Règle | Origine |
|---|---|---|
| R-DON-01 | Aucun nom complet de patient ; données épidémiologiques anonymisées (agrégats par préfecture, jamais par personne). | [CdC §8] |
| R-DON-02 | Journal d'audit de toutes les décisions et connexions, non modifiable par l'application. | [CdC §8] |
| R-DON-03 | Fichiers audio et images hors base, en stockage souverain, avec empreinte d'intégrité. | [CdC §8] |
| R-DON-04 | Saisie hors réseau pour les agents de terrain, synchronisée au retour de la connexion. Conflits (règle validée le 3 novembre 2026) : 1) le conflit se règle au niveau du **dossier entier**, jamais champ par champ, sans fusion automatique ; 2) si la version du serveur est **validée**, elle prime : la saisie de l'agent devient une copie en brouillon rattachée au dossier, visible par l'agent ; 3) si la version du serveur n'est **pas validée** (deux brouillons), la dernière modification **dans l'ordre d'arrivée sur le serveur** l'emporte (jamais l'heure du téléphone) ; l'autre est gardée dans l'historique ; 4) dans les cas 2 et 3, l'agent dont la version n'a pas été retenue en est informé à la synchronisation suivante. | [CdC §8] [Art] règle de conflit, précisée par le maître d'œuvre (US-004) |

---

## Décisions tranchées (novembre 2026)

Principe : bonnes pratiques reconnues et réalités de la Guinée (faible alphabétisation dans les langues nationales, réseau mobile irrégulier, paiements Mobile Money parfois décalés, effectifs administratifs limités).

| # | Sujet | Décision | Raison |
|---|---|---|---|
| 1 | Nom local écrit (R-LNG-13) | Transcriptions en alphabet latin, plusieurs orthographes, **pour la recherche uniquement** ; la voix reste le parcours principal | Peu de personnes écrivent les langues nationales selon une orthographe officielle ; sur téléphone, elles tapent le nom « comme il se prononce » |
| 2 | Conakry (R-LNG-07) | Basse Guinée, langue par défaut **soussou** | Situation géographique et langue véhiculaire de la capitale ; changement de langue toujours possible |
| 3 | Fin d'un GOLD (R-REC-11) | Grâce de 30 jours, puis traitements déjà certifiés maintenus ; plus de nouvelle certification au-delà de 3 ; boutique suspendue | Ne pas priver le public d'un savoir validé ; tenir compte des retards de paiement |
| 4 | Rejet définitif (R-CER-04) | DG seule, motifs limités, recours de 30 jours, nouveau dossier après 12 mois | Décision grave : autorité la plus haute, motif encadré, droit de recours |
| 5 | Spécialités (R-CER-09) | + santé mentale, maladies de la peau, morsures et envenimations | Domaines où la médecine traditionnelle est très sollicitée en Guinée ; liste paramétrable |
| 6 | Renouvellement (R-QR-07) | 6 étapes conservées, contenu proportionné (visite selon le risque, expertise des seules nouveautés, signature par lots) | Respecte « aucune étape sautée » tout en restant faisable : environ 450 renouvellements par préfecture et par an |
