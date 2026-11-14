-- US-050 : créer et modifier une fiche plante avec ses images (UC-05, R-PLA-01, R-PLA-02, R-PLA-04).
--   - réservé à la DG et au Comité scientifique (la base le vérifie, l'API aussi) ;
--   - nom scientifique unique, sans tenir compte de la casse, des accents ni des espaces
--     autour ; famille et nom français obligatoires, nom anglais facultatif ;
--   - une seule photo principale par plante, texte alternatif français obligatoire ; la
--     première photo d'une fiche devient principale, et si la principale est retirée, la
--     suivante (par ordre) la remplace : une fiche qui a des photos a toujours sa principale ;
--   - chaque création, modification et chaque photo sont tracées au journal d'audit.
-- La validation par le Comité (statut « validée ») relève de US-051.
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Contrôles des champs de la fiche
-- ---------------------------------------------------------------------
ALTER TABLE plante
  ADD CONSTRAINT ck_plante_nom_scientifique
    CHECK (btrim(nom_scientifique) <> '' AND char_length(nom_scientifique) <= 150),
  ADD CONSTRAINT ck_plante_famille CHECK (btrim(famille) <> '' AND char_length(famille) <= 100),
  ADD CONSTRAINT ck_plante_nom_fr CHECK (btrim(nom_fr) <> '' AND char_length(nom_fr) <= 150),
  ADD CONSTRAINT ck_plante_nom_en
    CHECK (nom_en IS NULL OR (btrim(nom_en) <> '' AND char_length(nom_en) <= 150));
-- « Khaya senegalensis » et « khaya  Senegalensis » sont le même nom
CREATE UNIQUE INDEX ux_plante_nom_scientifique_norm ON plante (f_norm(btrim(nom_scientifique)));

-- Codes PL-001, PL-002… : le suivant libre est pris par plante_creer
CREATE SEQUENCE plante_code_seq;

-- ---------------------------------------------------------------------
-- 2. Photos : fichier dans le stockage objet (clé), empreinte, type et taille
-- ---------------------------------------------------------------------
ALTER TABLE plante_image
  ADD COLUMN sha256 char(64) CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN type_mime text CHECK (type_mime IN ('image/jpeg','image/png','image/webp')),
  ADD COLUMN taille_octets integer CHECK (taille_octets > 0),
  ADD COLUMN ajoute_le timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT ck_plante_image_alt_fr
    CHECK (btrim(alt_text_fr) <> '' AND char_length(alt_text_fr) <= 250),
  ADD CONSTRAINT ck_plante_image_alt_en
    CHECK (alt_text_en IS NULL OR (btrim(alt_text_en) <> '' AND char_length(alt_text_en) <= 250));
CREATE UNIQUE INDEX ux_plante_image_cle ON plante_image (image_url);

-- ---------------------------------------------------------------------
-- 3. Acteur autorisé : DG ou Comité scientifique, compte actif
-- ---------------------------------------------------------------------
-- L'acteur est celui du contexte ouvert par l'API pour le compte connecté (contexte_ouvrir,
-- US-011) : aucun paramètre ne permet d'agir au nom d'un autre
CREATE FUNCTION plante_acteur() RETURNS utilisateur LANGUAGE plpgsql STABLE AS $$
DECLARE v_usr utilisateur%ROWTYPE;
BEGIN
  SELECT * INTO v_usr FROM utilisateur WHERE id = contexte_utilisateur() AND statut = 'actif';
  IF NOT FOUND THEN RAISE EXCEPTION 'Acteur inconnu ou suspendu'; END IF;
  IF v_usr.role_code NOT IN ('dg','scientifique') THEN
    RAISE EXCEPTION 'Les fiches plantes sont réservées à la DG et au Comité scientifique';
  END IF;
  RETURN v_usr;
END $$;

-- Nom scientifique déjà pris par une autre fiche : message explicite (l'index le garantit)
CREATE FUNCTION plante_nom_libre(p_nom text, p_sauf bigint) RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE v_code text;
BEGIN
  SELECT code INTO v_code FROM plante
   WHERE f_norm(btrim(nom_scientifique)) = f_norm(btrim(p_nom)) AND id IS DISTINCT FROM p_sauf;
  IF FOUND THEN
    RAISE EXCEPTION 'Nom scientifique déjà utilisé par la fiche %', v_code;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Créer et modifier une fiche
-- ---------------------------------------------------------------------
CREATE FUNCTION plante_creer(p_nom_scientifique text, p_famille text,
                             p_nom_fr text, p_nom_en text DEFAULT NULL)
RETURNS plante LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act  utilisateur%ROWTYPE;
        v_pla  plante%ROWTYPE;
        v_code text;
BEGIN
  v_act := plante_acteur();
  PERFORM plante_nom_libre(p_nom_scientifique, NULL);
  -- Premier code libre : le jeu d'exemple ou une reprise de données ont pu en prendre
  LOOP
    v_code := 'PL-' || lpad(nextval('plante_code_seq')::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM plante WHERE code = v_code);
  END LOOP;
  INSERT INTO plante (code, nom_scientifique, famille, nom_fr, nom_en)
  VALUES (v_code, btrim(p_nom_scientifique), btrim(p_famille), btrim(p_nom_fr),
          nullif(btrim(p_nom_en), ''))
  RETURNING * INTO v_pla;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'plante.creee', 'plante', v_pla.code,
          jsonb_strip_nulls(jsonb_build_object('nomScientifique', v_pla.nom_scientifique,
                                               'nomFr', v_pla.nom_fr)));
  RETURN v_pla;
END $$;
COMMENT ON FUNCTION plante_creer(text, text, text, text) IS
  'Crée une fiche plante « en revue » (US-050, R-PLA-01) : DG ou Comité, nom scientifique unique.';

-- p_vue_le : date de dernière modification lue par l'écran ; une fiche modifiée entre-temps
-- est refusée plutôt qu'écrasée
CREATE FUNCTION plante_modifier(p_code text, p_vue_le timestamptz,
                                p_nom_scientifique text, p_famille text, p_nom_fr text,
                                p_nom_en text DEFAULT NULL)
RETURNS plante LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act  utilisateur%ROWTYPE;
        v_avant plante%ROWTYPE;
        v_pla   plante%ROWTYPE;
BEGIN
  v_act := plante_acteur();
  SELECT * INTO v_avant FROM plante WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plante % introuvable', p_code; END IF;
  IF date_trunc('milliseconds', v_avant.updated_at) <> date_trunc('milliseconds', p_vue_le) THEN
    RAISE EXCEPTION 'Plante % modifiée entre-temps', p_code;
  END IF;
  PERFORM plante_nom_libre(p_nom_scientifique, v_avant.id);
  UPDATE plante SET nom_scientifique = btrim(p_nom_scientifique), famille = btrim(p_famille),
                    nom_fr = btrim(p_nom_fr), nom_en = nullif(btrim(p_nom_en), '')
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
                          THEN jsonb_build_array(v_avant.nom_en, v_pla.nom_en) END)));
  RETURN v_pla;
END $$;
COMMENT ON FUNCTION plante_modifier(text, timestamptz, text, text, text, text) IS
  'Modifie une fiche plante (US-050) : DG ou Comité, refus si modifiée entre-temps, changements tracés.';

-- ---------------------------------------------------------------------
-- 5. Photos d'une fiche
-- ---------------------------------------------------------------------
-- Une photo marquée principale retire la marque des autres ; la première photo d'une fiche
-- est principale d'office
CREATE FUNCTION plante_image_ajouter(p_code text, p_cle text, p_sha256 text,
                                     p_type_mime text, p_taille integer, p_alt_fr text,
                                     p_alt_en text, p_type text, p_principale boolean)
RETURNS plante_image LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act  utilisateur%ROWTYPE;
        v_pla   plante%ROWTYPE;
        v_img   plante_image%ROWTYPE;
        v_princ boolean;
BEGIN
  v_act := plante_acteur();
  SELECT * INTO v_pla FROM plante WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plante % introuvable', p_code; END IF;
  v_princ := p_principale OR NOT EXISTS (SELECT 1 FROM plante_image WHERE plante_id = v_pla.id);
  IF v_princ THEN
    UPDATE plante_image SET principale = false WHERE plante_id = v_pla.id AND principale;
  END IF;
  INSERT INTO plante_image (plante_id, image_url, alt_text_fr, alt_text_en, type, principale, ordre,
                            sha256, type_mime, taille_octets)
  VALUES (v_pla.id, p_cle, btrim(p_alt_fr), nullif(btrim(p_alt_en), ''), p_type, v_princ,
          COALESCE((SELECT max(ordre) FROM plante_image WHERE plante_id = v_pla.id), 0) + 1,
          p_sha256, p_type_mime, p_taille)
  RETURNING * INTO v_img;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'plante.image_ajoutee', 'plante', v_pla.code,
          jsonb_build_object('image', v_img.id, 'sha256', v_img.sha256, 'principale', v_img.principale));
  RETURN v_img;
END $$;

CREATE FUNCTION plante_image_modifier(p_code text, p_image bigint, p_alt_fr text,
                                      p_alt_en text, p_type text, p_principale boolean)
RETURNS plante_image LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act  utilisateur%ROWTYPE;
        v_pla plante%ROWTYPE;
        v_img plante_image%ROWTYPE;
BEGIN
  v_act := plante_acteur();
  SELECT * INTO v_pla FROM plante WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plante % introuvable', p_code; END IF;
  SELECT * INTO v_img FROM plante_image WHERE id = p_image AND plante_id = v_pla.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Photo % introuvable', p_image; END IF;
  -- La principale ne perd sa marque qu'en la donnant à une autre photo
  IF v_img.principale AND NOT p_principale THEN
    RAISE EXCEPTION 'Photo %, principale : marquer une autre photo principale à la place', p_image;
  END IF;
  IF p_principale AND NOT v_img.principale THEN
    UPDATE plante_image SET principale = false WHERE plante_id = v_pla.id AND principale;
  END IF;
  UPDATE plante_image SET alt_text_fr = btrim(p_alt_fr), alt_text_en = nullif(btrim(p_alt_en), ''),
                          type = p_type, principale = p_principale
   WHERE id = p_image
  RETURNING * INTO v_img;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'plante.image_modifiee', 'plante', v_pla.code,
          jsonb_build_object('image', v_img.id, 'principale', v_img.principale));
  RETURN v_img;
END $$;

-- Renvoie la clé du fichier, que l'API retire ensuite du stockage
CREATE FUNCTION plante_image_retirer(p_code text, p_image bigint)
RETURNS text LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act  utilisateur%ROWTYPE;
        v_pla plante%ROWTYPE;
        v_img plante_image%ROWTYPE;
BEGIN
  v_act := plante_acteur();
  SELECT * INTO v_pla FROM plante WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plante % introuvable', p_code; END IF;
  DELETE FROM plante_image WHERE id = p_image AND plante_id = v_pla.id RETURNING * INTO v_img;
  IF NOT FOUND THEN RAISE EXCEPTION 'Photo % introuvable', p_image; END IF;
  -- La principale retirée : la suivante par ordre la remplace
  IF v_img.principale THEN
    UPDATE plante_image SET principale = true
     WHERE id = (SELECT id FROM plante_image WHERE plante_id = v_pla.id ORDER BY ordre, id LIMIT 1);
  END IF;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'plante.image_retiree', 'plante', v_pla.code,
          jsonb_build_object('image', v_img.id, 'sha256', v_img.sha256));
  RETURN v_img.image_url;
END $$;

-- Les fiches et leurs photos ne s'écrivent que par ces fonctions (rôle vérifié, journal
-- d'audit) : elles s'exécutent avec les droits du propriétaire, l'API n'écrit plus en direct
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON plante, plante_image FROM sabou_app;
REVOKE EXECUTE ON FUNCTION plante_creer(text, text, text, text),
  plante_modifier(text, timestamptz, text, text, text, text),
  plante_image_ajouter(text, text, text, text, integer, text, text, text, boolean),
  plante_image_modifier(text, bigint, text, text, text, boolean),
  plante_image_retirer(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plante_creer(text, text, text, text),
  plante_modifier(text, timestamptz, text, text, text, text),
  plante_image_ajouter(text, text, text, text, integer, text, text, text, boolean),
  plante_image_modifier(text, bigint, text, text, text, boolean),
  plante_image_retirer(text, bigint) TO sabou_app;
