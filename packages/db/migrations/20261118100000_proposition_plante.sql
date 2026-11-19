-- US-054 : un praticien propose une plante qui manque au Dictionnaire (§6.5, §6.6).
-- Décision du maître d'œuvre du 18 novembre 2026 : le praticien saisit le nom français ; le nom
-- scientifique et la famille sont facultatifs (beaucoup de tradipraticiens ne les connaissent
-- pas), avec une description. Le Comité les complète avant de valider (US-051, US-055) :
--   - une fiche « en revue » peut n'avoir ni nom scientifique ni famille ; une fiche validée
--     les a toujours (contrainte) ;
--   - la fiche proposée garde son auteur (proposee_par) ; elle est créée « en revue » et ne
--     peut pas entrer dans un traitement certifié tant que le Comité ne l'a pas validée
--     (trg_recette_publiable, schéma initial) ;
--   - au plus 10 propositions « en revue » par praticien : une proposition abusive en série
--     est arrêtée par la base.
SET search_path = sabou, public;

ALTER TABLE plante
  ALTER COLUMN nom_scientifique DROP NOT NULL,
  ALTER COLUMN famille DROP NOT NULL,
  ADD COLUMN description text CHECK (char_length(description) <= 1000),
  ADD COLUMN proposee_par bigint REFERENCES utilisateur(id);
ALTER TABLE plante ADD CONSTRAINT ck_plante_validee_identifiee CHECK (
  statut <> 'validee' OR (nom_scientifique IS NOT NULL AND famille IS NOT NULL));
CREATE INDEX ix_plante_proposee_par ON plante (proposee_par) WHERE proposee_par IS NOT NULL;
COMMENT ON COLUMN plante.proposee_par IS
  'Praticien qui a proposé la fiche depuis l''application mobile (US-054) ; NULL si créée par la DG ou le Comité.';

-- ---------------------------------------------------------------------
-- 1. Proposer : praticien actif seulement ; fiche « en revue », auteur enregistré
-- ---------------------------------------------------------------------
CREATE FUNCTION plante_proposer(p_nom_fr text, p_nom_scientifique text DEFAULT NULL,
                                p_famille text DEFAULT NULL, p_description text DEFAULT NULL)
RETURNS plante LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act  utilisateur%ROWTYPE;
        v_pla  plante%ROWTYPE;
        v_code text;
        v_sci  text := nullif(btrim(p_nom_scientifique), '');
BEGIN
  SELECT * INTO v_act FROM utilisateur WHERE id = contexte_utilisateur() AND statut = 'actif';
  IF NOT FOUND THEN RAISE EXCEPTION 'Acteur inconnu ou suspendu'; END IF;
  IF v_act.role_code <> 'praticien' THEN
    RAISE EXCEPTION 'La proposition d''une plante est réservée aux praticiens';
  END IF;
  IF nullif(btrim(p_nom_fr), '') IS NULL THEN
    RAISE EXCEPTION 'Nom français obligatoire';
  END IF;
  IF (SELECT count(*) FROM plante WHERE proposee_par = v_act.id AND statut = 'en_revue') >= 10 THEN
    RAISE EXCEPTION 'Vous avez déjà 10 plantes en attente du Comité scientifique';
  END IF;
  IF v_sci IS NOT NULL THEN PERFORM plante_nom_libre(v_sci, NULL); END IF;
  LOOP
    v_code := 'PL-' || lpad(nextval('plante_code_seq')::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM plante WHERE code = v_code);
  END LOOP;
  INSERT INTO plante (code, nom_scientifique, famille, nom_fr, description, proposee_par)
  VALUES (v_code, v_sci, nullif(btrim(p_famille), ''), btrim(p_nom_fr),
          nullif(btrim(p_description), ''), v_act.id)
  RETURNING * INTO v_pla;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'plante.proposee', 'plante', v_pla.code,
          jsonb_strip_nulls(jsonb_build_object('nomFr', v_pla.nom_fr,
                                               'nomScientifique', v_pla.nom_scientifique)));
  RETURN v_pla;
END $$;
COMMENT ON FUNCTION plante_proposer(text, text, text, text) IS
  'Proposition d''une plante par un praticien (US-054) : fiche « en revue », auteur enregistré, 10 en attente au plus.';
REVOKE EXECUTE ON FUNCTION plante_proposer(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plante_proposer(text, text, text, text) TO sabou_app;

-- ---------------------------------------------------------------------
-- 2. Valider : message clair si l'identité botanique manque encore
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plante_valider(p_code text, p_vue_le timestamptz)
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
  IF v_pla.nom_scientifique IS NULL OR v_pla.famille IS NULL THEN
    RAISE EXCEPTION 'Plante % : complétez le nom scientifique et la famille avant de valider', p_code;
  END IF;
  UPDATE plante SET statut = 'validee', valide_par = v_act.id, valide_le = now()
   WHERE id = v_pla.id
  RETURNING * INTO v_pla;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'plante.validee', 'plante', v_pla.code,
          jsonb_build_object('nomScientifique', v_pla.nom_scientifique, 'famille', v_pla.famille));
  RETURN v_pla;
END $$;

-- ---------------------------------------------------------------------
-- 3. Modifier : la DG ou le Comité complètent une fiche proposée (anciennes valeurs NULL
--    comprises dans le journal)
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
  v_identite := f_norm(btrim(v_avant.nom_scientifique)) IS DISTINCT FROM f_norm(btrim(p_nom_scientifique))
             OR f_norm(btrim(v_avant.famille)) IS DISTINCT FROM f_norm(btrim(p_famille));
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
            'nomScientifique', CASE WHEN v_avant.nom_scientifique IS DISTINCT FROM v_pla.nom_scientifique
                                    THEN jsonb_build_array(v_avant.nom_scientifique, v_pla.nom_scientifique) END,
            'famille', CASE WHEN v_avant.famille IS DISTINCT FROM v_pla.famille
                            THEN jsonb_build_array(v_avant.famille, v_pla.famille) END,
            'nomFr', CASE WHEN v_avant.nom_fr <> v_pla.nom_fr
                          THEN jsonb_build_array(v_avant.nom_fr, v_pla.nom_fr) END,
            'nomEn', CASE WHEN v_avant.nom_en IS DISTINCT FROM v_pla.nom_en
                          THEN jsonb_build_array(v_avant.nom_en, v_pla.nom_en) END,
            'retourEnRevue', CASE WHEN v_identite AND v_avant.statut = 'validee' THEN true END)));
  RETURN v_pla;
END $$;
