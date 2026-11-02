-- =====================================================================
-- SABOU — Requêtes d'exemple (base migrée + seed/dev.sql)
-- Exécutées par les tests (test/queries.test.ts) : chaque requête doit passer sans erreur.
-- Les cas interdits, en commentaire « ERREUR attendue », sont prouvés un par un par
-- test/forbidden.test.ts.
-- =====================================================================
SET search_path = sabou, public;

-- ===================== RECHERCHE (cœur du produit) =====================
-- Un citoyen qui écoute en malinké tape « paludisme » : la maladie (voix malinké), ses traitements,
-- et pour chacun les plantes (nom français, photo, voix malinké sinon française). R-RCH-01/02
SELECT * FROM rechercher_maladie('paludisme', 'mal');
-- Tolérance aux accents, aux fautes et aux dénominations : « anemie », « paludism », « fievre palustre »
SELECT maladie_code, nom_maladie, titre FROM rechercher_maladie('anemie', 'fr');
SELECT maladie_code, nom_maladie, titre FROM rechercher_maladie('fievre palustre', 'fr');
-- Utilisateur connecté : les traitements à visibilité « restreinte » apparaissent aussi (R-REC-10)
SELECT recette_code, titre FROM rechercher_maladie('anemie', 'fr', true);
-- Interface en anglais : noms et titres anglais, repli sur le français
SELECT nom_maladie, titre FROM rechercher_maladie('malaria', 'en');

-- Page traitement : texte français + voix malinké ; repli sur la voix française et « traduction en cours » (R-LNG-09)
SELECT * FROM recette_page(1, 'mal');
SELECT type_code, langue_servie, traduction_en_cours FROM recette_page(1, 'pul');   -- pular absent : voix française

-- Fiche plante : libellé en français, voix du nom dans chaque langue (aucun texte en langue nationale)
SELECT l.nom_fr AS langue, 'Nom en ' || lower(l.nom_fr) AS libelle, a.chemin AS voix, pv.statut
FROM plante p JOIN plante_voix pv ON pv.plante_id = p.id JOIN langue l ON l.code = pv.langue_code
JOIN audio_fichier a ON a.id = pv.audio_id
WHERE p.code = 'PL-001' ORDER BY l.ordre;

-- « Je ne connais que le nom local » : retrouver la plante à partir de « dialambere » (R-LNG-13, CdC §2.7)
SELECT * FROM rechercher_plante('dialambere', 'mal');

-- Vérifier un certificat : vert / ambre / rouge (R-QR-05)
SELECT verdict, titulaire, expire_le FROM verifier_certificat('SAB-2026-PR1042-KX7');
SELECT verdict FROM verifier_certificat('SAB-0000-INCONNU');   -- rouge

-- Annuaire public et témoignages publics (prénom + initiale)
SELECT code, prenom, nom, specialite, prefecture, note_moyenne, nb_recettes FROM v_annuaire_public ORDER BY note_moyenne DESC NULLS LAST;
SELECT auteur, note, contenu, reponse_praticien FROM v_temoignage_public WHERE recette_id = 1 ORDER BY created_at DESC;

-- ===================== WORKFLOWS =====================
-- Dossier DS-1041 : le praticien (utilisateur 6) resoumet après le rejet → étape 2
SELECT dossier_transition(1, 'soumis', 6);
-- Interdit : le préfectoral de Kankan (5) n'est pas compétent pour un praticien de Labé
-- SELECT dossier_transition(1, 'valide', 5);                         -- ERREUR attendue
-- Interdit : validation terrain sans visite réalisée et compte rendu signé
-- SELECT dossier_transition(1, 'valide', 3);                         -- ERREUR attendue
-- Rejet terrain : retour à l'étape 1, motif obligatoire
SELECT dossier_transition(1, 'rejete', 3, 'Justificatif de domicile manquant');

-- Traitement REC-2043 (transmis) : le Comité (4) l'expertise, la DG (1) le certifie
SELECT recette_transition(3, 'expertisee', 4);
SELECT recette_transition(3, 'certifiee', 1);
-- Interdit : un rejet sans motif
-- (corrigé : l'exemple v2 visait REC-2045, déjà en brouillon, refusé pour une autre raison)
-- SELECT recette_transition(3, 'suspendue', 4);                      -- ERREUR attendue
-- SELECT recette_transition(3, 'suspendue', 4, '   ');               -- ERREUR attendue
-- Suspension d'un traitement après un signalement grave (R-SAN-03)
SELECT recette_transition(1, 'suspendue', 4, 'Signalement de vomissements en cours d''examen');
SELECT recette_transition(1, 'certifiee', 4);                         -- levée de la suspension

-- ===================== CRUD =====================
-- CREATE : un citoyen dépose un témoignage (en attente de modération)
INSERT INTO temoignage (auteur_id, recette_id, note, contenu, langue_code) VALUES (14, 1, 5, 'Très efficace, merci.', 'fr');
-- UPDATE : modération (les notes du traitement et du praticien sont recalculées)
UPDATE temoignage SET statut = 'publie', modere_par = 3, modere_le = now() WHERE auteur_id = 14 AND recette_id = 1;
-- UPDATE : l'auteur modifie son texte → retour automatique en modération (R-TEM-04)
UPDATE temoignage SET contenu = 'Très efficace, mais goût amer.' WHERE auteur_id = 14 AND recette_id = 1;
-- UPDATE : réponse du praticien → réponse en attente de modération (R-TEM-05)
UPDATE temoignage SET reponse_praticien = 'Merci, le miel peut adoucir le goût.' WHERE auteur_id = 14 AND recette_id = 1;
-- DELETE logique : l'auteur retire son témoignage
UPDATE temoignage SET statut = 'retire' WHERE auteur_id = 14 AND recette_id = 1;
-- Interdit : publier une voix en anglais (langue sans voix) ou un libellé de menu en pular (langue sans texte)
-- INSERT INTO menu_site_i18n (menu_id, langue_code, libelle) VALUES (1, 'pul', 'X');   -- ERREUR attendue
-- Interdit : certifier un traitement incomplet (REC-2045 n'a qu'une section)
-- UPDATE recette SET statut = 'certifiee' WHERE code = 'REC-2045';                     -- ERREUR attendue

-- ===================== ANALYTIQUES =====================
-- 1. Couverture vocale par langue (DG, « Ressources linguistiques »)
SELECT * FROM v_couverture_langue ORDER BY couverture_pct DESC;

-- 2. Délai moyen (en jours) par étape du workflow de certification (cible ≤ 3 jours)
SELECT h.etape_depart AS etape, round(avg(extract(epoch FROM (h.decide_le - h.prec)) / 86400)::numeric, 1) AS jours_moyens
FROM (SELECT etape_depart, decide_le, lag(decide_le) OVER (PARTITION BY dossier_id ORDER BY decide_le) AS prec
        FROM dossier_historique) h
WHERE h.prec IS NOT NULL GROUP BY h.etape_depart ORDER BY h.etape_depart;

-- 3. Dossiers bloqués depuis plus de 15 jours
SELECT * FROM v_dossiers_bloques;

-- 4. Maladies : traitements certifiés, plantes distinctes, note moyenne
SELECT ma.nom_fr AS maladie, count(DISTINCT r.id) AS traitements, count(DISTINCT rp.plante_id) AS plantes, round(avg(r.note_moyenne),1) AS note
FROM maladie ma JOIN recette r ON r.maladie_id = ma.id AND r.statut = 'certifiee'
JOIN recette_plante rp ON rp.recette_id = r.id
GROUP BY ma.nom_fr ORDER BY traitements DESC;

-- 5. Plantes les plus utilisées dans les traitements certifiés
SELECT p.nom_scientifique, p.nom_fr, count(*) AS nb_traitements
FROM recette_plante rp JOIN recette r ON r.id = rp.recette_id AND r.statut = 'certifiee'
JOIN plante p ON p.id = rp.plante_id GROUP BY p.nom_scientifique, p.nom_fr ORDER BY nb_traitements DESC;

-- 6. Voix de noms de plantes manquantes ou non publiées, par langue nationale (travail des admins régionaux)
SELECT l.code AS langue, p.code, p.nom_fr
FROM langue l CROSS JOIN plante p
LEFT JOIN plante_voix pv ON pv.plante_id = p.id AND pv.langue_code = l.code AND pv.statut = 'publie'
WHERE l.type = 'nationale' AND p.statut = 'validee' AND pv.plante_id IS NULL ORDER BY l.code, p.code;

-- 7. Voix d'effets indésirables en attente du contrôle du Comité (R-LNG-12)
SELECT r.code, v.langue_code, v.statut
FROM recette_section_voix v JOIN recette_section s ON s.id = v.section_id JOIN recette r ON r.id = s.recette_id
WHERE s.type_code = 'effets_indesirables' AND v.controle_comite_par IS NULL;

-- 8. Demandes de plantes en attente par préfecture et langue
SELECT pf.nom AS prefecture, d.langue_code, count(*) FILTER (WHERE d.statut IN ('recue','a_envoyer')) AS en_attente
FROM demande_plante d JOIN prefecture pf ON pf.id = d.prefecture_id GROUP BY pf.nom, d.langue_code ORDER BY en_attente DESC;

-- 9. Signalements sanitaires ouverts, les graves d'abord (cible 24 h)
SELECT id, type, objet_type, objet_id, gravite, statut, round(extract(epoch FROM now() - created_at) / 3600) AS heures
FROM signalement_sanitaire WHERE statut <> 'clos' ORDER BY (gravite = 'grave') DESC, created_at;

-- 10. Signalements du forum non traités depuis plus de 48 h (R-FOR-03)
SELECT fs.id, fs.message_id, fs.motif, fs.signale_le FROM forum_signalement fs
WHERE fs.traite_le IS NULL AND fs.signale_le < now() - interval '48 hours';

-- 11. Tâche quotidienne : expiration des certificats
SELECT expirer_certificats();
