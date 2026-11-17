-- US-052 : gérer les fiches maladies (UC-05, R-MAL-01, R-RCH-01).
--   - réservé à la DG et au Comité scientifique (la base le vérifie, l'API aussi) ;
--   - nom français unique (à la casse, aux accents et aux espaces près), nom anglais
--     facultatif, symptômes en français (et en anglais), dénominations (synonymes) en
--     français ou en anglais : aucun texte en langue nationale (R-LNG-02) ;
--   - les dénominations sont trouvées par la recherche sans accents (rechercher_maladie,
--     schéma initial) ;
--   - chaque création et modification est tracée au journal d'audit.
SET search_path = sabou, public;

ALTER TABLE maladie
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT ck_maladie_nom_fr CHECK (btrim(nom_fr) <> '' AND char_length(nom_fr) <= 150),
  ADD CONSTRAINT ck_maladie_nom_en
    CHECK (nom_en IS NULL OR (btrim(nom_en) <> '' AND char_length(nom_en) <= 150)),
  ADD CONSTRAINT ck_maladie_symptomes_fr
    CHECK (symptomes_fr IS NULL OR (btrim(symptomes_fr) <> '' AND char_length(symptomes_fr) <= 2000)),
  ADD CONSTRAINT ck_maladie_symptomes_en
    CHECK (symptomes_en IS NULL OR (btrim(symptomes_en) <> '' AND char_length(symptomes_en) <= 2000));
CREATE TRIGGER trg_maladie_upd BEFORE UPDATE ON maladie FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- « Paludisme » et « paludisme » sont la même maladie
CREATE UNIQUE INDEX ux_maladie_nom_fr_norm ON maladie (f_norm(btrim(nom_fr)));

ALTER TABLE maladie_denomination
  ADD CONSTRAINT ck_denomination CHECK (btrim(denomination) <> '' AND char_length(denomination) <= 150);

CREATE SEQUENCE maladie_code_seq;

-- ---------------------------------------------------------------------
-- 1. Acteur et contrôles communs
-- ---------------------------------------------------------------------
-- Même règle que les fiches plantes (US-050) : DG ou Comité, compte actif, acteur du contexte
CREATE FUNCTION maladie_acteur() RETURNS utilisateur LANGUAGE plpgsql STABLE AS $$
DECLARE v_usr utilisateur%ROWTYPE;
BEGIN
  SELECT * INTO v_usr FROM utilisateur WHERE id = contexte_utilisateur() AND statut = 'actif';
  IF NOT FOUND THEN RAISE EXCEPTION 'Acteur inconnu ou suspendu'; END IF;
  IF v_usr.role_code NOT IN ('dg','scientifique') THEN
    RAISE EXCEPTION 'Les fiches maladies sont réservées à la DG et au Comité scientifique';
  END IF;
  RETURN v_usr;
END $$;

CREATE FUNCTION maladie_nom_libre(p_nom text, p_sauf bigint) RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE v_code text;
BEGIN
  SELECT code INTO v_code FROM maladie
   WHERE f_norm(btrim(nom_fr)) = f_norm(btrim(p_nom)) AND id IS DISTINCT FROM p_sauf;
  IF FOUND THEN RAISE EXCEPTION 'Nom français déjà utilisé par la fiche %', v_code; END IF;
END $$;

-- Dénominations de la fiche remplacées par la liste donnée : [{"langue":"fr","denomination":"…"}]
-- (doublons ignorés, à la casse et aux accents près ; langue « texte » seulement : fr, en)
CREATE FUNCTION maladie_denominations_poser(p_maladie bigint, p_denominations jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_liste jsonb;
BEGIN
  IF jsonb_typeof(COALESCE(p_denominations, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_denominations, '[]'::jsonb)) > 30 THEN
    RAISE EXCEPTION 'Dénominations : une liste de 30 au plus';
  END IF;
  DELETE FROM maladie_denomination WHERE maladie_id = p_maladie;
  INSERT INTO maladie_denomination (maladie_id, langue_code, denomination)
  SELECT DISTINCT ON (d->>'langue', f_norm(btrim(d->>'denomination')))
         p_maladie, d->>'langue', btrim(d->>'denomination')
    FROM jsonb_array_elements(COALESCE(p_denominations, '[]'::jsonb)) d;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('langue', langue_code, 'denomination', denomination)
                            ORDER BY langue_code, denomination), '[]'::jsonb)
    INTO v_liste FROM maladie_denomination WHERE maladie_id = p_maladie;
  RETURN v_liste;
END $$;
REVOKE EXECUTE ON FUNCTION maladie_denominations_poser(bigint, jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------
-- 2. Créer et modifier une fiche
-- ---------------------------------------------------------------------
CREATE FUNCTION maladie_creer(p_nom_fr text, p_nom_en text, p_symptomes_fr text,
                              p_symptomes_en text, p_denominations jsonb)
RETURNS maladie LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act  utilisateur%ROWTYPE;
        v_mal  maladie%ROWTYPE;
        v_code text;
        v_den  jsonb;
BEGIN
  v_act := maladie_acteur();
  PERFORM maladie_nom_libre(p_nom_fr, NULL);
  LOOP
    v_code := 'MA-' || lpad(nextval('maladie_code_seq')::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM maladie WHERE code = v_code);
  END LOOP;
  INSERT INTO maladie (code, nom_fr, nom_en, symptomes_fr, symptomes_en)
  VALUES (v_code, btrim(p_nom_fr), nullif(btrim(p_nom_en), ''), nullif(btrim(p_symptomes_fr), ''),
          nullif(btrim(p_symptomes_en), ''))
  RETURNING * INTO v_mal;
  v_den := maladie_denominations_poser(v_mal.id, p_denominations);
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'maladie.creee', 'maladie', v_mal.code,
          jsonb_build_object('nomFr', v_mal.nom_fr, 'denominations', jsonb_array_length(v_den)));
  RETURN v_mal;
END $$;

CREATE FUNCTION maladie_modifier(p_code text, p_vue_le timestamptz, p_nom_fr text, p_nom_en text,
                                 p_symptomes_fr text, p_symptomes_en text, p_denominations jsonb)
RETURNS maladie LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act   utilisateur%ROWTYPE;
        v_avant maladie%ROWTYPE;
        v_mal   maladie%ROWTYPE;
        v_avant_den jsonb;
        v_den   jsonb;
BEGIN
  v_act := maladie_acteur();
  SELECT * INTO v_avant FROM maladie WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maladie % introuvable', p_code; END IF;
  IF date_trunc('milliseconds', v_avant.updated_at) <> date_trunc('milliseconds', p_vue_le) THEN
    RAISE EXCEPTION 'Maladie % modifiée entre-temps', p_code;
  END IF;
  PERFORM maladie_nom_libre(p_nom_fr, v_avant.id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('langue', langue_code, 'denomination', denomination)
                            ORDER BY langue_code, denomination), '[]'::jsonb)
    INTO v_avant_den FROM maladie_denomination WHERE maladie_id = v_avant.id;
  -- Mise à jour toujours faite : la date de modification avance même si seules les
  -- dénominations changent
  UPDATE maladie SET nom_fr = btrim(p_nom_fr), nom_en = nullif(btrim(p_nom_en), ''),
                     symptomes_fr = nullif(btrim(p_symptomes_fr), ''),
                     symptomes_en = nullif(btrim(p_symptomes_en), '')
   WHERE id = v_avant.id
  RETURNING * INTO v_mal;
  v_den := maladie_denominations_poser(v_mal.id, p_denominations);
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'maladie.modifiee', 'maladie', v_mal.code,
          jsonb_strip_nulls(jsonb_build_object(
            'nomFr', CASE WHEN v_avant.nom_fr <> v_mal.nom_fr
                          THEN jsonb_build_array(v_avant.nom_fr, v_mal.nom_fr) END,
            'nomEn', CASE WHEN v_avant.nom_en IS DISTINCT FROM v_mal.nom_en
                          THEN jsonb_build_array(v_avant.nom_en, v_mal.nom_en) END,
            'symptomes', CASE WHEN v_avant.symptomes_fr IS DISTINCT FROM v_mal.symptomes_fr
                                OR v_avant.symptomes_en IS DISTINCT FROM v_mal.symptomes_en
                              THEN true END,
            'denominations', CASE WHEN v_avant_den <> v_den
                                  THEN jsonb_build_array(v_avant_den, v_den) END)));
  RETURN v_mal;
END $$;

-- Les fiches et leurs dénominations ne s'écrivent que par ces fonctions
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON maladie, maladie_denomination FROM sabou_app;
REVOKE EXECUTE ON FUNCTION maladie_creer(text, text, text, text, jsonb),
  maladie_modifier(text, timestamptz, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maladie_creer(text, text, text, text, jsonb),
  maladie_modifier(text, timestamptz, text, text, text, text, jsonb) TO sabou_app;
