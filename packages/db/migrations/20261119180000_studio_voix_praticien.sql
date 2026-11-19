-- US-081 : enregistrer sa recette au Studio mobile, en voix (UC-21, R-GOV-01, R-LNG-11,
-- R-REC-02/03, décisions du maître d'œuvre du 19 novembre 2026).
--   - le praticien enregistre une voix par section et par plante (le nom de la plante tel
--     qu'il le dit), dans sa langue principale, après avoir donné son consentement ;
--   - chaque enregistrement est gardé (historique) ; le dernier compte. Il est rattaché au
--     dépôt (US-070) dès l'envoi, sans attendre son traitement : l'application l'envoie en
--     une fois, au retour du réseau, avec une clé tirée sur le téléphone qui rend l'envoi
--     rejouable sans doublon ;
--   - une fois la voix traitée, celle d'une section devient le brouillon de sa langue dans le
--     circuit des voix (US-075 à US-074) ; le préfectoral la transmet telle quelle ou la
--     remplace. La voix du nom d'une plante reste interne (préfectoral, Comité) ;
--   - une section obligatoire est complète avec une voix OU un texte du praticien ; le texte
--     français (écrit par le préfectoral pendant « soumis ») est exigé avant le Comité.
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Section sans texte : la voix du praticien suffit jusqu'à la transmission au Comité
-- ---------------------------------------------------------------------
ALTER TABLE recette_section ALTER COLUMN texte_fr DROP NOT NULL;
ALTER TABLE recette_section DROP CONSTRAINT recette_section_texte_fr_check;
ALTER TABLE recette_section ADD CONSTRAINT recette_section_texte_fr_check
  CHECK (texte_fr IS NULL OR length(btrim(texte_fr)) > 0);
COMMENT ON TABLE recette_section IS
  'Texte français (obligatoire avant le Comité ; vide tant que seule la voix du praticien existe, US-081) et anglais facultatif (R-REC-03).';
-- Le préfectoral peut écrire le premier texte d'une section dite seulement en voix
ALTER TABLE recette_section_revision ALTER COLUMN texte_fr_avant DROP NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Voix enregistrées par le praticien (historique complet)
-- ---------------------------------------------------------------------
CREATE TABLE recette_voix_praticien (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recette_id     bigint NOT NULL REFERENCES recette(id) ON DELETE CASCADE,
  section_type   text   REFERENCES section_type(code),
  plante_id      bigint REFERENCES plante(id),
  langue_code    text   NOT NULL REFERENCES langue(code),
  depot_id       bigint NOT NULL UNIQUE REFERENCES voix_depot(id),
  -- Clé tirée sur le téléphone : un envoi rejoué après une coupure ne crée pas de doublon
  cle_client     uuid   NOT NULL UNIQUE,
  enregistre_par bigint NOT NULL REFERENCES utilisateur(id),
  enregistre_le  timestamptz NOT NULL DEFAULT now(),
  retire_le      timestamptz,
  CONSTRAINT ck_voix_praticien_cible CHECK ((section_type IS NULL) <> (plante_id IS NULL))
);
CREATE INDEX ix_voix_praticien_section ON recette_voix_praticien (recette_id, section_type, id)
  WHERE section_type IS NOT NULL;
CREATE INDEX ix_voix_praticien_plante ON recette_voix_praticien (recette_id, plante_id, id)
  WHERE plante_id IS NOT NULL;
COMMENT ON TABLE recette_voix_praticien IS
  'Voix du praticien par section ou par nom de plante (US-081) : historique complet, le dernier enregistrement non retiré compte.';

-- Visible si son traitement l'est (règle du traitement : zone de l'encadrement)
ALTER TABLE recette_voix_praticien ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON recette_voix_praticien TO sabou_app
  USING (EXISTS (SELECT 1 FROM recette r WHERE r.id = recette_voix_praticien.recette_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON recette_voix_praticien FROM sabou_app;

-- Voix en vigueur d'une cible (section ou plante) : la dernière non retirée, hors échec
CREATE FUNCTION voix_praticien_courante(p_recette bigint, p_section text, p_plante bigint)
RETURNS recette_voix_praticien LANGUAGE sql STABLE AS $$
  SELECT v.* FROM recette_voix_praticien v JOIN voix_depot d ON d.id = v.depot_id
   WHERE v.recette_id = p_recette AND v.retire_le IS NULL AND d.statut <> 'echec'
     AND v.section_type IS NOT DISTINCT FROM p_section AND v.plante_id IS NOT DISTINCT FROM p_plante
   ORDER BY v.id DESC LIMIT 1
$$;

-- ---------------------------------------------------------------------
-- 3. Voix d'une section traitée : brouillon de la langue du praticien dans le circuit
-- ---------------------------------------------------------------------
CREATE FUNCTION voix_praticien_vers_circuit(p_voix recette_voix_praticien, p_audio bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_section bigint;
BEGIN
  INSERT INTO recette_section (recette_id, type_code, texte_fr)
  VALUES (p_voix.recette_id, p_voix.section_type, NULL)
  ON CONFLICT (recette_id, type_code) DO NOTHING;
  SELECT id INTO v_section FROM recette_section
   WHERE recette_id = p_voix.recette_id AND type_code = p_voix.section_type;
  INSERT INTO recette_section_voix (section_id, langue_code, audio_id, statut, enregistre_par)
  VALUES (v_section, p_voix.langue_code, p_audio, 'brouillon', p_voix.enregistre_par)
  ON CONFLICT (section_id, langue_code) DO UPDATE
    SET audio_id = EXCLUDED.audio_id, statut = 'brouillon', enregistre_par = EXCLUDED.enregistre_par,
        traducteur_id = NULL, valideur_id = NULL, publie_par = NULL, renvoi_motif = NULL,
        controle_comite_par = NULL, controle_comite_le = NULL;
END $$;

CREATE FUNCTION trg_voix_praticien_traitee() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_voix recette_voix_praticien%ROWTYPE;
BEGIN
  SELECT * INTO v_voix FROM recette_voix_praticien WHERE depot_id = NEW.id;
  IF NOT FOUND OR v_voix.section_type IS NULL OR v_voix.retire_le IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Un enregistrement plus récent de la même section l'a déjà remplacé
  IF EXISTS (SELECT 1 FROM recette_voix_praticien v
              WHERE v.recette_id = v_voix.recette_id AND v.section_type = v_voix.section_type
                AND v.id > v_voix.id AND v.retire_le IS NULL) THEN
    RETURN NEW;
  END IF;
  IF (SELECT statut FROM recette WHERE id = v_voix.recette_id) = 'retiree' THEN
    RETURN NEW;
  END IF;
  PERFORM voix_praticien_vers_circuit(v_voix, NEW.audio_id);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_voix_praticien_traitee AFTER UPDATE OF statut ON voix_depot
  FOR EACH ROW WHEN (NEW.statut = 'traitee' AND OLD.statut IS DISTINCT FROM 'traitee')
  EXECUTE FUNCTION trg_voix_praticien_traitee();

-- ---------------------------------------------------------------------
-- 4. Fonctions du Studio : déposer, retirer
-- ---------------------------------------------------------------------
-- Brouillon du praticien connecté, cible contrôlée (section connue, plante du traitement)
CREATE FUNCTION studio_voix_cible(p_code text, p_cible text, p_objet text,
                                  OUT rec recette, OUT sec_type text, OUT pla_id bigint)
LANGUAGE plpgsql AS $$
DECLARE v_pra praticien%ROWTYPE;
BEGIN
  v_pra := studio_praticien();
  SELECT * INTO rec FROM recette r WHERE r.code = p_code AND r.praticien_id = v_pra.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_code; END IF;
  IF rec.statut <> 'brouillon' THEN
    RAISE EXCEPTION 'Traitement % : seul un brouillon s''enregistre', p_code;
  END IF;
  IF p_cible = 'section' THEN
    SELECT t.code INTO sec_type FROM section_type t WHERE t.code = p_objet;
    IF NOT FOUND THEN RAISE EXCEPTION 'Section % inconnue', p_objet; END IF;
  ELSIF p_cible = 'plante' THEN
    SELECT pl.id INTO pla_id FROM recette_plante rp JOIN plante pl ON pl.id = rp.plante_id
     WHERE rp.recette_id = rec.id AND pl.code = p_objet;
    IF NOT FOUND THEN RAISE EXCEPTION 'Plante % absente du traitement %', p_objet, p_code; END IF;
  ELSE
    RAISE EXCEPTION 'Cible % inconnue', p_cible;
  END IF;
END $$;

-- Dépôt d'une voix du praticien (fichier déjà rangé par l'API) ; rejoué avec la même clé,
-- renvoie le dépôt existant. Le consentement du traitement est exigé (R-LNG-11).
CREATE FUNCTION traitement_voix_praticien_deposer(p_code text, p_cible text, p_objet text,
                                                  p_cle_client uuid, p_cle text, p_type_mime text,
                                                  p_taille integer, p_sha256 text)
RETURNS bigint LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_c      record;
        v_pra    praticien%ROWTYPE;
        v_exist  recette_voix_praticien%ROWTYPE;
        v_depot  voix_depot%ROWTYPE;
BEGIN
  v_pra := studio_praticien();
  SELECT * INTO v_exist FROM recette_voix_praticien WHERE cle_client = p_cle_client;
  IF FOUND THEN
    IF v_exist.enregistre_par <> contexte_utilisateur() THEN
      RAISE EXCEPTION 'Clé d''envoi déjà utilisée';
    END IF;
    RETURN v_exist.depot_id;
  END IF;
  v_c := studio_voix_cible(p_code, p_cible, p_objet);
  IF (v_c.rec).consentement_le IS NULL THEN
    RAISE EXCEPTION 'Traitement % : consentement à donner avant d''enregistrer sa voix', p_code;
  END IF;
  -- Anti-abus : 60 enregistrements par heure au plus (une recette complète en compte une dizaine)
  IF (SELECT count(*) FROM recette_voix_praticien
       WHERE enregistre_par = contexte_utilisateur() AND enregistre_le > now() - interval '1 hour') >= 60 THEN
    RAISE EXCEPTION 'Trop d''enregistrements en une heure';
  END IF;
  v_depot := voix_deposer(p_cle, p_type_mime, p_taille, p_sha256, true);
  INSERT INTO recette_voix_praticien (recette_id, section_type, plante_id, langue_code, depot_id,
                                      cle_client, enregistre_par)
  VALUES ((v_c.rec).id, v_c.sec_type, v_c.pla_id, v_pra.langue_principale, v_depot.id,
          p_cle_client, contexte_utilisateur());
  IF v_c.sec_type IS NOT NULL THEN
    INSERT INTO recette_section (recette_id, type_code, texte_fr)
    VALUES ((v_c.rec).id, v_c.sec_type, NULL)
    ON CONFLICT (recette_id, type_code) DO NOTHING;
  END IF;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (contexte_utilisateur(), 'recette.voix_praticien', 'recette', p_code,
          jsonb_build_object('cible', p_cible, 'objet', p_objet, 'depot', v_depot.id,
                             'langue', v_pra.langue_principale));
  RETURN v_depot.id;
END $$;

-- Retirer sa voix d'une cible : gardée dans l'historique ; une section sans texte ni voix
-- disparaît ; sa voix dans le circuit est retirée si c'est encore la sienne
CREATE FUNCTION traitement_voix_praticien_retirer(p_code text, p_cible text, p_objet text)
RETURNS boolean LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_c       record;
        v_n       integer;
        v_section recette_section%ROWTYPE;
BEGIN
  v_c := studio_voix_cible(p_code, p_cible, p_objet);
  UPDATE recette_voix_praticien SET retire_le = now()
   WHERE recette_id = (v_c.rec).id AND retire_le IS NULL
     AND section_type IS NOT DISTINCT FROM v_c.sec_type
     AND plante_id IS NOT DISTINCT FROM v_c.pla_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN false; END IF;
  IF v_c.sec_type IS NOT NULL THEN
    SELECT * INTO v_section FROM recette_section
     WHERE recette_id = (v_c.rec).id AND type_code = v_c.sec_type;
    IF FOUND THEN
      DELETE FROM recette_section_voix
       WHERE section_id = v_section.id AND enregistre_par = contexte_utilisateur();
      IF v_section.texte_fr IS NULL
         AND NOT EXISTS (SELECT 1 FROM recette_section_voix WHERE section_id = v_section.id) THEN
        DELETE FROM recette_section WHERE id = v_section.id;
      END IF;
    END IF;
  END IF;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (contexte_utilisateur(), 'recette.voix_praticien_retiree', 'recette', p_code,
          jsonb_build_object('cible', p_cible, 'objet', p_objet));
  RETURN true;
END $$;

-- Voix en vigueur du praticien connecté pour un de ses traitements (écran du Studio)
CREATE FUNCTION traitement_voix_praticien(p_code text)
RETURNS TABLE (cible text, objet text, depot bigint, etat text, duree_sec numeric,
               enregistre_le timestamptz)
LANGUAGE plpgsql STABLE
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_pra praticien%ROWTYPE;
        v_rec bigint;
BEGIN
  v_pra := studio_praticien();
  SELECT id INTO v_rec FROM recette WHERE code = p_code AND praticien_id = v_pra.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_code; END IF;
  RETURN QUERY
  SELECT DISTINCT ON (v.section_type, v.plante_id)
         CASE WHEN v.section_type IS NOT NULL THEN 'section' ELSE 'plante' END,
         COALESCE(v.section_type, pl.code), d.id, d.statut, a.duree_sec, v.enregistre_le
    FROM recette_voix_praticien v
    JOIN voix_depot d ON d.id = v.depot_id
    LEFT JOIN audio_fichier a ON a.id = d.audio_id
    LEFT JOIN plante pl ON pl.id = v.plante_id
   WHERE v.recette_id = v_rec AND v.retire_le IS NULL
   ORDER BY v.section_type, v.plante_id, v.id DESC;
END $$;

-- Fichier traité de la voix en vigueur (réécoute dans le Studio) ; NULL si pas encore traité
CREATE FUNCTION traitement_voix_praticien_fichier(p_code text, p_cible text, p_objet text,
                                                  OUT chemin text, OUT secours text)
LANGUAGE plpgsql STABLE
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_pra praticien%ROWTYPE;
        v_rec bigint;
        v_pla bigint;
        v_voix recette_voix_praticien%ROWTYPE;
BEGIN
  v_pra := studio_praticien();
  SELECT id INTO v_rec FROM recette WHERE code = p_code AND praticien_id = v_pra.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_code; END IF;
  IF p_cible = 'plante' THEN
    SELECT id INTO v_pla FROM plante WHERE code = p_objet;
  END IF;
  v_voix := voix_praticien_courante(v_rec, CASE WHEN p_cible = 'section' THEN p_objet END, v_pla);
  IF v_voix.id IS NULL THEN RAISE EXCEPTION 'Voix absente'; END IF;
  SELECT a.chemin, a.chemin_secours INTO chemin, secours
    FROM voix_depot d JOIN audio_fichier a ON a.id = d.audio_id WHERE d.id = v_voix.depot_id;
END $$;

-- ---------------------------------------------------------------------
-- 5. Complétude : voix OU texte par section obligatoire ; texte avant le Comité
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recette_manques(p_recette bigint) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN r.consentement_le IS NULL THEN 'consentement' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM recette_plante rp WHERE rp.recette_id = r.id) THEN 'plante' END,
    CASE WHEN r.cycle_duree_jours IS NULL OR r.cycle_prises_par_jour IS NULL THEN 'cycle' END,
    CASE WHEN EXISTS (SELECT 1 FROM section_type t WHERE t.obligatoire
                        AND NOT EXISTS (SELECT 1 FROM recette_section s
                                         WHERE s.recette_id = r.id AND s.type_code = t.code
                                           AND s.texte_fr IS NOT NULL)
                        AND (voix_praticien_courante(r.id, t.code, NULL)).id IS NULL)
         THEN 'sections' END], NULL)
    FROM recette r WHERE r.id = p_recette
$$;

CREATE FUNCTION trg_recette_texte_avant_comite() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_sans text;
BEGIN
  IF OLD.statut = 'soumise' AND NEW.statut = 'transmise' THEN
    SELECT string_agg(t.code, ', ' ORDER BY t.ordre) INTO v_sans
      FROM section_type t
     WHERE t.obligatoire
       AND NOT EXISTS (SELECT 1 FROM recette_section s
                        WHERE s.recette_id = NEW.id AND s.type_code = t.code AND s.texte_fr IS NOT NULL);
    IF v_sans IS NOT NULL THEN
      RAISE EXCEPTION 'Traitement % : texte français à écrire avant le Comité (%)', NEW.code, v_sans;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_recette_texte_avant_comite BEFORE UPDATE OF statut ON recette
  FOR EACH ROW EXECUTE FUNCTION trg_recette_texte_avant_comite();

-- ---------------------------------------------------------------------
-- 6. Studio : une section vidée de son texte reste si elle a une voix
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

  -- Sections retirées ou vidées : supprimées si elles n'ont aucune voix, sinon texte effacé
  -- (la voix du praticien suffit jusqu'au Comité) ; un texte modifié ramène les voix en
  -- brouillon (trg_section_texte_modifie)
  UPDATE recette_section s SET texte_fr = NULL, texte_en = NULL
   WHERE s.recette_id = v_rec.id AND s.texte_fr IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_sections) x
                      WHERE x->>'type' = s.type_code AND btrim(COALESCE(x->>'texteFr', '')) <> '')
     AND (EXISTS (SELECT 1 FROM recette_section_voix v WHERE v.section_id = s.id)
          OR (voix_praticien_courante(v_rec.id, s.type_code, NULL)).id IS NOT NULL);
  DELETE FROM recette_section s
   WHERE s.recette_id = v_rec.id
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_sections) x
                      WHERE x->>'type' = s.type_code AND btrim(COALESCE(x->>'texteFr', '')) <> '')
     AND NOT EXISTS (SELECT 1 FROM recette_section_voix v WHERE v.section_id = s.id)
     AND (voix_praticien_courante(v_rec.id, s.type_code, NULL)).id IS NULL;
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

REVOKE EXECUTE ON FUNCTION
  traitement_voix_praticien_deposer(text, text, text, uuid, text, text, integer, text),
  traitement_voix_praticien_retirer(text, text, text),
  traitement_voix_praticien(text),
  traitement_voix_praticien_fichier(text, text, text),
  studio_voix_cible(text, text, text),
  trg_voix_praticien_traitee() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  traitement_voix_praticien_deposer(text, text, text, uuid, text, text, integer, text),
  traitement_voix_praticien_retirer(text, text, text),
  traitement_voix_praticien(text),
  traitement_voix_praticien_fichier(text, text, text) TO sabou_app;
