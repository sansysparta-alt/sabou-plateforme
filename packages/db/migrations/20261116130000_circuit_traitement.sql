-- US-061 : faire avancer un traitement (soumettre, transmettre, expertiser, certifier, rejeter)
-- (UC-22, UC-42, UC-51, UC-62, R-REC-07).
--   - rôles et zones : déjà tenus par recette_transition (schéma initial) et par le
--     cloisonnement des traitements (US-060) ; prouvés par packages/db/test/circuit-traitement.test.ts ;
--   - file de chaque acteur : traitements_a_decider() ; les traitements d'un praticien rejeté
--     définitivement n'y figurent pas (US-047, critère ajouté le 14 novembre 2026) ;
--   - décision contre l'état vu à l'écran : traitement_decider refuse si le traitement a
--     bougé entre-temps (même règle que les dossiers, 05 §2.31) ;
--   - SMS au praticien : un renvoi (rejet) a son propre modèle, « recette.renvoyee » avec le
--     statut d'arrivée ; sans lui, un renvoi du Comité vers « soumis » se lirait comme une
--     soumission.
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Transition : même règles, SMS distinct pour un renvoi
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recette_transition(p_recette bigint, p_vers text, p_acteur bigint, p_motif text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_rec           recette%ROWTYPE;
        v_usr           utilisateur%ROWTYPE;
        v_prat_user     bigint;
        v_pref          smallint;
        v_region        smallint;
        v_motif_requis  boolean;
        v_renvoi        boolean;
BEGIN
  SELECT * INTO v_rec FROM recette WHERE id = p_recette FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_recette; END IF;
  SELECT * INTO v_usr FROM utilisateur WHERE id = p_acteur AND statut = 'actif';
  IF NOT FOUND THEN RAISE EXCEPTION 'Acteur % inconnu ou suspendu', p_acteur; END IF;
  SELECT pr.utilisateur_id, pr.prefecture_id, pf.region_admin_id INTO v_prat_user, v_pref, v_region
    FROM praticien pr JOIN prefecture pf ON pf.id = pr.prefecture_id WHERE pr.id = v_rec.praticien_id;

  SELECT bool_or(rg.motif_requis), bool_or(rg.renvoi) INTO v_motif_requis, v_renvoi
    FROM (VALUES
      ('brouillon', 'soumise',    'praticien',    false, false), ('brouillon', 'soumise',   'prefectoral',  false, false),
      ('soumise',   'transmise',  'regional',     false, false), ('soumise',   'brouillon', 'regional',     true,  true),
      ('transmise', 'expertisee', 'scientifique', false, false), ('transmise', 'soumise',   'scientifique', true,  true),
      ('expertisee','certifiee',  'dg',           false, false), ('expertisee','transmise', 'dg',           true,  true),
      ('certifiee', 'suspendue',  'scientifique', true,  false), ('certifiee', 'suspendue', 'dg',           true,  false),
      ('suspendue', 'certifiee',  'scientifique', false, false), ('suspendue', 'certifiee', 'dg',           false, false),
      ('certifiee', 'retiree',    'praticien',    false, false), ('suspendue', 'retiree',   'praticien',    false, false),
      ('certifiee', 'retiree',    'dg',           true,  false), ('suspendue', 'retiree',   'dg',           true,  false)
    ) AS rg(de, vers, qui, motif_requis, renvoi)
   WHERE rg.de = v_rec.statut AND rg.vers = p_vers AND rg.qui = v_usr.role_code
     AND (rg.qui <> 'praticien'   OR v_usr.id = v_prat_user)
     AND (rg.qui <> 'prefectoral' OR v_usr.prefecture_id = v_pref)
     AND (rg.qui <> 'regional'    OR v_usr.region_admin_id = v_region);

  IF v_motif_requis IS NULL THEN
    RAISE EXCEPTION 'Transition % → % interdite pour l''acteur % sur le traitement %', v_rec.statut, p_vers, p_acteur, v_rec.code;
  END IF;
  IF v_motif_requis AND COALESCE(btrim(p_motif), '') = '' THEN
    RAISE EXCEPTION 'Transition % → % : motif obligatoire', v_rec.statut, p_vers;
  END IF;

  UPDATE recette SET statut = p_vers WHERE id = v_rec.id;   -- trg_recette_publiable contrôle la certification
  INSERT INTO recette_historique (recette_id, statut_depart, statut_arrivee, motif, acteur_id)
  VALUES (v_rec.id, v_rec.statut, p_vers, nullif(btrim(p_motif), ''), p_acteur);
  INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
  VALUES (v_prat_user, 'sms', CASE WHEN v_renvoi THEN 'recette.renvoyee' ELSE 'recette.' || p_vers END,
          'recette', v_rec.code, jsonb_build_object('statut', p_vers));
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'recette.' || p_vers, 'recette', v_rec.code,
          jsonb_build_object('de', v_rec.statut, 'motif', nullif(btrim(p_motif), '')));
  RETURN p_vers;
END $$;

-- ---------------------------------------------------------------------
-- 2. File de l'acteur connecté
-- ---------------------------------------------------------------------
-- Traitements qui attendent la décision de l'acteur : régional = soumis de sa région,
-- Comité = transmis, DG = expertisés (la zone vient du RLS). Praticien rejeté définitivement :
-- ses traitements ne progressent plus (US-047), ils ne sont pas proposés.
CREATE FUNCTION traitements_a_decider() RETURNS SETOF recette
LANGUAGE sql STABLE AS $$
  SELECT r.* FROM recette r
    JOIN praticien p ON p.id = r.praticien_id
   WHERE p.statut <> 'rejete'
     AND r.statut = CASE contexte_role() WHEN 'regional'     THEN 'soumise'
                                         WHEN 'scientifique' THEN 'transmise'
                                         WHEN 'dg'           THEN 'expertisee' END
$$;

-- ---------------------------------------------------------------------
-- 3. Décision contre l'état vu
-- ---------------------------------------------------------------------
-- p_decision : « avance » (étape suivante) ou « renvoi » (étape précédente, motif obligatoire)
CREATE FUNCTION traitement_decider(p_code text, p_statut_vu text, p_decision text, p_motif text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_rec  recette%ROWTYPE;
        v_vers text;
BEGIN
  SELECT * INTO v_rec FROM recette WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_code; END IF;
  IF v_rec.statut IS DISTINCT FROM p_statut_vu THEN
    RAISE EXCEPTION 'Traitement % : statut changé entre-temps', p_code;
  END IF;
  v_vers := CASE p_decision
    WHEN 'avance' THEN CASE v_rec.statut WHEN 'soumise' THEN 'transmise'
                                         WHEN 'transmise' THEN 'expertisee'
                                         WHEN 'expertisee' THEN 'certifiee' END
    WHEN 'renvoi' THEN CASE v_rec.statut WHEN 'soumise' THEN 'brouillon'
                                         WHEN 'transmise' THEN 'soumise'
                                         WHEN 'expertisee' THEN 'transmise' END END;
  IF v_vers IS NULL THEN
    RAISE EXCEPTION 'Transition % → % interdite pour l''acteur % sur le traitement %',
      v_rec.statut, p_decision, contexte_utilisateur(), p_code;
  END IF;
  RETURN recette_transition(v_rec.id, v_vers, contexte_utilisateur(), p_motif);
END $$;
