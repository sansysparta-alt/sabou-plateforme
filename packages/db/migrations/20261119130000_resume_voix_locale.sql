-- US-075 : résumer une recette en français et enregistrer la voix locale (UC-33, R-GOV-02,
-- R-GOV-06, R-LNG-10, décision du maître d'œuvre du 19 novembre 2026).
--   - l'administrateur préfectoral de la préfecture du praticien révise le texte français de
--     chaque section tant que le traitement est « soumis », donc avant l'expertise du Comité ;
--     le texte d'origine est gardé dans recette_section_revision ;
--   - il enregistre la voix de chaque section dans une langue où il a le droit d'enregistrer,
--     à tout moment sauf sur un traitement retiré ; la voix est en brouillon ;
--   - il l'envoie à l'administrateur régional de la langue (brouillon → traduit) : celui qui
--     l'a enregistrée, ou un préfectoral de la même préfecture qui a le droit de traduire ;
--   - un texte français modifié (révision, ou Studio du praticien après un renvoi) ramène les
--     voix de la section en brouillon : elles ne disent peut-être plus la même chose.
-- La validation (US-072), le contrôle du Comité (US-073) et la publication (US-074) suivent.
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Voix des sections : motif du renvoi, auteur de la publication, cloisonnement
-- ---------------------------------------------------------------------
ALTER TABLE recette_section_voix
  ADD COLUMN renvoi_motif text CHECK (char_length(renvoi_motif) <= 500),
  ADD COLUMN publie_par bigint REFERENCES utilisateur(id);

-- Visible si sa section l'est (règle du traitement : zone, ou certifié et public)
ALTER TABLE recette_section_voix ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON recette_section_voix TO sabou_app
  USING (EXISTS (SELECT 1 FROM recette_section s WHERE s.id = recette_section_voix.section_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON recette_section_voix FROM sabou_app;

-- ---------------------------------------------------------------------
-- 2. Historique des révisions du texte français
-- ---------------------------------------------------------------------
CREATE TABLE recette_section_revision (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  section_id     bigint NOT NULL REFERENCES recette_section(id) ON DELETE CASCADE,
  texte_fr_avant text   NOT NULL,
  texte_en_avant text,
  texte_fr       text   NOT NULL,
  texte_en       text,
  revise_par     bigint NOT NULL REFERENCES utilisateur(id),
  revise_le      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_section_revision ON recette_section_revision (section_id, revise_le);
COMMENT ON TABLE recette_section_revision IS
  'Révisions du texte français d''une section par le préfectoral (US-075) ; le texte d''origine reste consultable.';
ALTER TABLE recette_section_revision ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON recette_section_revision TO sabou_app
  USING (EXISTS (SELECT 1 FROM recette_section s WHERE s.id = recette_section_revision.section_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON recette_section_revision FROM sabou_app;

-- ---------------------------------------------------------------------
-- 3. Texte modifié : les voix de la section reviennent en brouillon
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_section_texte_modifie() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.texte_fr IS DISTINCT FROM OLD.texte_fr THEN
    UPDATE recette_section_voix
       SET statut = 'brouillon', traducteur_id = NULL, valideur_id = NULL, publie_par = NULL,
           controle_comite_par = NULL, controle_comite_le = NULL,
           renvoi_motif = 'Texte français modifié : voix à vérifier'
     WHERE section_id = NEW.id AND statut <> 'brouillon';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_section_texte_modifie AFTER UPDATE OF texte_fr ON recette_section
  FOR EACH ROW EXECUTE FUNCTION trg_section_texte_modifie();

-- ---------------------------------------------------------------------
-- 4. Studio : les sections sont mises à jour sur place (leurs voix sont gardées)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION traitement_enregistrer(p_code text, p_vue_le timestamptz, p_donnees jsonb)
RETURNS text LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_pra      praticien%ROWTYPE;
        v_rec      recette%ROWTYPE;
        v_maladie  bigint;
        v_code     text;
        v_consent  boolean := COALESCE((p_donnees->>'consentement')::boolean, false);
        v_visib    text := nullif(p_donnees->>'visibilite', '');
        v_plantes  jsonb := COALESCE(p_donnees->'plantes', '[]'::jsonb);
        v_sections jsonb := COALESCE(p_donnees->'sections', '[]'::jsonb);
        v_inconnue text;
BEGIN
  v_pra := studio_praticien();
  SELECT id INTO v_maladie FROM maladie WHERE code = p_donnees->>'maladie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Maladie % introuvable', p_donnees->>'maladie'; END IF;
  IF jsonb_typeof(v_plantes) <> 'array' OR jsonb_array_length(v_plantes) > 15 THEN
    RAISE EXCEPTION 'Plantes : une liste de 15 au plus';
  END IF;
  IF jsonb_typeof(v_sections) <> 'array' THEN RAISE EXCEPTION 'Sections : une liste'; END IF;
  SELECT x->>'plante' INTO v_inconnue FROM jsonb_array_elements(v_plantes) x
   WHERE NOT EXISTS (SELECT 1 FROM plante pl WHERE pl.code = x->>'plante') LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Plante % introuvable', v_inconnue; END IF;
  IF (SELECT count(DISTINCT x->>'plante') FROM jsonb_array_elements(v_plantes) x)
     <> jsonb_array_length(v_plantes) THEN
    RAISE EXCEPTION 'Une plante figure deux fois dans le traitement';
  END IF;
  SELECT x->>'type' INTO v_inconnue FROM jsonb_array_elements(v_sections) x
   WHERE NOT EXISTS (SELECT 1 FROM section_type t WHERE t.code = x->>'type') LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Section % inconnue', v_inconnue; END IF;
  IF v_consent AND (v_visib IS NULL OR v_visib NOT IN ('publique','restreinte','privee')) THEN
    RAISE EXCEPTION 'Niveau de visibilité à choisir avec le consentement';
  END IF;

  IF p_code IS NULL THEN
    LOOP
      v_code := 'REC-' || lpad(nextval('recette_code_seq')::text, 4, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM recette WHERE code = v_code);
    END LOOP;
    INSERT INTO recette (code, praticien_id, maladie_id, titre_fr, visibilite)
    VALUES (v_code, v_pra.id, v_maladie, btrim(p_donnees->>'titreFr'), COALESCE(v_visib, 'privee'))
    RETURNING * INTO v_rec;
  ELSE
    SELECT * INTO v_rec FROM recette WHERE code = p_code AND praticien_id = v_pra.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_code; END IF;
    IF v_rec.statut <> 'brouillon' THEN
      RAISE EXCEPTION 'Traitement % : seul un brouillon se modifie', p_code;
    END IF;
    IF p_vue_le IS NULL OR date_trunc('milliseconds', v_rec.updated_at) <> date_trunc('milliseconds', p_vue_le) THEN
      RAISE EXCEPTION 'Traitement % modifié entre-temps', p_code;
    END IF;
  END IF;

  UPDATE recette SET
      maladie_id            = v_maladie,
      titre_fr              = btrim(p_donnees->>'titreFr'),
      titre_en              = nullif(btrim(p_donnees->>'titreEn'), ''),
      cycle_duree_jours     = (p_donnees->>'cycleDureeJours')::smallint,
      cycle_prises_par_jour = (p_donnees->>'cyclePrisesParJour')::smallint,
      cycle_pause_jours     = (p_donnees->>'cyclePauseJours')::smallint,
      visibilite            = COALESCE(v_visib, visibilite),
      consentement_le       = CASE WHEN v_consent THEN COALESCE(consentement_le, now()) END
   WHERE id = v_rec.id;

  DELETE FROM recette_plante WHERE recette_id = v_rec.id;
  INSERT INTO recette_plante (recette_id, plante_id, ordre, partie_utilisee)
  SELECT v_rec.id, pl.id, x.n, nullif(btrim(x.e->>'partie'), '')
    FROM jsonb_array_elements(v_plantes) WITH ORDINALITY AS x(e, n)
    JOIN plante pl ON pl.code = x.e->>'plante';

  -- Sections gardées (et leurs voix) : seules celles retirées ou vidées sont supprimées ; un
  -- texte modifié ramène ses voix en brouillon (trg_section_texte_modifie)
  DELETE FROM recette_section s
   WHERE s.recette_id = v_rec.id
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_sections) x
                      WHERE x->>'type' = s.type_code AND btrim(COALESCE(x->>'texteFr', '')) <> '');
  INSERT INTO recette_section (recette_id, type_code, texte_fr, texte_en)
  SELECT DISTINCT ON (x->>'type') v_rec.id, x->>'type', btrim(x->>'texteFr'), nullif(btrim(x->>'texteEn'), '')
    FROM jsonb_array_elements(v_sections) x
   WHERE btrim(COALESCE(x->>'texteFr', '')) <> ''
  ON CONFLICT (recette_id, type_code) DO UPDATE
     SET texte_fr = EXCLUDED.texte_fr, texte_en = EXCLUDED.texte_en
   WHERE recette_section.texte_fr IS DISTINCT FROM EXCLUDED.texte_fr
      OR recette_section.texte_en IS DISTINCT FROM EXCLUDED.texte_en;

  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (contexte_utilisateur(), CASE WHEN p_code IS NULL THEN 'recette.creee' ELSE 'recette.modifiee' END,
          'recette', v_rec.code,
          jsonb_build_object('plantes', jsonb_array_length(v_plantes), 'consentement', v_consent));
  RETURN v_rec.code;
END $$;

-- Soumission (UC-21 étape 5, R-REC-07) ; praticien pas encore certifié : traitement joint à

-- ---------------------------------------------------------------------
-- 5. Section visée, avec la zone de son praticien
-- ---------------------------------------------------------------------
-- Section d'un traitement (code REC-…, type de section) ; les fonctions qui l'appellent
-- s'exécutent avec les droits du propriétaire et contrôlent elles-mêmes la zone de l'acteur
CREATE FUNCTION traitement_section_cible(p_code text, p_type text,
                                         OUT recette_id bigint, OUT recette_statut text,
                                         OUT prefecture_id smallint, OUT region_id smallint,
                                         OUT section_id bigint)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  SELECT r.id, r.statut, p.prefecture_id, pf.region_admin_id, s.id
    INTO recette_id, recette_statut, prefecture_id, region_id, section_id
    FROM recette r
    JOIN praticien p ON p.id = r.praticien_id
    JOIN prefecture pf ON pf.id = p.prefecture_id
    LEFT JOIN recette_section s ON s.recette_id = r.id AND s.type_code = p_type
   WHERE r.code = p_code;
  IF recette_id IS NULL THEN RAISE EXCEPTION 'Traitement % introuvable', p_code; END IF;
  IF section_id IS NULL THEN RAISE EXCEPTION 'Section % absente du traitement %', p_type, p_code; END IF;
END $$;

-- Préfectoral de la préfecture du praticien
CREATE FUNCTION traitement_prefectoral_de(p_act utilisateur, p_prefecture smallint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_act.role_code = 'prefectoral' AND p_act.prefecture_id IS NOT DISTINCT FROM p_prefecture
$$;

-- ---------------------------------------------------------------------
-- 6. Réviser le texte français d'une section (traitement soumis)
-- ---------------------------------------------------------------------
CREATE FUNCTION traitement_section_reviser(p_code text, p_type text, p_texte_fr text,
                                           p_texte_en text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act utilisateur%ROWTYPE;
        v_c   record;
        v_sec recette_section%ROWTYPE;
        v_fr  text := btrim(COALESCE(p_texte_fr, ''));
        v_en  text := nullif(btrim(p_texte_en), '');
BEGIN
  v_act := voix_nom_acteur();
  v_c := traitement_section_cible(p_code, p_type);
  IF NOT traitement_prefectoral_de(v_act, v_c.prefecture_id) THEN
    RAISE EXCEPTION 'Révision réservée à l''administrateur préfectoral de la préfecture du praticien';
  END IF;
  IF v_c.recette_statut <> 'soumise' THEN
    RAISE EXCEPTION 'Traitement % : le texte se révise seulement quand il est soumis', p_code;
  END IF;
  IF v_fr = '' OR char_length(v_fr) > 4000 OR char_length(v_en) > 4000 THEN
    RAISE EXCEPTION 'Texte de la section : 1 à 4000 caractères';
  END IF;
  SELECT * INTO v_sec FROM recette_section WHERE id = v_c.section_id FOR UPDATE;
  IF v_sec.texte_fr = v_fr AND v_sec.texte_en IS NOT DISTINCT FROM v_en THEN
    RETURN false;   -- rien à réviser
  END IF;
  INSERT INTO recette_section_revision (section_id, texte_fr_avant, texte_en_avant, texte_fr,
                                        texte_en, revise_par)
  VALUES (v_sec.id, v_sec.texte_fr, v_sec.texte_en, v_fr, v_en, v_act.id);
  UPDATE recette_section SET texte_fr = v_fr, texte_en = v_en WHERE id = v_sec.id;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'recette.section_revisee', 'recette', p_code,
          jsonb_build_object('section', p_type));
  RETURN true;
END $$;

-- ---------------------------------------------------------------------
-- 7. Enregistrer (ou remplacer) la voix d'une section dans une langue
-- ---------------------------------------------------------------------
CREATE FUNCTION traitement_voix_enregistrer(p_code text, p_type text, p_langue text, p_depot bigint)
RETURNS text LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act   utilisateur%ROWTYPE;
        v_c     record;
        v_audio bigint;
BEGIN
  v_act := voix_nom_acteur();
  v_c := traitement_section_cible(p_code, p_type);
  IF NOT traitement_prefectoral_de(v_act, v_c.prefecture_id) THEN
    RAISE EXCEPTION 'Enregistrement réservé à l''administrateur préfectoral de la préfecture du praticien';
  END IF;
  IF NOT voix_nom_droit(v_act.id, p_langue, 'enregistrer') THEN
    RAISE EXCEPTION 'Droit d''enregistrer en % absent', p_langue;
  END IF;
  IF v_c.recette_statut = 'retiree' THEN
    RAISE EXCEPTION 'Traitement % retiré : plus d''enregistrement', p_code;
  END IF;
  SELECT audio_id INTO v_audio FROM voix_depot
   WHERE id = p_depot AND depose_par = v_act.id AND statut = 'traitee';
  IF v_audio IS NULL THEN
    RAISE EXCEPTION 'Voix % absente, pas encore traitée ou déposée par un autre compte', p_depot;
  END IF;
  INSERT INTO recette_section_voix (section_id, langue_code, audio_id, statut, enregistre_par)
  VALUES (v_c.section_id, p_langue, v_audio, 'brouillon', v_act.id)
  ON CONFLICT (section_id, langue_code) DO UPDATE
    SET audio_id = EXCLUDED.audio_id, statut = 'brouillon', enregistre_par = EXCLUDED.enregistre_par,
        traducteur_id = NULL, valideur_id = NULL, publie_par = NULL, renvoi_motif = NULL,
        controle_comite_par = NULL, controle_comite_le = NULL;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'recette.voix_enregistree', 'recette', p_code,
          jsonb_build_object('section', p_type, 'langue', p_langue, 'voix', v_audio));
  RETURN 'brouillon';
END $$;

-- ---------------------------------------------------------------------
-- 8. Envoyer la voix à l'administrateur régional de la langue (brouillon → traduit)
-- ---------------------------------------------------------------------
CREATE FUNCTION traitement_voix_envoyer(p_code text, p_type text, p_langue text)
RETURNS text LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act utilisateur%ROWTYPE;
        v_c   record;
        v_v   recette_section_voix%ROWTYPE;
BEGIN
  v_act := voix_nom_acteur();
  v_c := traitement_section_cible(p_code, p_type);
  SELECT * INTO v_v FROM recette_section_voix
   WHERE section_id = v_c.section_id AND langue_code = p_langue FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aucune voix en % pour cette section', p_langue; END IF;
  IF v_v.statut <> 'brouillon' THEN
    RAISE EXCEPTION 'Transition % → traduit impossible', v_v.statut;
  END IF;
  IF NOT traitement_prefectoral_de(v_act, v_c.prefecture_id)
     OR (v_act.id <> v_v.enregistre_par AND NOT voix_nom_droit(v_act.id, p_langue, 'traduire')) THEN
    RAISE EXCEPTION 'Droit de traduire en % absent', p_langue;
  END IF;
  UPDATE recette_section_voix
     SET statut = 'traduit', traducteur_id = v_act.id, renvoi_motif = NULL
   WHERE section_id = v_c.section_id AND langue_code = p_langue;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'recette.voix_traduit', 'recette', p_code,
          jsonb_build_object('section', p_type, 'langue', p_langue));
  RETURN 'traduit';
END $$;

REVOKE EXECUTE ON FUNCTION traitement_section_reviser(text, text, text, text),
  traitement_voix_enregistrer(text, text, text, bigint),
  traitement_voix_envoyer(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION traitement_section_reviser(text, text, text, text),
  traitement_voix_enregistrer(text, text, text, bigint),
  traitement_voix_envoyer(text, text, text) TO sabou_app;
