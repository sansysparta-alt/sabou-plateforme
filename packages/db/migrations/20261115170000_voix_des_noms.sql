-- US-071 : voix du nom des plantes et des maladies, par langue, avec ses statuts (UC-33, UC-41,
-- R-LNG-10, R-LNG-11, R-GOV-03, R-GOV-05, R-GOV-06, R-GOV-07).
--   brouillon : la voix est enregistrée (référent de la langue : droit d'enregistrer) ;
--   traduit   : celui qui a enregistré, ou un traducteur de la langue, la déclare fidèle au nom
--               français et la présente à la validation ;
--   valide    : un valideur de la langue l'a écoutée et acceptée ; jamais celui qui a
--               enregistré (contrainte ck_*_separation) ; il peut aussi la renvoyer en
--               brouillon avec un motif ;
--   publie    : la DG la publie ; impossible sans le consentement de la personne qui parle
--               (trigger trg_voix_publiable, R-LNG-11).
-- Un nouvel enregistrement remplace la voix et la ramène en brouillon. Chaque geste est tracé.
SET search_path = sabou, public;

ALTER TABLE plante_voix
  ADD COLUMN renvoi_motif text CHECK (char_length(renvoi_motif) <= 500),
  ADD COLUMN publie_par bigint REFERENCES utilisateur(id);
ALTER TABLE maladie_voix
  ADD COLUMN renvoi_motif text CHECK (char_length(renvoi_motif) <= 500),
  ADD COLUMN publie_par bigint REFERENCES utilisateur(id);

-- Acteur du contexte (actif)
CREATE FUNCTION voix_nom_acteur() RETURNS utilisateur LANGUAGE plpgsql STABLE AS $$
DECLARE v_usr utilisateur%ROWTYPE;
BEGIN
  SELECT * INTO v_usr FROM utilisateur WHERE id = contexte_utilisateur() AND statut = 'actif';
  IF NOT FOUND THEN RAISE EXCEPTION 'Acteur inconnu ou suspendu'; END IF;
  RETURN v_usr;
END $$;

-- Droit du compte dans la langue : enregistrer, traduire ou valider (R-GOV-06)
CREATE FUNCTION voix_nom_droit(p_usr bigint, p_langue text, p_droit text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM utilisateur_langue ul
                  WHERE ul.utilisateur_id = p_usr AND ul.langue_code = p_langue
                    AND CASE p_droit WHEN 'enregistrer' THEN ul.peut_enregistrer
                                     WHEN 'traduire'    THEN ul.peut_traduire
                                     WHEN 'valider'     THEN ul.peut_valider END)
$$;

-- Plante ou maladie visée, par son code (PL-001, MA-001)
CREATE FUNCTION voix_nom_objet(p_objet text, p_code text) RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE v_id bigint;
BEGIN
  IF p_objet = 'plante' THEN
    SELECT id INTO v_id FROM plante WHERE code = p_code;
  ELSIF p_objet = 'maladie' THEN
    SELECT id INTO v_id FROM maladie WHERE code = p_code;
  ELSE
    RAISE EXCEPTION 'Objet % inconnu', p_objet;
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Fiche % introuvable', p_code; END IF;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------
-- 1. Enregistrer (ou remplacer) la voix du nom dans une langue
-- ---------------------------------------------------------------------
CREATE FUNCTION voix_nom_enregistrer(p_objet text, p_code text, p_langue text, p_depot bigint)
RETURNS text LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act   utilisateur%ROWTYPE;
        v_id    bigint;
        v_audio bigint;
BEGIN
  v_act := voix_nom_acteur();
  IF NOT voix_nom_droit(v_act.id, p_langue, 'enregistrer') THEN
    RAISE EXCEPTION 'Droit d''enregistrer en % absent : réservé au référent de la langue', p_langue;
  END IF;
  v_id := voix_nom_objet(p_objet, p_code);
  SELECT audio_id INTO v_audio FROM voix_depot
   WHERE id = p_depot AND depose_par = v_act.id AND statut = 'traitee';
  IF v_audio IS NULL THEN
    RAISE EXCEPTION 'Voix % absente, pas encore traitée ou déposée par un autre compte', p_depot;
  END IF;
  IF p_objet = 'plante' THEN
    INSERT INTO plante_voix (plante_id, langue_code, audio_id, statut, enregistre_par)
    VALUES (v_id, p_langue, v_audio, 'brouillon', v_act.id)
    ON CONFLICT (plante_id, langue_code) DO UPDATE
      SET audio_id = EXCLUDED.audio_id, statut = 'brouillon', enregistre_par = EXCLUDED.enregistre_par,
          valideur_id = NULL, publie_par = NULL, renvoi_motif = NULL;
  ELSE
    INSERT INTO maladie_voix (maladie_id, langue_code, audio_id, statut, enregistre_par)
    VALUES (v_id, p_langue, v_audio, 'brouillon', v_act.id)
    ON CONFLICT (maladie_id, langue_code) DO UPDATE
      SET audio_id = EXCLUDED.audio_id, statut = 'brouillon', enregistre_par = EXCLUDED.enregistre_par,
          valideur_id = NULL, publie_par = NULL, renvoi_motif = NULL;
  END IF;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, p_objet || '.voix_enregistree', p_objet, p_code,
          jsonb_build_object('langue', p_langue, 'voix', v_audio));
  RETURN 'brouillon';
END $$;

-- ---------------------------------------------------------------------
-- 2. Faire avancer la voix : traduit, valide, publie, ou renvoi en brouillon (motif)
-- ---------------------------------------------------------------------
CREATE FUNCTION voix_nom_statut(p_objet text, p_code text, p_langue text, p_vers text,
                                p_motif text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act   utilisateur%ROWTYPE;
        v_id    bigint;
        v_de    text;
        v_par   bigint;
        v_motif text := nullif(btrim(p_motif), '');
BEGIN
  v_act := voix_nom_acteur();
  v_id := voix_nom_objet(p_objet, p_code);
  IF p_objet = 'plante' THEN
    SELECT statut, enregistre_par INTO v_de, v_par FROM plante_voix
     WHERE plante_id = v_id AND langue_code = p_langue FOR UPDATE;
  ELSE
    SELECT statut, enregistre_par INTO v_de, v_par FROM maladie_voix
     WHERE maladie_id = v_id AND langue_code = p_langue FOR UPDATE;
  END IF;
  IF v_de IS NULL THEN
    RAISE EXCEPTION 'Aucune voix du nom en % pour %', p_langue, p_code;
  END IF;

  IF p_vers = 'traduit' THEN
    IF v_de <> 'brouillon' THEN RAISE EXCEPTION 'Transition % → % impossible', v_de, p_vers; END IF;
    IF v_act.id <> v_par AND NOT voix_nom_droit(v_act.id, p_langue, 'traduire') THEN
      RAISE EXCEPTION 'Droit de traduire en % absent', p_langue;
    END IF;
  ELSIF p_vers = 'valide' THEN
    IF v_de <> 'traduit' THEN RAISE EXCEPTION 'Transition % → % impossible', v_de, p_vers; END IF;
    IF NOT voix_nom_droit(v_act.id, p_langue, 'valider') THEN
      RAISE EXCEPTION 'Droit de valider en % absent', p_langue;
    END IF;
    IF v_act.id = v_par THEN
      RAISE EXCEPTION 'Le valideur n''est jamais celui qui a enregistré la voix';
    END IF;
  ELSIF p_vers = 'brouillon' THEN
    IF v_de NOT IN ('traduit', 'valide') THEN
      RAISE EXCEPTION 'Transition % → % impossible', v_de, p_vers;
    END IF;
    IF NOT voix_nom_droit(v_act.id, p_langue, 'valider') THEN
      RAISE EXCEPTION 'Droit de valider en % absent', p_langue;
    END IF;
    IF v_motif IS NULL THEN RAISE EXCEPTION 'Motif du renvoi obligatoire'; END IF;
  ELSIF p_vers = 'publie' THEN
    IF v_de <> 'valide' THEN RAISE EXCEPTION 'Transition % → % impossible', v_de, p_vers; END IF;
    IF v_act.role_code <> 'dg' THEN
      RAISE EXCEPTION 'Publication réservée à la Direction Générale';
    END IF;
  ELSE
    RAISE EXCEPTION 'Statut % inconnu', p_vers;
  END IF;

  -- Le consentement est vérifié par trg_voix_publiable au passage à « publie »
  IF p_objet = 'plante' THEN
    UPDATE plante_voix
       SET statut = p_vers,
           valideur_id = CASE WHEN p_vers = 'valide' THEN v_act.id
                              WHEN p_vers = 'brouillon' THEN NULL ELSE valideur_id END,
           publie_par = CASE WHEN p_vers = 'publie' THEN v_act.id END,
           renvoi_motif = CASE WHEN p_vers = 'brouillon' THEN v_motif END
     WHERE plante_id = v_id AND langue_code = p_langue;
  ELSE
    UPDATE maladie_voix
       SET statut = p_vers,
           valideur_id = CASE WHEN p_vers = 'valide' THEN v_act.id
                              WHEN p_vers = 'brouillon' THEN NULL ELSE valideur_id END,
           publie_par = CASE WHEN p_vers = 'publie' THEN v_act.id END,
           renvoi_motif = CASE WHEN p_vers = 'brouillon' THEN v_motif END
     WHERE maladie_id = v_id AND langue_code = p_langue;
  END IF;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, p_objet || '.voix_' || p_vers, p_objet, p_code,
          jsonb_build_object('langue', p_langue, 'de', v_de, 'motif', v_motif));
  RETURN p_vers;
END $$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON plante_voix, maladie_voix FROM sabou_app;
REVOKE EXECUTE ON FUNCTION voix_nom_enregistrer(text, text, text, bigint),
  voix_nom_statut(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION voix_nom_enregistrer(text, text, text, bigint),
  voix_nom_statut(text, text, text, text, text) TO sabou_app;
