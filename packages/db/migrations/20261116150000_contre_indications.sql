-- US-063 : indiquer les contre-indications structurées (UC-21, R-REC-05).
--   - liste paramétrable par la DG (écran Référentiels) : ajout, renommage, désactivation,
--     jamais de suppression ; même forme que les spécialités (identifiant, code, libellés,
--     actif) ;
--   - le praticien les choisit au Studio (traitement_contre_indications_poser, sur son seul
--     brouillon) ; une contre-indication désactivée n'est plus proposée, mais un traitement
--     qui l'a déjà la garde ;
--   - affichées en alerte sur le traitement (Studio, file des administrateurs ; page publique
--     au sprint du site).
SET search_path = sabou, public;

-- Libellé anglais facultatif, comme pour les spécialités (repli sur le français)
ALTER TABLE contre_indication
  ADD COLUMN id smallint GENERATED ALWAYS AS IDENTITY UNIQUE,
  ADD COLUMN active boolean NOT NULL DEFAULT true,
  ALTER COLUMN libelle_en DROP NOT NULL,
  ADD CONSTRAINT ck_contre_indication_code CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  ADD CONSTRAINT ck_contre_indication_libelles
    CHECK (btrim(libelle_fr) <> '' AND char_length(libelle_fr) <= 80
           AND (libelle_en IS NULL OR (btrim(libelle_en) <> '' AND char_length(libelle_en) <= 80)));
CREATE UNIQUE INDEX ux_contre_indication_libelle ON contre_indication (f_norm(btrim(libelle_fr)));
COMMENT ON TABLE contre_indication IS
  'Contre-indications structurées, paramétrées par la DG (R-REC-05, US-063) ; désactivées, jamais supprimées.';

-- Jamais supprimée : un traitement peut y faire référence
REVOKE DELETE, TRUNCATE ON contre_indication FROM sabou_app;

-- Contre-indications d'un brouillon du praticien connecté, remplacées par la liste donnée
-- (["grossesse", …]). Une contre-indication inactive n'est acceptée que si le traitement l'a déjà.
CREATE FUNCTION traitement_contre_indications_poser(p_code text, p_codes jsonb)
RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_pra      praticien%ROWTYPE;
        v_rec      recette%ROWTYPE;
        v_inconnue text;
BEGIN
  v_pra := studio_praticien();
  SELECT * INTO v_rec FROM recette WHERE code = p_code AND praticien_id = v_pra.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_code; END IF;
  IF v_rec.statut <> 'brouillon' THEN
    RAISE EXCEPTION 'Traitement % : seul un brouillon se modifie', p_code;
  END IF;
  IF jsonb_typeof(COALESCE(p_codes, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_codes, '[]'::jsonb)) > 20 THEN
    RAISE EXCEPTION 'Contre-indications : une liste de 20 au plus';
  END IF;
  SELECT c INTO v_inconnue FROM jsonb_array_elements_text(COALESCE(p_codes, '[]'::jsonb)) c
   WHERE NOT EXISTS (SELECT 1 FROM contre_indication ci
                      WHERE ci.code = c
                        AND (ci.active OR EXISTS (SELECT 1 FROM recette_contre_indication rci
                                                   WHERE rci.recette_id = v_rec.id
                                                     AND rci.contre_indication_code = c)))
   LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Contre-indication % inconnue', v_inconnue; END IF;
  DELETE FROM recette_contre_indication WHERE recette_id = v_rec.id;
  INSERT INTO recette_contre_indication (recette_id, contre_indication_code)
  SELECT DISTINCT v_rec.id, c FROM jsonb_array_elements_text(COALESCE(p_codes, '[]'::jsonb)) c;
END $$;
REVOKE EXECUTE ON FUNCTION traitement_contre_indications_poser(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION traitement_contre_indications_poser(text, jsonb) TO sabou_app;
