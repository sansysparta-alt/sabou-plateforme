-- =====================================================================
-- SABOU — Jeu de données d'exemple (base migrée et vide) : pnpm db:seed, et les tests
-- Données entièrement fictives. Jamais chargé en recette ni en production.
-- Les identifiants IDENTITY démarrent à 1 : les clés étrangères ci-dessous en dépendent.
-- Règle des langues : aucun texte en langue nationale ; les langues nationales sont des VOIX.
-- Les transcriptions de noms locaux (plante_nom_local) servent uniquement à la recherche (R-LNG-13, à confirmer)
-- et sont des exemples de maquette, à valider par les référents linguistiques.
-- Les empreintes et signatures ci-dessous sont factices (calculées par l'application en production).
-- =====================================================================
SET search_path = sabou, public;
BEGIN;

-- ---------- Référentiel ----------
INSERT INTO langue (code, iso639_3, nom_fr, type, texte, voix, ordre) VALUES
 ('fr', 'fra', 'Français', 'officielle',     true,  true,  1),
 ('en', 'eng', 'Anglais',  'internationale', true,  false, 2),
 ('sou','sus', 'Soussou',  'nationale',      false, true,  3),
 ('mal','emk', 'Malinké',  'nationale',      false, true,  4),
 ('pul','fuf', 'Pular',    'nationale',      false, true,  5),
 ('gue','gkp', 'Guerzé',   'nationale',      false, true,  6);

INSERT INTO region_naturelle (code, nom, langue_defaut_code) VALUES
 ('BG','Basse Guinée','sou'), ('MG','Moyenne Guinée','pul'), ('HG','Haute Guinée','mal'), ('GF','Guinée Forestière','gue');
INSERT INTO region_admin (nom, region_naturelle_id) VALUES
 ('Boké',1),('Conakry',1),('Kindia',1),('Labé',2),('Mamou',2),('Faranah',3),('Kankan',3),('N''Zérékoré',4);
INSERT INTO prefecture (nom, region_admin_id) VALUES
 ('Boké',1),('Conakry',2),('Kindia',3),('Labé',4),('Mamou',5),('Faranah',6),('Kankan',7),('N''Zérékoré',8),('Siguiri',7),('Coyah',3);
INSERT INTO sous_prefecture (nom, prefecture_id) VALUES
 ('Popodara',4),('Hafia',4),('Balandougou',7),('Kintinian',9);

INSERT INTO role (code, libelle_fr, libelle_en) VALUES
 ('dg','Direction Générale','General Directorate'),('regional','Admin Régional','Regional Admin'),
 ('prefectoral','Admin Préfectoral','Prefectoral Admin'),('scientifique','Comité Scientifique','Scientific Committee'),
 ('praticien','Tradipraticien','Traditional healer'),('citoyen','Citoyen','Citizen');

-- ---------- Comptes ----------
-- keycloak_id fictif et stable : aucun de ces comptes n'existe dans Keycloak
INSERT INTO utilisateur (email, telephone, prenom, nom, role_code, region_admin_id, prefecture_id,
                         langue_interface, langue_ecoute, keycloak_id) VALUES
 ('dg@sabou-sante.gn',                 '+224620000001','Mohamed','Camara',   'dg',          NULL,NULL,'fr','fr', md5('sabou:dg@sabou-sante.gn')::uuid),  -- 1
 ('regional.kindia@sabou-sante.gn',    '+224620000002','Fatoumata','Bangoura','regional',    3,   NULL,'fr','sou',md5('sabou:regional.kindia@sabou-sante.gn')::uuid),  -- 2
 ('prefectoral.labe@sabou-sante.gn',   '+224620000003','Ibrahima','Sow',     'prefectoral', NULL,4,   'fr','pul',md5('sabou:prefectoral.labe@sabou-sante.gn')::uuid),  -- 3
 ('comite@sabou-sante.gn',             '+224620000004','Aboubacar','Diakité','scientifique',NULL,NULL,'fr','fr', md5('sabou:comite@sabou-sante.gn')::uuid),  -- 4
 ('prefectoral.kankan@sabou-sante.gn', '+224620000005','Mohamed','Condé',    'prefectoral', NULL,7,   'fr','mal',md5('sabou:prefectoral.kankan@sabou-sante.gn')::uuid),  -- 5
 ('s.kourouma@exemple.gn',             '+224620000006','Sékou','Kourouma',   'praticien',   NULL,NULL,'fr','pul',md5('sabou:s.kourouma@exemple.gn')::uuid),                 -- 6
 ('m.diallo@exemple.gn',               '+224620000007','Mamadou','Diallo',   'praticien',   NULL,NULL,'fr','pul',md5('sabou:m.diallo@exemple.gn')::uuid),                 -- 7
 ('a.traore@exemple.gn',               '+224620000008','Aïssatou','Traoré',  'praticien',   NULL,NULL,'fr','mal',md5('sabou:a.traore@exemple.gn')::uuid),                 -- 8
 ('f.camara@exemple.gn',               '+224620000009','Fatoumata','Camara', 'praticien',   NULL,NULL,'fr','sou',md5('sabou:f.camara@exemple.gn')::uuid),                 -- 9
 ('i.bah@exemple.gn',                  '+224620000010','Ibrahima','Bah',     'praticien',   NULL,NULL,'fr','pul',md5('sabou:i.bah@exemple.gn')::uuid),                 -- 10
 ('aminata@exemple.gn',                NULL,           'Aminata','Diallo',   'citoyen',     NULL,NULL,'fr','mal',md5('sabou:aminata@exemple.gn')::uuid),                 -- 11
 ('kadiatou@exemple.gn',               NULL,           'Kadiatou','Barry',   'citoyen',     NULL,NULL,'fr','pul',md5('sabou:kadiatou@exemple.gn')::uuid),                 -- 12
 ('sory@exemple.gn',                   NULL,           'Sory','Keita',       'citoyen',     NULL,NULL,'fr','sou',md5('sabou:sory@exemple.gn')::uuid),                 -- 13
 ('mariam@exemple.gn',                 NULL,           'Mariam','Camara',    'citoyen',     NULL,NULL,'en','fr',md5('sabou:mariam@exemple.gn')::uuid),                 -- 14
 ('regional.labe@sabou-sante.gn',      '+224620000015','Alpha','Barry',      'regional',    4,   NULL,'fr','pul',md5('sabou:regional.labe@sabou-sante.gn')::uuid),  -- 15
 ('regional.kankan@sabou-sante.gn',    '+224620000016','Mory','Kaba',        'regional',    7,   NULL,'fr','mal',md5('sabou:regional.kankan@sabou-sante.gn')::uuid);  -- 16

INSERT INTO utilisateur_langue (utilisateur_id, langue_code, peut_enregistrer, peut_traduire, peut_valider) VALUES
 (1,'fr',true,true,true),(1,'en',false,true,true),
 (2,'sou',true,true,true),(15,'pul',true,true,true),(16,'mal',true,true,true),
 (3,'pul',true,true,false),(3,'fr',true,true,false),(5,'mal',true,true,false),(5,'fr',true,true,false),
 (8,'mal',true,false,false),(8,'fr',true,false,false);

-- ---------- Praticiens ----------
INSERT INTO specialite (code, libelle_fr, libelle_en) VALUES
 ('phytotherapie','Phytothérapie','Herbal medicine'),('pediatrie','Pédiatrie','Paediatrics'),
 ('os_fractures','Os et fractures','Bones and fractures'),('nutrition','Nutrition','Nutrition'),
 ('gynecologie','Gynécologie et santé maternelle','Gynaecology and maternal health'),
 ('sante_mentale','Santé mentale','Mental health'),('dermatologie','Maladies de la peau','Skin diseases'),
 ('envenimations','Morsures et envenimations','Bites and envenomations');   -- 8 spécialités (R-CER-09)

INSERT INTO praticien (code, utilisateur_id, specialite_id, prefecture_id, sous_prefecture_id, langue_principale, annees_experience, statut, nb_vues) VALUES
 ('PR-1041', 6, 1, 4, 1,    'pul', 12, 'en_attente', 0),     -- 1
 ('PR-1042', 7, 1, 4, 2,    'pul', 20, 'certifie', 4120),    -- 2
 ('PR-1043', 8, 4, 9, 4,    'mal', 15, 'certifie', 2890),    -- 3
 ('PR-1044', 9, 2, 3, NULL, 'sou', 9,  'certifie', 1760),    -- 4
 ('PR-1045',10, 3, 5, NULL, 'pul', 25, 'certifie', 2310);    -- 5

INSERT INTO paiement (operateur, reference_operateur, montant_gnf, objet_type, payeur_id, statut, confirme_le) VALUES
 ('orange_money','OM-2026-000001',150000,'abonnement',7,'reussi', now() - interval '120 days'),
 ('mtn_momo',    'MM-2026-000002',150000,'abonnement',8,'reussi', now() - interval '90 days');
INSERT INTO abonnement (praticien_id, formule, debut, fin, montant_gnf, paiement_id) VALUES
 (1,'gratuit',    current_date - 10, NULL, 0, NULL),
 (2,'gold',       current_date - 120, current_date + 245, 150000, 1),
 (3,'gold',       current_date - 90,  current_date + 275, 150000, 2),
 (4,'gratuit',    current_date - 80, NULL, 0, NULL),
 (5,'institution',current_date - 60, current_date + 305, 400000, NULL);

-- ---------- Certification ----------
INSERT INTO dossier_certification (code, praticien_id, type, etape_courante, etape_entree_le, statut, ouvert_le, cloture_le) VALUES
 ('DS-1041',1,'initial',1, now() - interval '8 days',  'en_cours', now() - interval '12 days', NULL),
 ('DS-1042',2,'initial',6, now() - interval '35 days', 'approuve', now() - interval '60 days', now() - interval '35 days'),
 ('DS-1043',3,'initial',6, now() - interval '30 days', 'approuve', now() - interval '55 days', now() - interval '30 days'),
 ('DS-1044',4,'initial',6, now() - interval '28 days', 'approuve', now() - interval '50 days', now() - interval '28 days'),
 ('DS-1045',5,'initial',6, now() - interval '25 days', 'approuve', now() - interval '48 days', now() - interval '25 days');

INSERT INTO dossier_piece (dossier_id, type, fichier_url, sha256, depose_par, depose_le) VALUES
 (2,'identite',           'pieces/ds1042/identite.pdf',     encode(sha256(convert_to('ds1042-identite','UTF8')),'hex'), 7, now() - interval '60 days'),  -- 1
 (2,'compte_rendu_visite','pieces/ds1042/visite-signee.pdf',encode(sha256(convert_to('ds1042-visite','UTF8')),'hex'),   3, now() - interval '55 days'),  -- 2
 (1,'identite',           'pieces/ds1041/identite.jpg',     encode(sha256(convert_to('ds1041-identite','UTF8')),'hex'), 6, now() - interval '12 days');  -- 3

INSERT INTO visite_terrain (dossier_id, admin_id, prevue_le, rappel_envoye_le, realisee_le, compte_rendu_piece_id, statut) VALUES
 (2, 3, now() - interval '56 days', now() - interval '57 days', now() - interval '55 days', 2,    'realisee'),
 (1, 3, now() + interval '3 days',  NULL,                       NULL,                       NULL, 'planifiee');

INSERT INTO dossier_historique (dossier_id, etape_depart, etape_arrivee, decision, motif, acteur_id, decide_le) VALUES
 (1,1,2,'soumis', NULL, 6, now() - interval '12 days'),
 (1,2,1,'rejete', 'Pièce d''identité illisible : nouvelle photo demandée', 3, now() - interval '8 days'),
 (2,1,2,'soumis', NULL, 7,  now() - interval '60 days'),
 (2,2,3,'valide', NULL, 3,  now() - interval '54 days'),
 (2,3,4,'valide', NULL, 15, now() - interval '48 days'),
 (2,4,5,'valide', NULL, 4,  now() - interval '41 days'),
 (2,5,6,'valide', NULL, 1,  now() - interval '35 days'),
 (2,6,6,'publie', NULL, 1,  now() - interval '35 days'),
 (3,1,2,'soumis', NULL, 8,  now() - interval '55 days');

INSERT INTO cle_signature (cle_publique, active_depuis) VALUES
 ('MCowBQYDK2VwAyEA-exemple-cle-publique-DG-SABOU-2026', now() - interval '1 year');

INSERT INTO certificat (numero, praticien_id, dossier_id, emis_par, emis_le, expire_le, empreinte_sha3, signature, cle_id)
SELECT x.numero, x.prat, x.dossier, 1, current_date - x.age, current_date - x.age + 360,
       encode(sha256(convert_to(x.numero,'UTF8')),'hex'),            -- factice : SHA3-256 calculé par l'application
       encode(sha256(convert_to('sig-' || x.numero,'UTF8')),'base64'), -- factice : signature Ed25519 calculée par l'application
       1
FROM (VALUES ('SAB-2026-PR1042-KX7',2,2,35), ('SAB-2026-PR1043-QD2',3,3,30),
             ('SAB-2026-PR1044-MN5',4,4,28), ('SAB-2026-PR1045-ZT9',5,5,25)) AS x(numero, prat, dossier, age);

-- ---------- Voix (fichiers audio) ----------
INSERT INTO audio_fichier (chemin, duree_sec, taille_octets, enregistre_par, consentement_voix, consentement_le) VALUES
 ('audio/plantes/pl001_fr.opus',   3.0,  9000, 3, true, now()),  -- 1
 ('audio/plantes/pl001_sou.opus',  3.1,  9200, 3, true, now()),  -- 2
 ('audio/plantes/pl001_mal.opus',  3.2,  9400, 5, true, now()),  -- 3
 ('audio/plantes/pl001_pul.opus',  3.0,  9000, 3, true, now()),  -- 4
 ('audio/rec2041/prep_fr.opus',   48.0, 90000, 8, true, now()),  -- 5
 ('audio/rec2041/prep_mal.opus',  52.0, 98000, 8, true, now()),  -- 6
 ('audio/rec2041/conso_mal.opus', 36.0, 70000, 8, true, now()),  -- 7
 ('audio/rec2041/cycle_mal.opus', 30.0, 58000, 8, true, now()),  -- 8
 ('audio/rec2041/effets_mal.opus',41.0, 78000, 8, true, now()),  -- 9
 ('audio/rec2041/effets_fr.opus', 40.0, 76000, 8, true, now()),  -- 10
 ('audio/plantes/pl002_mal.opus',  3.3,  9500, 5, true, now()),  -- 11
 ('audio/maladies/ma001_mal.opus', 2.5,  7000, 5, true, now()),  -- 12
 ('audio/maladies/ma001_fr.opus',  2.4,  6800, 3, true, now()),  -- 13
 ('audio/demandes/dp305.opus',     4.0, 11000,11, true, now());  -- 14

-- ---------- Dictionnaire : plantes ----------
INSERT INTO plante (code, nom_scientifique, famille, nom_fr, nom_en, statut, valide_par) VALUES
 ('PL-001','Khaya senegalensis', 'Meliaceae',  'Caïlcédrat',     'African mahogany','validee', 4),
 ('PL-002','Vernonia amygdalina','Asteraceae', 'Vernonie amère', 'Bitter leaf',     'validee', 4),
 ('PL-003','Parkia biglobosa',   'Fabaceae',   'Néré',           'African locust bean','validee', 4),
 ('PL-004','Moringa oleifera',   'Moringaceae','Moringa',        'Moringa',         'validee', 4),
 ('PL-005','Azadirachta indica', 'Meliaceae',  'Neem',           'Neem',            'en_revue', NULL);

INSERT INTO plante_image (plante_id, image_url, alt_text_fr, alt_text_en, type, principale, ordre) VALUES
 (1,'img/plantes/khaya.jpg',   'Écorce et feuilles de caïlcédrat','Khaya bark and leaves','ecorce',        true, 1),
 (2,'img/plantes/vernonia.jpg','Feuilles de vernonie amère',      'Bitter leaf',          'feuille',       true, 1),
 (3,'img/plantes/nere.jpg',    'Gousses de néré',                 'Locust bean pods',     'autre',         true, 1),
 (4,'img/plantes/moringa.jpg', 'Feuilles de moringa',             'Moringa leaves',       'feuille',       true, 1),
 (5,'img/plantes/neem.jpg',    'Feuilles de neem',                'Neem leaves',          'feuille',       true, 1),
 (1,'img/plantes/khaya2.jpg',  'Arbre de caïlcédrat',             'Khaya tree',           'plante_entiere',false,2);

-- Voix du nom de la plante (libellé écrit en français, voix dans la langue)
INSERT INTO plante_voix (plante_id, langue_code, audio_id, statut, enregistre_par, valideur_id) VALUES
 (1,'fr', 1,'publie', 3, 1),
 (1,'sou',2,'publie', 3, 2),
 (1,'mal',3,'publie', 5, 16),
 (1,'pul',4,'publie', 3, 15),
 (2,'mal',11,'traduit',5, NULL);

-- Noms locaux : transcription de recherche uniquement (jamais affichée comme contenu)
INSERT INTO plante_nom_local (plante_id, langue_code, transcription_recherche, audio_id, principal) VALUES
 (1,'sou','Kignè',2,true),(1,'mal','Dialambéré',3,true),(1,'pul','Bahi',4,true),
 (2,'sou','Kèmèkhoui',NULL,true),(2,'mal','Ngouni',11,true),(2,'pul','Kosa',NULL,true),
 (3,'sou','Nété',NULL,true),(3,'mal','Néré',NULL,true);

-- ---------- Dictionnaire : maladies ----------
INSERT INTO maladie (code, nom_fr, nom_en, symptomes_fr, symptomes_en) VALUES
 ('MA-001','Paludisme',   'Malaria',     'Fièvre, frissons, maux de tête, fatigue.',            'Fever, chills, headache, fatigue.'),
 ('MA-002','Hypertension','Hypertension','Souvent sans symptôme ; maux de tête, vertiges.',     'Often silent; headache, dizziness.'),
 ('MA-003','Anémie',      'Anaemia',     'Fatigue, pâleur, essoufflement.',                     'Fatigue, pallor, shortness of breath.'),
 ('MA-004','Toux',        'Cough',       'Toux sèche ou grasse, gorge irritée.',                'Dry or wet cough, sore throat.'),
 ('MA-005','Diabète',     'Diabetes',    'Soif intense, urines fréquentes, fatigue.',           'Intense thirst, frequent urination, fatigue.');
INSERT INTO maladie_denomination (maladie_id, langue_code, denomination) VALUES
 (1,'fr','Malaria'),(1,'fr','Fièvre palustre'),(1,'en','Swamp fever'),(2,'fr','Tension'),(5,'fr','Maladie du sucre');
INSERT INTO maladie_voix (maladie_id, langue_code, audio_id, statut, enregistre_par, valideur_id) VALUES
 (1,'mal',12,'publie',5,16),(1,'fr',13,'publie',3,1);
INSERT INTO plante_maladie (plante_id, maladie_id) VALUES (1,1),(2,1),(3,1),(4,3),(3,2),(2,5),(4,4);

-- ---------- Traitements ----------
INSERT INTO section_type (code, ordre, obligatoire, libelle_fr, libelle_en) VALUES
 ('preparation',        1, true,  'Mode de préparation',                       'Preparation'),
 ('consommation',       2, true,  'Modes de consommation',                     'How to take it'),
 ('cycle',              3, true,  'Cycle de traitement',                       'Treatment cycle'),
 ('effets_indesirables',4, true,  'Effets indésirables et contre-indications', 'Side effects and contraindications'),
 ('conservation',       5, false, 'Conservation',                              'Storage');

INSERT INTO contre_indication (code, libelle_fr, libelle_en) VALUES
 ('grossesse','Grossesse','Pregnancy'),('allaitement','Allaitement','Breastfeeding'),
 ('enfant_moins_5_ans','Enfant de moins de 5 ans','Child under 5'),('personne_agee','Personne âgée','Elderly person'),
 ('maladie_chronique','Maladie chronique','Chronic disease');

-- Insérés en brouillon, certifiés ensuite (trg_recette_publiable vérifie plantes, sections, praticien, quota)
INSERT INTO recette (code, praticien_id, maladie_id, titre_fr, titre_en, cycle_duree_jours, cycle_prises_par_jour, cycle_pause_jours, visibilite) VALUES
 ('REC-2041',3,1,'Décoction de Caïlcédrat et Vernonie','Khaya and bitter leaf decoction', 3, 2, 2,   'publique'),  -- 1
 ('REC-2042',2,1,'Infusion de Néré',                   'Locust bean infusion',           5, 1, NULL,'publique'),  -- 2
 ('REC-2043',5,1,'Mélange Moringa, Néré et Vernonie',  NULL,                             7, 2, 0,   'publique'),  -- 3
 ('REC-2044',4,3,'Poudre de Moringa',                  'Moringa powder',                10, 1, NULL,'restreinte'),-- 4
 ('REC-2045',3,2,'Infusion de Néré pour la tension',   NULL,                            14, 1, NULL,'publique');  -- 5
INSERT INTO recette_plante (recette_id, plante_id, ordre, partie_utilisee) VALUES
 (1,1,1,'écorce'),(1,2,2,'feuilles'),(2,3,1,'gousses'),(3,4,1,'feuilles'),(3,3,2,'gousses'),(3,2,3,'feuilles'),(4,4,1,'feuilles'),(5,3,1,'gousses');

-- Sections de REC-2041 : identifiants 1 à 5 (préparation, consommation, cycle, effets, conservation)
INSERT INTO recette_section (recette_id, type_code, texte_fr, texte_en) VALUES
 (1,'preparation','Laver l''écorce de caïlcédrat et les feuilles de vernonie amère, les faire bouillir ensemble vingt minutes, laisser tiédir puis filtrer.',
                  'Wash the khaya bark and bitter leaves, boil them together for twenty minutes, let cool, then strain.'),
 (1,'consommation','Boire tiède, un verre le matin et un verre le soir, selon la posologie du tradipraticien certifié (exemple de maquette).', NULL),
 (1,'cycle','Trois jours consécutifs, matin et soir. Pause de deux jours, puis reprise sur avis du tradipraticien (exemple de maquette).', NULL),
 (1,'effets_indesirables','Goût très amer, troubles digestifs possibles. Déconseillé aux femmes enceintes et aux enfants de moins de 5 ans. Arrêter et consulter en cas de vomissements.', NULL),
 (1,'conservation','Conserver la décoction au frais, 24 heures au maximum.', NULL);
INSERT INTO recette_section (recette_id, type_code, texte_fr)
SELECT r.id, t.code, '[Exemple] ' || t.libelle_fr || ' — ' || r.titre_fr
  FROM recette r CROSS JOIN section_type t
 WHERE r.code IN ('REC-2042','REC-2043','REC-2044') AND t.obligatoire;
INSERT INTO recette_section (recette_id, type_code, texte_fr) VALUES (5,'preparation','[Brouillon] Faire infuser les gousses.');

INSERT INTO recette_contre_indication (recette_id, contre_indication_code) VALUES
 (1,'grossesse'),(1,'enfant_moins_5_ans'),(3,'grossesse');

-- Certification directe pour le jeu d'exemple (en production : recette_transition)
UPDATE recette SET statut = 'certifiee' WHERE code IN ('REC-2041','REC-2042','REC-2044');
UPDATE recette SET statut = 'transmise' WHERE code = 'REC-2043';
INSERT INTO recette_historique (recette_id, statut_depart, statut_arrivee, motif, acteur_id, decide_le) VALUES
 (1,'brouillon', 'soumise',    NULL, 8,  now() - interval '30 days'),
 (1,'soumise',   'transmise',  NULL, 16, now() - interval '28 days'),
 (1,'transmise', 'expertisee', NULL, 4,  now() - interval '24 days'),
 (1,'expertisee','certifiee',  NULL, 1,  now() - interval '20 days');

-- Voix des sections de REC-2041 (les effets indésirables exigent le contrôle du Comité)
INSERT INTO recette_section_voix (section_id, langue_code, audio_id, statut, enregistre_par, traducteur_id, valideur_id, controle_comite_par, controle_comite_le) VALUES
 (1,'fr', 5, 'publie', 8, NULL, 1,  NULL, NULL),
 (1,'mal',6, 'publie', 8, 5,    16, NULL, NULL),
 (2,'mal',7, 'publie', 8, 5,    16, NULL, NULL),
 (3,'mal',8, 'publie', 8, 5,    16, NULL, NULL),
 (4,'mal',9, 'publie', 8, 5,    16, 4,    now()),
 (4,'fr', 10,'publie', 8, NULL, 1,  4,    now());

INSERT INTO annotation_comite (objet_type, objet_id, auteur_id, contenu, avis) VALUES
 ('recette',1,4,'Écorce de Khaya senegalensis : posologie compatible avec l''usage traditionnel ; amertume signalée.','favorable'),
 ('plante', 5,4,'Identification botanique à confirmer par échantillon.', NULL);

-- ---------- Témoignages ----------
INSERT INTO temoignage (auteur_id, recette_id, note, contenu, langue_code, statut, modere_par, modere_le, reponse_praticien, reponse_statut, reponse_le) VALUES
 (11,1,5,'Après trois jours de fièvre, les symptômes ont disparu en 48 heures. J''ai écouté la recette en malinké.','mal','publie',3,now(),
  'Merci pour votre retour ; respectez bien la pause de deux jours.','publie',now()),
 (12,1,4,'Le goût est amer mais la fièvre est tombée. L''audio en pular m''a beaucoup aidée.','pul','publie',3,now(),NULL,NULL,NULL),
 (13,1,5,'J''ai suivi le cycle de trois jours. Une légère gêne au ventre le premier jour, comme annoncé.','sou','publie',1,now(),NULL,NULL,NULL),
 (14,4,4,'Plus d''énergie après dix jours.','fr','publie',1,now(),NULL,NULL,NULL),
 (11,4,5,'Très bon traitement.','mal','en_attente',NULL,NULL,NULL,NULL,NULL),
 (12,2,4,'Infusion douce, bien tolérée.','pul','publie',3,now(),NULL,NULL,NULL);

-- ---------- Demandes de plantes ----------
INSERT INTO demande_plante (code, demandeur_id, langue_code, transcription, audio_id, prefecture_id, praticien_id, plante_id, statut) VALUES
 ('DP-301',11,'mal','Dialambéré',NULL,7,3,1,   'a_envoyer'),
 ('DP-302',13,'sou','Kèmèkhoui', NULL,3,4,2,   'a_envoyer'),
 ('DP-303',12,'pul','Néré',      NULL,4,2,3,   'envoyee'),
 ('DP-304',12,'pul','Bahi',      NULL,4,2,1,   'recue'),
 ('DP-305',11,'mal',NULL,        14,  9,3,NULL,'recue');      -- nom local dit (voix seulement)

-- ---------- Sécurité sanitaire ----------
INSERT INTO signalement_sanitaire (type, objet_type, objet_id, auteur_id, description, gravite, prefecture_id, statut) VALUES
 ('danger',           'recette',1,13,'Vomissements après la deuxième prise chez un adolescent.','grave', 3,'en_examen'),
 ('effet_indesirable','recette',4,14,'Légers maux de ventre les deux premiers jours.',          'faible',2,'recu');

-- ---------- Forum ----------
INSERT INTO forum_discussion (titre, categorie, portee, region_admin_id, prefecture_id, auteur_id, statut, nb_vues) VALUES
 ('Comment reconnaître un praticien certifié ?','certification','nationale',   NULL,NULL,7,'epingle',320),
 ('Retour d''expérience : paludisme à Kankan', 'temoignages',  'regionale',   7,   NULL,8,'actif',540),
 ('Conservation des écorces',                  'phytotherapie','prefectorale',NULL,4,   9,'actif',120),
 ('Interaction Vernonia et antidiabétiques',   'comite',       'nationale',   NULL,NULL,4,'a_surveiller',80),
 ('Formation continue 2026',                   'formation',    'nationale',   NULL,NULL,1,'actif',210);
INSERT INTO forum_message (discussion_id, auteur_id, contenu) VALUES
 (1,1,'Vérifiez le certificat par QR Code sur la page Vérifier un certificat.'),(1,11,'Merci, très utile.'),
 (2,8,'Le traitement en trois jours a bien fonctionné.'),(3,10,'Conserver à l''abri de l''humidité.'),
 (4,4,'Avis du comité en cours de rédaction.'),(2,12,'Message hors sujet.');
INSERT INTO forum_signalement (message_id, signale_par, motif) VALUES (6,11,'Hors sujet');

-- ---------- Pilotage ----------
INSERT INTO litige (code, objet, prefecture_id, ouvert_par, praticien_id, statut) VALUES
 ('L-014','Contestation du rejet terrain du dossier DS-1041',4,6,1,'en_arbitrage');
INSERT INTO litige_message (litige_id, auteur_id, contenu) VALUES
 (1,6,'La photo de ma pièce a été prise de nuit ; je fournis une nouvelle copie.');
INSERT INTO alerte_territoriale (type, region_admin_id, prefecture_id, maladie_id, description, statut, accusee_le) VALUES
 ('hausse_pathologie',7,9,1,'Hausse des recherches « paludisme » à Siguiri (+40 % sur 7 jours).','nouvelle',NULL),
 ('dossier_bloque',   4,4,NULL,'DS-1041 sans décision depuis 8 jours.','accusee',now());
INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, statut, tentatives, envoyee_le) VALUES
 (6,'sms','dossier.rejete','dossier','DS-1041','envoyee',1,now() - interval '8 days');

-- ---------- Services ----------
INSERT INTO produit (code, praticien_id, nom, description_fr, prix_gnf, stock, statut, valide_par) VALUES
 ('PD-001',2,'Poudre de néré conditionnée 100 g','Sachet scellé, date de conditionnement indiquée.',25000,40,'publie',4);
INSERT INTO commande (code, acheteur_id, produit_id, quantite, montant_gnf, commission_gnf, statut) VALUES
 ('CMD-0001',14,1,2,50000,5000,'en_attente');
INSERT INTO partenaire (code, nom, type, quota_mensuel) VALUES
 ('PA-01','Institut national de santé publique','institution',200000);
INSERT INTO cle_api (partenaire_id, prefixe, empreinte, expire_le) VALUES
 (1,'sab_7Kx',encode(sha256(convert_to('cle-exemple','UTF8')),'hex'), now() + interval '90 days');
INSERT INTO formation_module (code, titre_fr, titre_en) VALUES
 ('FM-HYG','Hygiène et conservation','Hygiene and storage'),('FM-BOT','Botanique appliquée','Applied botany'),
 ('FM-ETH','Gestion et éthique','Management and ethics');
INSERT INTO attestation (numero, praticien_id, module_id) VALUES ('ATT-2026-0001',2,1);

-- ---------- Site public (CdC §5.1 : 7 entrées dans le header) ----------
INSERT INTO menu_site (emplacement, chemin, ordre) VALUES
 ('header','/',1),('header','/annuaire',2),('header','/dictionnaire',3),('header','/recettes',4),
 ('header','/forum',5),('header','/temoignages',6),('header','/verifier',7),
 ('footer','/a-propos',1),('footer','/concept',2),('footer','/partenaires',3),('footer','/mentions',4);
INSERT INTO menu_site_i18n (menu_id, langue_code, libelle) VALUES
 (1,'fr','Accueil'),(2,'fr','Annuaire'),(3,'fr','Dictionnaire Impérial'),(4,'fr','Recettes'),(5,'fr','Forum'),
 (6,'fr','Témoignages'),(7,'fr','Vérifier un certificat'),(8,'fr','À propos de SABOU'),(9,'fr','Le concept Yeleen Kènè'),
 (10,'fr','Devenir partenaire'),(11,'fr','Mentions légales'),
 (1,'en','Home'),(2,'en','Directory'),(3,'en','Imperial Dictionary'),(4,'en','Recipes'),(5,'en','Forum'),
 (6,'en','Testimonials'),(7,'en','Verify a certificate'),(8,'en','About SABOU'),(9,'en','The Yeleen Kènè concept'),
 (10,'en','Become a partner'),(11,'en','Legal notice');
INSERT INTO slide (image_url, lien, ordre) VALUES
 ('img/slides/pays.jpg','/recettes',1),('img/slides/plantes.jpg','/dictionnaire',2),('img/slides/voix.jpg','/recettes',3);
INSERT INTO slide_i18n (slide_id, langue_code, titre, texte, bouton, alt_text) VALUES
 (1,'fr','La lumière de la santé, dans votre langue.','Cherchez une maladie : traitements, plantes en photo et recettes à écouter.','Rechercher','Collines et lever de soleil'),
 (2,'fr','Une plante, une fiche, toutes les langues.','Le même savoir, du soussou au guerzé, à écouter.','Dictionnaire','Feuillage de plantes médicinales'),
 (3,'fr','Écoutez la recette comme on vous la transmet.','Voix des tradipraticiens dans chaque langue.','Écouter','Mortier, feuilles et voix'),
 (1,'en','The light of health, in your language.','Search a disease: treatments, plant photos and recipes to listen to.','Search','Hills and sunrise'),
 (2,'en','One plant, one record, every language.','The same knowledge, from Soussou to Guerzé, to listen to.','Dictionary','Foliage of medicinal plants'),
 (3,'en','Listen to the recipe as it is handed down.','Healers'' voices in every language.','Listen','Mortar, leaves and voice');
INSERT INTO publication_site (publie_par, contenu) VALUES
 (1, jsonb_build_object('menus', 11, 'slides', 3, 'commentaire', 'Publication initiale'));

-- ---------- Traçabilité ----------
INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details, ip) VALUES
 (1,'certificat.emis','certificat','SAB-2026-PR1042-KX7','{"praticien":"PR-1042"}','10.0.0.5'),
 (3,'dossier.rejete','dossier','DS-1041','{"motif":"pièce illisible"}','10.0.0.8'),
 (3,'temoignage.publie','temoignage','1','{}','10.0.0.8'),
 (1,'recette.certifiee','recette','REC-2041','{}','10.0.0.5'),
 (16,'voix.validee','recette_section_voix','1/mal','{}','10.0.0.9');
COMMIT;
