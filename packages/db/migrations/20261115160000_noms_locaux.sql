-- US-053 : saisir les noms locaux d'une plante, transcription et voix (UC-12, R-PLA-03,
-- R-LNG-13, R-GOV-06).
--   - le « référent linguistique » d'une langue est le compte qui a le droit d'y enregistrer
--     (utilisateur_langue.peut_enregistrer, attribué par la DG dans la gestion des comptes) ;
--   - plusieurs noms par langue, un seul principal : le premier nom d'une langue l'est
--     d'office ; si le principal est retiré, le suivant le devient ;
--   - la transcription (alphabet latin, plusieurs orthographes possibles) sert à la recherche
--     seulement, jamais à l'affichage public (R-LNG-02, R-LNG-13) ; la voix est celle d'un
--     dépôt traité (US-070) par le même compte ;
--   - chaque ajout, changement de principal et retrait est tracé au journal d'audit.
SET search_path = sabou, public;

ALTER TABLE plante_nom_local
  ADD COLUMN cree_par bigint REFERENCES utilisateur(id),
  ADD COLUMN cree_le timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT ck_nom_local_transcription
    CHECK (btrim(transcription_recherche) <> '' AND char_length(transcription_recherche) <= 100);
-- Même nom à la casse et aux accents près : un seul (« Kignè » et « kigne »)
CREATE UNIQUE INDEX ux_nom_local_norm
  ON plante_nom_local (plante_id, langue_code, f_norm(btrim(transcription_recherche)));

-- Acteur du contexte, avec le droit d'enregistrer dans la langue
CREATE FUNCTION nom_local_acteur(p_langue text) RETURNS utilisateur LANGUAGE plpgsql STABLE AS $$
DECLARE v_usr utilisateur%ROWTYPE;
BEGIN
  SELECT * INTO v_usr FROM utilisateur WHERE id = contexte_utilisateur() AND statut = 'actif';
  IF NOT FOUND THEN RAISE EXCEPTION 'Acteur inconnu ou suspendu'; END IF;
  IF NOT EXISTS (SELECT 1 FROM utilisateur_langue ul
                  WHERE ul.utilisateur_id = v_usr.id AND ul.langue_code = p_langue
                    AND ul.peut_enregistrer) THEN
    RAISE EXCEPTION 'Droit d''enregistrer en % absent : réservé au référent de la langue', p_langue;
  END IF;
  RETURN v_usr;
END $$;

-- ---------------------------------------------------------------------
-- 1. Ajouter un nom local (avec ou sans voix)
-- ---------------------------------------------------------------------
CREATE FUNCTION plante_nom_local_ajouter(p_plante text, p_langue text, p_transcription text,
                                         p_principal boolean, p_depot bigint DEFAULT NULL)
RETURNS plante_nom_local LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act   utilisateur%ROWTYPE;
        v_pla   plante%ROWTYPE;
        v_audio bigint;
        v_princ boolean;
        v_nom   plante_nom_local%ROWTYPE;
BEGIN
  v_act := nom_local_acteur(p_langue);
  SELECT * INTO v_pla FROM plante WHERE code = p_plante FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plante % introuvable', p_plante; END IF;
  IF p_depot IS NOT NULL THEN
    SELECT audio_id INTO v_audio FROM voix_depot
     WHERE id = p_depot AND depose_par = v_act.id AND statut = 'traitee';
    IF v_audio IS NULL THEN
      RAISE EXCEPTION 'Voix % absente, pas encore traitée ou déposée par un autre compte', p_depot;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM plante_nom_local n
              WHERE n.plante_id = v_pla.id AND n.langue_code = p_langue
                AND f_norm(btrim(n.transcription_recherche)) = f_norm(btrim(p_transcription))) THEN
    RAISE EXCEPTION 'Nom local déjà saisi pour cette plante et cette langue';
  END IF;
  v_princ := p_principal OR NOT EXISTS (
    SELECT 1 FROM plante_nom_local n WHERE n.plante_id = v_pla.id AND n.langue_code = p_langue);
  IF v_princ THEN
    UPDATE plante_nom_local SET principal = false
     WHERE plante_id = v_pla.id AND langue_code = p_langue AND principal;
  END IF;
  INSERT INTO plante_nom_local (plante_id, langue_code, transcription_recherche, audio_id, principal,
                                cree_par)
  VALUES (v_pla.id, p_langue, btrim(p_transcription), v_audio, v_princ, v_act.id)
  RETURNING * INTO v_nom;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'plante.nom_local_ajoute', 'plante', v_pla.code,
          jsonb_build_object('nom', v_nom.id, 'langue', p_langue, 'principal', v_princ,
                             'voix', v_audio));
  RETURN v_nom;
END $$;

-- ---------------------------------------------------------------------
-- 2. Changer le nom principal d'une langue, retirer un nom
-- ---------------------------------------------------------------------
CREATE FUNCTION plante_nom_local_principal(p_nom bigint)
RETURNS plante_nom_local LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act utilisateur%ROWTYPE;
        v_nom plante_nom_local%ROWTYPE;
BEGIN
  SELECT * INTO v_nom FROM plante_nom_local WHERE id = p_nom FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nom local % introuvable', p_nom; END IF;
  v_act := nom_local_acteur(v_nom.langue_code);
  UPDATE plante_nom_local SET principal = false
   WHERE plante_id = v_nom.plante_id AND langue_code = v_nom.langue_code AND principal;
  UPDATE plante_nom_local SET principal = true WHERE id = p_nom RETURNING * INTO v_nom;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'plante.nom_local_principal', 'plante',
          (SELECT code FROM plante WHERE id = v_nom.plante_id),
          jsonb_build_object('nom', v_nom.id, 'langue', v_nom.langue_code));
  RETURN v_nom;
END $$;

CREATE FUNCTION plante_nom_local_retirer(p_nom bigint)
RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act utilisateur%ROWTYPE;
        v_nom plante_nom_local%ROWTYPE;
BEGIN
  SELECT * INTO v_nom FROM plante_nom_local WHERE id = p_nom FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nom local % introuvable', p_nom; END IF;
  v_act := nom_local_acteur(v_nom.langue_code);
  DELETE FROM plante_nom_local WHERE id = p_nom;
  -- Le principal retiré : le plus ancien des autres noms de la langue le remplace
  IF v_nom.principal THEN
    UPDATE plante_nom_local SET principal = true
     WHERE id = (SELECT id FROM plante_nom_local
                  WHERE plante_id = v_nom.plante_id AND langue_code = v_nom.langue_code
                  ORDER BY cree_le, id LIMIT 1);
  END IF;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'plante.nom_local_retire', 'plante',
          (SELECT code FROM plante WHERE id = v_nom.plante_id),
          jsonb_build_object('nom', v_nom.id, 'langue', v_nom.langue_code,
                             'transcription', v_nom.transcription_recherche));
END $$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON plante_nom_local FROM sabou_app;
REVOKE EXECUTE ON FUNCTION plante_nom_local_ajouter(text, text, text, boolean, bigint),
  plante_nom_local_principal(bigint), plante_nom_local_retirer(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plante_nom_local_ajouter(text, text, text, boolean, bigint),
  plante_nom_local_principal(bigint), plante_nom_local_retirer(bigint) TO sabou_app;
