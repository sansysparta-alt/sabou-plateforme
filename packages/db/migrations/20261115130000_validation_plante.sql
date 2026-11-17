-- US-051 : valider une fiche plante (UC-52, R-PLA-05).
--   - seul le Comité scientifique valide une fiche « en revue » ; la validation enregistre le
--     valideur et la date, et se trace au journal d'audit ;
--   - une plante « en revue » ne peut pas entrer dans un traitement certifié : contrôle déjà
--     posé par trg_recette_publiable (schéma initial), prouvé par les tests de ce récit ;
--   - une fiche validée dont l'identité botanique change (nom scientifique ou famille, à la
--     casse et aux accents près) repasse « en revue » : la validation portait sur l'ancienne
--     identité. Ses noms français et anglais peuvent être corrigés sans perdre la validation.
SET search_path = sabou, public;

ALTER TABLE plante ADD COLUMN valide_le timestamptz;
-- Fiches validées avant ce récit (jeu d'exemple, reprise) : date inconnue, prise à la création
UPDATE plante SET valide_le = created_at WHERE statut = 'validee';
ALTER TABLE plante DROP CONSTRAINT ck_plante_validee;
ALTER TABLE plante ADD CONSTRAINT ck_plante_validee CHECK (
  (statut = 'validee') = (valide_par IS NOT NULL AND valide_le IS NOT NULL));

-- ---------------------------------------------------------------------
-- 1. Valider : Comité scientifique seulement, fiche « en revue », lue à jour
-- ---------------------------------------------------------------------
CREATE FUNCTION plante_valider(p_code text, p_vue_le timestamptz)
RETURNS plante LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act utilisateur%ROWTYPE;
        v_pla plante%ROWTYPE;
BEGIN
  v_act := plante_acteur();
  IF v_act.role_code <> 'scientifique' THEN
    RAISE EXCEPTION 'La validation d''une fiche plante est réservée au Comité scientifique';
  END IF;
  SELECT * INTO v_pla FROM plante WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plante % introuvable', p_code; END IF;
  IF date_trunc('milliseconds', v_pla.updated_at) <> date_trunc('milliseconds', p_vue_le) THEN
    RAISE EXCEPTION 'Plante % modifiée entre-temps', p_code;
  END IF;
  IF v_pla.statut = 'validee' THEN RAISE EXCEPTION 'Plante % déjà validée', p_code; END IF;
  UPDATE plante SET statut = 'validee', valide_par = v_act.id, valide_le = now()
   WHERE id = v_pla.id
  RETURNING * INTO v_pla;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'plante.validee', 'plante', v_pla.code,
          jsonb_build_object('nomScientifique', v_pla.nom_scientifique, 'famille', v_pla.famille));
  RETURN v_pla;
END $$;
COMMENT ON FUNCTION plante_valider(text, timestamptz) IS
  'Validation d''une fiche plante par le Comité scientifique (US-051, R-PLA-05) : valideur et date enregistrés.';
REVOKE EXECUTE ON FUNCTION plante_valider(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plante_valider(text, timestamptz) TO sabou_app;

-- ---------------------------------------------------------------------
-- 2. Modifier : identité botanique changée sur une fiche validée → retour « en revue »
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plante_modifier(p_code text, p_vue_le timestamptz,
                                           p_nom_scientifique text, p_famille text, p_nom_fr text,
                                           p_nom_en text DEFAULT NULL)
RETURNS plante LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act      utilisateur%ROWTYPE;
        v_avant    plante%ROWTYPE;
        v_pla      plante%ROWTYPE;
        v_identite boolean;
BEGIN
  v_act := plante_acteur();
  SELECT * INTO v_avant FROM plante WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plante % introuvable', p_code; END IF;
  IF date_trunc('milliseconds', v_avant.updated_at) <> date_trunc('milliseconds', p_vue_le) THEN
    RAISE EXCEPTION 'Plante % modifiée entre-temps', p_code;
  END IF;
  PERFORM plante_nom_libre(p_nom_scientifique, v_avant.id);
  v_identite := f_norm(btrim(v_avant.nom_scientifique)) <> f_norm(btrim(p_nom_scientifique))
             OR f_norm(btrim(v_avant.famille)) <> f_norm(btrim(p_famille));
  UPDATE plante SET nom_scientifique = btrim(p_nom_scientifique), famille = btrim(p_famille),
                    nom_fr = btrim(p_nom_fr), nom_en = nullif(btrim(p_nom_en), ''),
                    statut = CASE WHEN v_identite THEN 'en_revue' ELSE statut END,
                    valide_par = CASE WHEN v_identite THEN NULL ELSE valide_par END,
                    valide_le = CASE WHEN v_identite THEN NULL ELSE valide_le END
   WHERE id = v_avant.id
  RETURNING * INTO v_pla;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'plante.modifiee', 'plante', v_pla.code,
          jsonb_strip_nulls(jsonb_build_object(
            'nomScientifique', CASE WHEN v_avant.nom_scientifique <> v_pla.nom_scientifique
                                    THEN jsonb_build_array(v_avant.nom_scientifique, v_pla.nom_scientifique) END,
            'famille', CASE WHEN v_avant.famille <> v_pla.famille
                            THEN jsonb_build_array(v_avant.famille, v_pla.famille) END,
            'nomFr', CASE WHEN v_avant.nom_fr <> v_pla.nom_fr
                          THEN jsonb_build_array(v_avant.nom_fr, v_pla.nom_fr) END,
            'nomEn', CASE WHEN v_avant.nom_en IS DISTINCT FROM v_pla.nom_en
                          THEN jsonb_build_array(v_avant.nom_en, v_pla.nom_en) END,
            'retourEnRevue', CASE WHEN v_identite AND v_avant.statut = 'validee' THEN true END)));
  RETURN v_pla;
END $$;
