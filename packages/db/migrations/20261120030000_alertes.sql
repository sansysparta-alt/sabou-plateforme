-- US-102 : traiter les alertes territoriales (UC-44, R-MOD-04). Décisions du maître d'œuvre
-- du 19 novembre 2026 (05 §2.89) :
-- - dossier bloqué : automatique, dossier en cours aux étapes 2 à 5 depuis plus de 15 jours
--   (même seuil que l'entonnoir, §2.38) ; close d'elle-même quand le dossier avance ;
-- - désert thérapeutique : automatique, préfecture active sans aucun praticien certifié ;
--   close d'elle-même au premier praticien certifié ;
-- - hausse de pathologie : déclarée par l'admin préfectoral (sa préfecture) ou la DG ;
-- - accusé de réception et relance : la relance prévient les responsables (le régional de la
--   région ; en plus le préfectoral pour un dossier bloqué à l'étape 2) dans l'application
--   (alerte marquée « relancée ») et par e-mail (mis en file ; aucun envoi d'e-mail tant que
--   le serveur SMTP n'est pas choisi, question posée au maître d'œuvre le 20 novembre 2026).
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Modèle
-- ---------------------------------------------------------------------
ALTER TABLE alerte_territoriale
  ADD COLUMN dossier_id   bigint REFERENCES dossier_certification(id),
  ADD COLUMN declaree_par bigint REFERENCES utilisateur(id),
  ADD COLUMN accusee_par  bigint REFERENCES utilisateur(id),
  ADD COLUMN relances     smallint NOT NULL DEFAULT 0 CHECK (relances >= 0),
  ADD COLUMN relancee_le  timestamptz,
  ADD COLUMN close_le     timestamptz,
  ADD COLUMN close_motif  text CHECK (btrim(close_motif) <> '' AND char_length(close_motif) <= 1000),
  ADD COLUMN close_par    bigint REFERENCES utilisateur(id),
  ADD CONSTRAINT ck_alerte_description CHECK (btrim(description) <> '' AND char_length(description) <= 1000),
  -- Le dossier n'est porté que par une alerte « dossier bloqué » (les alertes saisies avant
  -- US-102 n'en ont pas) ; une hausse de pathologie nomme toujours la maladie
  ADD CONSTRAINT ck_alerte_dossier CHECK (dossier_id IS NULL OR type = 'dossier_bloque'),
  ADD CONSTRAINT ck_alerte_pathologie CHECK (type <> 'hausse_pathologie' OR maladie_id IS NOT NULL),
  ADD CONSTRAINT ck_alerte_close CHECK ((statut = 'close') = (close_le IS NOT NULL));

COMMENT ON COLUMN alerte_territoriale.statut IS
  'nouvelle → accusee (accusé de réception) ; relancee (relance aux responsables) → accusee ; close (traitée, ou résolue d''elle-même).';

-- Une seule alerte ouverte par dossier bloqué, et par préfecture en désert
CREATE UNIQUE INDEX ux_alerte_dossier_ouverte ON alerte_territoriale (dossier_id)
  WHERE statut <> 'close' AND dossier_id IS NOT NULL;
CREATE UNIQUE INDEX ux_alerte_desert_ouverte ON alerte_territoriale (prefecture_id)
  WHERE statut <> 'close' AND type = 'desert_therapeutique';

-- ---------------------------------------------------------------------
-- 2. Cloisonnement : la DG voit tout ; le régional sa région ; le préfectoral sa préfecture ;
--    le Comité et les praticiens n'en voient aucune
-- ---------------------------------------------------------------------
CREATE FUNCTION alerte_visible(p_region smallint, p_prefecture smallint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE contexte_role()
    WHEN 'dg'          THEN true
    WHEN 'regional'    THEN p_region = nullif(current_setting('sabou.region_id', true), '')::smallint
    WHEN 'prefectoral' THEN p_prefecture IS NOT NULL AND zone_visible(p_prefecture)
    ELSE false
  END
$$;
ALTER TABLE alerte_territoriale ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON alerte_territoriale TO sabou_app
  USING (alerte_visible(region_admin_id, prefecture_id))
  WITH CHECK (alerte_visible(region_admin_id, prefecture_id));

-- ---------------------------------------------------------------------
-- 3. Détection automatique (appelée par l'API à chaque relève de la file des SMS). Elle
--    parcourt toutes les zones, d'où SECURITY DEFINER, et ne fait que cela. Renvoie le nombre
--    d'alertes créées. p_maintenant : heure de référence, fixée par les tests.
-- ---------------------------------------------------------------------
CREATE FUNCTION alertes_detecter(p_maintenant timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sabou, pg_catalog, pg_temp AS $$
DECLARE v_nouvelles integer := 0;
        v_n         integer;
BEGIN
  -- Dossiers qui ont avancé, préfectures qui ont un praticien certifié : alerte close
  UPDATE alerte_territoriale a
     SET statut = 'close', close_le = p_maintenant, close_motif = 'Résolue : le dossier a avancé.'
    FROM dossier_certification d
   WHERE a.dossier_id = d.id AND a.statut <> 'close'
     AND (d.statut <> 'en_cours' OR d.etape_entree_le >= p_maintenant - interval '15 days');
  UPDATE alerte_territoriale a
     SET statut = 'close', close_le = p_maintenant,
         close_motif = 'Résolue : un praticien est certifié dans la préfecture.'
   WHERE a.type = 'desert_therapeutique' AND a.statut <> 'close'
     AND EXISTS (SELECT 1 FROM praticien p WHERE p.prefecture_id = a.prefecture_id AND p.statut = 'certifie');

  INSERT INTO alerte_territoriale (type, region_admin_id, prefecture_id, dossier_id, description, created_at)
  SELECT 'dossier_bloque', pf.region_admin_id, pf.id, d.id,
         d.code || ' : étape ' || d.etape_courante || ' depuis le '
           || to_char(d.etape_entree_le AT TIME ZONE 'Africa/Conakry', 'DD/MM/YYYY') || '.',
         p_maintenant
    FROM dossier_certification d
    JOIN praticien pr  ON pr.id = d.praticien_id
    JOIN prefecture pf ON pf.id = pr.prefecture_id
   WHERE d.statut = 'en_cours' AND d.etape_courante BETWEEN 2 AND 5
     AND d.etape_entree_le < p_maintenant - interval '15 days'
     AND NOT EXISTS (SELECT 1 FROM alerte_territoriale a WHERE a.dossier_id = d.id AND a.statut <> 'close');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_nouvelles := v_nouvelles + v_n;

  INSERT INTO alerte_territoriale (type, region_admin_id, prefecture_id, description, created_at)
  SELECT 'desert_therapeutique', pf.region_admin_id, pf.id,
         'Aucun praticien certifié dans la préfecture de ' || pf.nom || '.', p_maintenant
    FROM prefecture pf
   WHERE pf.active
     AND NOT EXISTS (SELECT 1 FROM praticien p WHERE p.prefecture_id = pf.id AND p.statut = 'certifie')
     AND NOT EXISTS (SELECT 1 FROM alerte_territoriale a
                      WHERE a.prefecture_id = pf.id AND a.type = 'desert_therapeutique' AND a.statut <> 'close');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_nouvelles + v_n;
END $$;
REVOKE EXECUTE ON FUNCTION alertes_detecter(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION alertes_detecter(timestamptz) TO sabou_app;

-- ---------------------------------------------------------------------
-- 4. Actions (rôle de l'API ; acteur lu dans le contexte de zone)
-- ---------------------------------------------------------------------
CREATE FUNCTION alerte_acteur() RETURNS utilisateur LANGUAGE plpgsql STABLE AS $$
DECLARE v_usr utilisateur%ROWTYPE;
BEGIN
  SELECT * INTO v_usr FROM utilisateur WHERE id = contexte_utilisateur() AND statut = 'actif'
     AND role_code IN ('dg','regional','prefectoral');
  IF NOT FOUND THEN RAISE EXCEPTION 'Alerte : action réservée à l''administration territoriale'; END IF;
  RETURN v_usr;
END $$;

-- Alerte visible et verrouillée ; hors zone, introuvable (RLS)
CREATE FUNCTION alerte_lire(p_id bigint) RETURNS alerte_territoriale LANGUAGE plpgsql AS $$
DECLARE v_ale alerte_territoriale%ROWTYPE;
BEGIN
  SELECT * INTO v_ale FROM alerte_territoriale WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alerte % introuvable', p_id; END IF;
  IF v_ale.statut = 'close' THEN RAISE EXCEPTION 'Alerte % close : aucune action possible', p_id; END IF;
  RETURN v_ale;
END $$;

-- Hausse de pathologie : le préfectoral pour sa préfecture, la DG pour toute préfecture
CREATE FUNCTION alerte_declarer(p_prefecture smallint, p_maladie text, p_description text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_usr    utilisateur%ROWTYPE := alerte_acteur();
        v_region smallint;
        v_mal    bigint;
        v_id     bigint;
BEGIN
  IF v_usr.role_code NOT IN ('prefectoral','dg')
     OR (v_usr.role_code = 'prefectoral' AND v_usr.prefecture_id IS DISTINCT FROM p_prefecture) THEN
    RAISE EXCEPTION 'Alerte : déclaration réservée au préfectoral de la préfecture et à la DG';
  END IF;
  SELECT region_admin_id INTO v_region FROM prefecture WHERE id = p_prefecture AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alerte : préfecture inconnue'; END IF;
  SELECT id INTO v_mal FROM maladie WHERE code = p_maladie;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alerte : maladie inconnue'; END IF;
  INSERT INTO alerte_territoriale (type, region_admin_id, prefecture_id, maladie_id, description, declaree_par)
  VALUES ('hausse_pathologie', v_region, p_prefecture, v_mal, btrim(p_description), v_usr.id)
  RETURNING id INTO v_id;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr.id, 'alerte.declaree', 'alerte', v_id::text,
          jsonb_build_object('prefecture', p_prefecture, 'maladie', p_maladie));
  RETURN v_id;
END $$;

-- Accusé de réception : le responsable a pris connaissance de l'alerte
CREATE FUNCTION alerte_accuser(p_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_usr utilisateur%ROWTYPE := alerte_acteur();
        v_ale alerte_territoriale%ROWTYPE := alerte_lire(p_id);
BEGIN
  IF v_ale.statut = 'accusee' THEN RAISE EXCEPTION 'Alerte % : accusé de réception déjà donné', p_id; END IF;
  UPDATE alerte_territoriale SET statut = 'accusee', accusee_le = now(), accusee_par = v_usr.id
   WHERE id = p_id;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr.id, 'alerte.accusee', 'alerte', p_id::text, '{}'::jsonb);
END $$;

-- Relance (régional ou DG) : l'alerte repasse « relancée » et les responsables sont prévenus
-- dans l'application et par e-mail (en file). Une relance par jour au plus.
CREATE FUNCTION alerte_relancer(p_id bigint) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_usr   utilisateur%ROWTYPE := alerte_acteur();
        v_ale   alerte_territoriale%ROWTYPE := alerte_lire(p_id);
        v_etape smallint;
        v_n     integer;
BEGIN
  IF v_usr.role_code NOT IN ('regional','dg') THEN
    RAISE EXCEPTION 'Alerte : relance réservée au régional et à la DG';
  END IF;
  IF v_ale.relancee_le > now() - interval '1 day' THEN
    RAISE EXCEPTION 'Alerte % : déjà relancée il y a moins d''un jour', p_id;
  END IF;
  SELECT etape_courante INTO v_etape FROM dossier_certification WHERE id = v_ale.dossier_id;
  UPDATE alerte_territoriale
     SET statut = 'relancee', relances = relances + 1, relancee_le = now()
   WHERE id = p_id;
  -- Responsables : régionaux actifs de la région ; préfectoraux de la préfecture pour un
  -- dossier bloqué à l'étape 2 (vérification sur le terrain)
  INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
  SELECT u.id, c.canal, 'alerte.relance', 'alerte', p_id::text,
         jsonb_build_object('type', v_ale.type, 'relances', v_ale.relances + 1)
    FROM utilisateur u
    CROSS JOIN (VALUES ('application'), ('email')) AS c(canal)
    LEFT JOIN prefecture pf ON pf.id = u.prefecture_id
   WHERE u.statut = 'actif' AND u.id <> v_usr.id
     AND ((u.role_code = 'regional' AND u.region_admin_id = v_ale.region_admin_id)
          OR (u.role_code = 'prefectoral' AND v_etape = 2 AND u.prefecture_id = v_ale.prefecture_id));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr.id, 'alerte.relancee', 'alerte', p_id::text,
          jsonb_build_object('relances', v_ale.relances + 1, 'notifications', v_n));
  RETURN v_n / 2;
END $$;

-- Clôture motivée (régional ou DG)
CREATE FUNCTION alerte_clore(p_id bigint, p_motif text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_usr utilisateur%ROWTYPE := alerte_acteur();
        v_ale alerte_territoriale%ROWTYPE := alerte_lire(p_id);
BEGIN
  IF v_usr.role_code NOT IN ('regional','dg') THEN
    RAISE EXCEPTION 'Alerte : clôture réservée au régional et à la DG';
  END IF;
  UPDATE alerte_territoriale
     SET statut = 'close', close_le = now(), close_motif = btrim(p_motif), close_par = v_usr.id
   WHERE id = v_ale.id;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr.id, 'alerte.close', 'alerte', p_id::text, '{}'::jsonb);
END $$;
