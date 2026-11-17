-- US-064 : annoter un traitement ou une plante (UC-51, R-MOD-10).
--   - annotation datée, avec un avis (favorable, réserve, défavorable) et un texte, écrite par
--     un membre du Comité scientifique (annotation_ajouter, SECURITY DEFINER) ;
--   - jamais modifiée ni effacée : c'est l'historique des avis ;
--   - lue par le Comité et la DG seulement (RLS) ; historique consultable par la DG.
SET search_path = sabou, public;

-- Avis obligatoire pour toute annotation nouvelle ; les annotations d'avant ce récit sont
-- gardées telles quelles (NOT VALID)
ALTER TABLE annotation_comite
  ADD CONSTRAINT ck_annotation_avis CHECK (avis IS NOT NULL) NOT VALID,
  ADD CONSTRAINT ck_annotation_contenu
    CHECK (btrim(contenu) <> '' AND char_length(contenu) <= 2000) NOT VALID;
CREATE INDEX ix_annotation_auteur ON annotation_comite (auteur_id);

ALTER TABLE annotation_comite ENABLE ROW LEVEL SECURITY;
CREATE POLICY comite_dg ON annotation_comite FOR SELECT TO sabou_app
  USING (contexte_role() IN ('scientifique', 'dg'));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON annotation_comite FROM sabou_app;

-- p_type : « recette » ou « plante » ; p_code : REC-… ou PL-…
CREATE FUNCTION annotation_ajouter(p_type text, p_code text, p_avis text, p_contenu text)
RETURNS annotation_comite LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_usr  utilisateur%ROWTYPE;
        v_id   bigint;
        v_ann  annotation_comite%ROWTYPE;
BEGIN
  SELECT * INTO v_usr FROM utilisateur WHERE id = contexte_utilisateur() AND statut = 'actif';
  IF NOT FOUND OR v_usr.role_code <> 'scientifique' THEN
    RAISE EXCEPTION 'Les annotations sont réservées au Comité scientifique'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_type = 'recette' THEN
    SELECT id INTO v_id FROM recette WHERE code = p_code;
  ELSIF p_type = 'plante' THEN
    SELECT id INTO v_id FROM plante WHERE code = p_code;
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Objet % % introuvable', p_type, p_code; END IF;
  INSERT INTO annotation_comite (objet_type, objet_id, auteur_id, contenu, avis)
  VALUES (p_type, v_id, v_usr.id, btrim(p_contenu), p_avis)
  RETURNING * INTO v_ann;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr.id, 'annotation.ajoutee', p_type, p_code, jsonb_build_object('avis', p_avis));
  RETURN v_ann;
END $$;
REVOKE EXECUTE ON FUNCTION annotation_ajouter(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION annotation_ajouter(text, text, text, text) TO sabou_app;
