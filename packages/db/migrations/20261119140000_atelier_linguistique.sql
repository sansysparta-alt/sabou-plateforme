-- US-072 : valider les voix de sa langue dans l'atelier linguistique (UC-41, R-GOV-03,
-- R-GOV-06, R-GOV-07, R-LNG-10).
--   - l'administrateur régional de la région du praticien, avec le droit de valider dans la
--     langue, écoute la voix envoyée (« traduit ») et la compare au texte français ;
--   - il la valide, ou la renvoie en brouillon avec un motif (aussi une voix déjà validée) ;
--   - le valideur n'est jamais celui qui a enregistré ni celui qui a envoyé la voix ;
--   - la DG, de zone nationale, peut aussi valider dans les langues où elle en a le droit
--     (par exemple le français, qu'aucune région n'a pour langue).
-- La file du régional ne montre que les voix de ses langues et de sa région (critère).
SET search_path = sabou, public;

CREATE FUNCTION traitement_voix_valider(p_code text, p_type text, p_langue text,
                                        p_accepte boolean, p_motif text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act   utilisateur%ROWTYPE;
        v_c     record;
        v_v     recette_section_voix%ROWTYPE;
        v_motif text := nullif(btrim(p_motif), '');
        v_vers  text := CASE WHEN p_accepte THEN 'valide' ELSE 'brouillon' END;
BEGIN
  v_act := voix_nom_acteur();
  v_c := traitement_section_cible(p_code, p_type);
  IF NOT ((v_act.role_code = 'regional' AND v_act.region_admin_id IS NOT DISTINCT FROM v_c.region_id)
          OR v_act.role_code = 'dg')
     OR NOT voix_nom_droit(v_act.id, p_langue, 'valider') THEN
    RAISE EXCEPTION 'Droit de valider en % absent pour ce traitement', p_langue;
  END IF;
  SELECT * INTO v_v FROM recette_section_voix
   WHERE section_id = v_c.section_id AND langue_code = p_langue FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aucune voix en % pour cette section', p_langue; END IF;
  IF (p_accepte AND v_v.statut <> 'traduit')
     OR (NOT p_accepte AND v_v.statut NOT IN ('traduit', 'valide')) THEN
    RAISE EXCEPTION 'Transition % → % impossible', v_v.statut, v_vers;
  END IF;
  IF v_act.id = v_v.enregistre_par OR v_act.id IS NOT DISTINCT FROM v_v.traducteur_id THEN
    RAISE EXCEPTION 'Le valideur n''est jamais celui qui a enregistré ou envoyé la voix';
  END IF;
  IF NOT p_accepte AND v_motif IS NULL THEN RAISE EXCEPTION 'Motif du renvoi obligatoire'; END IF;
  IF char_length(v_motif) > 500 THEN RAISE EXCEPTION 'Motif : 500 caractères au plus'; END IF;

  IF p_accepte THEN
    UPDATE recette_section_voix SET statut = 'valide', valideur_id = v_act.id, renvoi_motif = NULL
     WHERE section_id = v_c.section_id AND langue_code = p_langue;
  ELSE
    UPDATE recette_section_voix
       SET statut = 'brouillon', valideur_id = NULL, traducteur_id = NULL,
           controle_comite_par = NULL, controle_comite_le = NULL, renvoi_motif = v_motif
     WHERE section_id = v_c.section_id AND langue_code = p_langue;
  END IF;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'recette.voix_' || v_vers, 'recette', p_code,
          jsonb_build_object('section', p_type, 'langue', p_langue, 'de', v_v.statut,
                             'motif', v_motif));
  RETURN v_vers;
END $$;

REVOKE EXECUTE ON FUNCTION traitement_voix_valider(text, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION traitement_voix_valider(text, text, text, boolean, text) TO sabou_app;
