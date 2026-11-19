-- US-082 : l'admin préfectoral numérise sur le terrain la recette orale d'un praticien (UC-32,
-- R-GOV-02), décisions du maître d'œuvre du 19 novembre 2026 :
--   - la recette est rangée au nom du praticien et paraît dans son Studio ; elle porte la
--     mention de l'agent qui l'a saisie (recette.saisi_par, posée par la base, jamais par le
--     client, jamais modifiée) ;
--   - l'agent passe par les mêmes fonctions que le Studio du praticien : l'API désigne le
--     praticien pour la transaction (paramètre sabou.numerisation_praticien) et
--     studio_praticien() vérifie que l'agent est le préfectoral actif de la préfecture de ce
--     praticien ; une seule source de règles (brouillon, sections, voix, soumission, hors
--     réseau) ;
--   - l'accord du praticien (consentement) est coché par l'agent avant toute voix : règle
--     existante du dépôt des voix (US-081) ;
--   - celui qui enregistre ne vérifie pas : pendant « soumis », l'agent auteur ne révise pas le
--     texte et n'enregistre ni ne transmet la voix locale ; un autre agent de la préfecture le
--     fait, ou l'agent désigné par le régional sur le dossier du praticien (§2.71).
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Auteur de la saisie
-- ---------------------------------------------------------------------
ALTER TABLE recette ADD COLUMN saisi_par bigint REFERENCES utilisateur(id);
COMMENT ON COLUMN recette.saisi_par IS
  'Agent préfectoral qui a numérisé la recette pour le praticien (US-082) ; NULL : saisie du praticien. Posé par la base à la création, jamais modifié.';

CREATE FUNCTION trg_recette_saisie() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.saisi_par := CASE WHEN contexte_role() = 'prefectoral' THEN contexte_utilisateur() END;
  ELSE
    NEW.saisi_par := OLD.saisi_par;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_recette_saisie BEFORE INSERT OR UPDATE OF saisi_par ON recette
  FOR EACH ROW EXECUTE FUNCTION trg_recette_saisie();

-- ---------------------------------------------------------------------
-- 2. Praticien du Studio : le praticien connecté, ou celui que numérise l'agent
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION studio_praticien() RETURNS praticien LANGUAGE plpgsql STABLE AS $$
DECLARE v_pra  praticien%ROWTYPE;
        v_code text := nullif(current_setting('sabou.numerisation_praticien', true), '');
BEGIN
  IF contexte_role() = 'prefectoral' AND v_code IS NOT NULL THEN
    SELECT p.* INTO v_pra
      FROM praticien p
      JOIN utilisateur a ON a.id = contexte_utilisateur()
     WHERE p.code = v_code AND a.statut = 'actif' AND a.role_code = 'prefectoral'
       AND a.prefecture_id = p.prefecture_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Praticien % introuvable dans votre préfecture', v_code
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_pra.statut = 'rejete' THEN
      RAISE EXCEPTION 'Praticien % rejeté : aucune recette ne peut être numérisée', v_code
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN v_pra;
  END IF;
  IF contexte_role() IS DISTINCT FROM 'praticien' THEN
    RAISE EXCEPTION 'Le Studio est réservé aux praticiens' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_pra FROM praticien WHERE utilisateur_id = contexte_utilisateur();
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche de praticien à créer avant le Studio'; END IF;
  RETURN v_pra;
END $$;
REVOKE EXECUTE ON FUNCTION studio_praticien() FROM PUBLIC;

-- Identifiant du praticien du Studio, pour les lectures de l'API (liste, détail, voix) :
-- le praticien connecté (NULL sans fiche), ou celui que numérise l'agent (contrôlé par
-- studio_praticien()). SECURITY DEFINER : studio_praticien() n'est pas ouverte à l'API.
CREATE FUNCTION studio_praticien_id() RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
BEGIN
  IF contexte_role() = 'prefectoral'
     AND nullif(current_setting('sabou.numerisation_praticien', true), '') IS NOT NULL THEN
    RETURN (studio_praticien()).id;
  END IF;
  RETURN (SELECT id FROM praticien
           WHERE contexte_role() = 'praticien' AND utilisateur_id = contexte_utilisateur());
END $$;
REVOKE EXECUTE ON FUNCTION studio_praticien_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio_praticien_id() TO sabou_app;

-- Praticiens que l'agent peut rattacher à une recette : ceux de sa préfecture, non rejetés
CREATE FUNCTION numerisation_praticiens()
RETURNS TABLE (code text, nom text, langue_principale text, statut text)
LANGUAGE sql STABLE AS $$
  SELECT p.code, btrim(concat_ws(' ', u.prenom, u.nom)), p.langue_principale, p.statut
    FROM praticien p
    JOIN utilisateur u ON u.id = p.utilisateur_id
    JOIN utilisateur a ON a.id = contexte_utilisateur()
   WHERE contexte_role() = 'prefectoral' AND a.statut = 'actif'
     AND p.prefecture_id = a.prefecture_id AND p.statut <> 'rejete'
   ORDER BY u.nom, u.prenom, p.code
$$;
REVOKE EXECUTE ON FUNCTION numerisation_praticiens() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION numerisation_praticiens() TO sabou_app;

-- ---------------------------------------------------------------------
-- 3. Vérification par un autre que l'auteur
-- ---------------------------------------------------------------------
-- Vrai si l'acteur peut réviser le texte et la voix locale du traitement : préfectoral de la
-- préfecture du praticien ; pour une recette numérisée, jamais son auteur, et, si le régional
-- a désigné un agent sur le dossier en cours du praticien, cet agent seul (§2.71).
CREATE FUNCTION traitement_verificateur(p_act utilisateur, p_recette bigint) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE v_rec    recette%ROWTYPE;
        v_pref   smallint;
        v_design bigint;
BEGIN
  IF p_act.role_code IS DISTINCT FROM 'prefectoral' THEN RETURN false; END IF;
  SELECT * INTO v_rec FROM recette WHERE id = p_recette;
  SELECT prefecture_id INTO v_pref FROM praticien WHERE id = v_rec.praticien_id;
  IF v_rec.saisi_par IS NULL THEN
    RETURN p_act.prefecture_id IS NOT DISTINCT FROM v_pref;
  END IF;
  IF p_act.id = v_rec.saisi_par THEN RETURN false; END IF;
  SELECT d.verificateur_designe INTO v_design
    FROM dossier_certification d
   WHERE d.praticien_id = v_rec.praticien_id AND d.statut = 'en_cours'
     AND d.verificateur_designe IS NOT NULL
   ORDER BY d.ouvert_le DESC LIMIT 1;
  IF v_design IS NOT NULL THEN RETURN p_act.id = v_design; END IF;
  RETURN p_act.prefecture_id IS NOT DISTINCT FROM v_pref;
END $$;
REVOKE EXECUTE ON FUNCTION traitement_verificateur(utilisateur, bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION traitement_section_reviser(p_code text, p_type text, p_texte_fr text,
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
  IF NOT traitement_verificateur(v_act, v_c.recette_id) THEN
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

CREATE OR REPLACE FUNCTION traitement_voix_enregistrer(p_code text, p_type text, p_langue text, p_depot bigint)
RETURNS text LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act   utilisateur%ROWTYPE;
        v_c     record;
        v_audio bigint;
BEGIN
  v_act := voix_nom_acteur();
  v_c := traitement_section_cible(p_code, p_type);
  IF NOT traitement_verificateur(v_act, v_c.recette_id) THEN
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

CREATE OR REPLACE FUNCTION traitement_voix_envoyer(p_code text, p_type text, p_langue text)
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
  IF NOT traitement_verificateur(v_act, v_c.recette_id)
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
