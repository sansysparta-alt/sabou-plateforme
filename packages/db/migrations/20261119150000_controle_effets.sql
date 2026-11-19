-- US-073 : contrôler la voix des effets indésirables dans chaque langue (UC-53, R-LNG-12,
-- R-GOV-04).
--   - un membre du Comité scientifique écoute la voix validée de la section « effets
--     indésirables et contre-indications » et vérifie qu'elle rend fidèlement le texte
--     français ; il la contrôle (date et auteur notés) ou la renvoie en brouillon avec un motif ;
--   - sans ce contrôle, la voix ne peut pas être publiée : trg_voix_publiable (schéma initial)
--     le refuse, quel que soit le chemin d'écriture ;
--   - un seul membre du Comité suffit (décision du maître d'œuvre du 12 novembre 2026).
SET search_path = sabou, public;

CREATE FUNCTION traitement_voix_controler(p_code text, p_langue text, p_accepte boolean,
                                          p_motif text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act   utilisateur%ROWTYPE;
        v_c     record;
        v_v     recette_section_voix%ROWTYPE;
        v_motif text := nullif(btrim(p_motif), '');
BEGIN
  v_act := voix_nom_acteur();
  IF v_act.role_code <> 'scientifique' THEN
    RAISE EXCEPTION 'Contrôle réservé au Comité scientifique';
  END IF;
  v_c := traitement_section_cible(p_code, 'effets_indesirables');
  SELECT * INTO v_v FROM recette_section_voix
   WHERE section_id = v_c.section_id AND langue_code = p_langue FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aucune voix en % pour cette section', p_langue; END IF;
  IF v_v.statut <> 'valide' OR v_v.controle_comite_par IS NOT NULL THEN
    RAISE EXCEPTION 'Transition % → contrôle impossible', v_v.statut;
  END IF;
  IF NOT p_accepte AND v_motif IS NULL THEN RAISE EXCEPTION 'Motif du renvoi obligatoire'; END IF;
  IF char_length(v_motif) > 500 THEN RAISE EXCEPTION 'Motif : 500 caractères au plus'; END IF;

  IF p_accepte THEN
    UPDATE recette_section_voix SET controle_comite_par = v_act.id, controle_comite_le = now()
     WHERE section_id = v_c.section_id AND langue_code = p_langue;
  ELSE
    UPDATE recette_section_voix
       SET statut = 'brouillon', valideur_id = NULL, traducteur_id = NULL, renvoi_motif = v_motif
     WHERE section_id = v_c.section_id AND langue_code = p_langue;
  END IF;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, CASE WHEN p_accepte THEN 'recette.voix_controlee' ELSE 'recette.voix_brouillon' END,
          'recette', p_code,
          jsonb_build_object('section', 'effets_indesirables', 'langue', p_langue, 'motif', v_motif));
  RETURN CASE WHEN p_accepte THEN 'controle' ELSE 'brouillon' END;
END $$;

REVOKE EXECUTE ON FUNCTION traitement_voix_controler(text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION traitement_voix_controler(text, text, boolean, text) TO sabou_app;
