-- US-022 : suivre un redécoupage administratif sans migration ni redéploiement
-- (R-ACC-08, 05_Choix_Techniques.md §2.59). Décisions du maître d'œuvre du 17 novembre 2026 :
--   - trois opérations : rattacher une préfecture à une autre région ; rattacher une
--     sous-préfecture à une autre préfecture (découpage : les praticiens suivent leur
--     sous-préfecture) ; fusionner deux préfectures (la préfecture absorbée reste en base,
--     inactive) ;
--   - fusion : les comptes préfectoraux de la préfecture absorbée sont suspendus jusqu'à
--     leur réaffectation par la DG (l'API coupe aussi leurs sessions et leur accès Keycloak) ;
--   - les certificats gardent le territoire de leur émission (colonnes d'origine) ;
--   - pas d'annulation : on corrige par l'opération inverse, elle aussi journalisée (par
--     l'API, dans la même transaction, avec l'aperçu de ce qui a bougé).
-- Les fonctions sont SECURITY DEFINER : un redécoupage déplace des lignes de toutes les
-- zones, ce que le cloisonnement (RLS) interdit au rôle de l'API. Elles vérifient
-- elles-mêmes que l'acteur est un compte DG actif.
SET search_path = sabou, public;

-- ---------- 1. Territoires actifs ou remplacés ----------
ALTER TABLE region_admin    ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE prefecture      ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE sous_prefecture ADD COLUMN active boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN prefecture.active IS
  'Faux : territoire remplacé par un redécoupage (US-022), conservé pour l''historique ; plus aucun rattachement nouveau.';

-- Un rattachement nouveau (ou modifié) vers un territoire inactif est refusé ; une ligne
-- qui garde son territoire reste modifiable (même principe que les langues, R-LNG).
-- TG_ARGV : colonne, table du territoire.
CREATE FUNCTION trg_ck_territoire_actif() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id  text := to_jsonb(NEW) ->> TG_ARGV[0];
        v_ok  boolean;
BEGIN
  IF v_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> TG_ARGV[0]) IS NOT DISTINCT FROM v_id THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT active FROM sabou.%I WHERE id = $1', TG_ARGV[1]) INTO v_ok USING v_id::smallint;
  IF v_ok IS FALSE THEN
    RAISE EXCEPTION 'Territoire inactif (%.% = %)', TG_TABLE_NAME, TG_ARGV[0], v_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ck_territoire_actif';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_prefecture_region_active BEFORE INSERT OR UPDATE OF region_admin_id ON prefecture
  FOR EACH ROW EXECUTE FUNCTION trg_ck_territoire_actif('region_admin_id', 'region_admin');
CREATE TRIGGER trg_sous_prefecture_active BEFORE INSERT OR UPDATE OF prefecture_id ON sous_prefecture
  FOR EACH ROW EXECUTE FUNCTION trg_ck_territoire_actif('prefecture_id', 'prefecture');
CREATE TRIGGER trg_praticien_prefecture_active BEFORE INSERT OR UPDATE OF prefecture_id ON praticien
  FOR EACH ROW EXECUTE FUNCTION trg_ck_territoire_actif('prefecture_id', 'prefecture');
CREATE TRIGGER trg_praticien_sous_prefecture_active BEFORE INSERT OR UPDATE OF sous_prefecture_id ON praticien
  FOR EACH ROW EXECUTE FUNCTION trg_ck_territoire_actif('sous_prefecture_id', 'sous_prefecture');
CREATE TRIGGER trg_utilisateur_prefecture_active BEFORE INSERT OR UPDATE OF prefecture_id ON utilisateur
  FOR EACH ROW EXECUTE FUNCTION trg_ck_territoire_actif('prefecture_id', 'prefecture');
CREATE TRIGGER trg_utilisateur_region_active BEFORE INSERT OR UPDATE OF region_admin_id ON utilisateur
  FOR EACH ROW EXECUTE FUNCTION trg_ck_territoire_actif('region_admin_id', 'region_admin');

-- ---------- 2. Territoire d'origine des certificats ----------
ALTER TABLE certificat
  ADD COLUMN prefecture_origine_id smallint REFERENCES prefecture(id),
  ADD COLUMN region_origine_id     smallint REFERENCES region_admin(id);

-- Reprise des certificats existants : leur territoire est celui du praticien aujourd'hui,
-- aucun redécoupage n'ayant été appliqué depuis leur émission (US-023 n'a déplacé que des
-- préfectures entières : la région d'origine retenue est celle du découpage en vigueur).
UPDATE certificat c
   SET prefecture_origine_id = p.prefecture_id, region_origine_id = pf.region_admin_id
  FROM praticien p JOIN prefecture pf ON pf.id = p.prefecture_id
 WHERE p.id = c.praticien_id;

ALTER TABLE certificat
  ALTER COLUMN prefecture_origine_id SET NOT NULL,
  ALTER COLUMN region_origine_id SET NOT NULL;
COMMENT ON COLUMN certificat.prefecture_origine_id IS
  'Préfecture du praticien à l''émission, figée : un redécoupage ultérieur ne la change pas (US-022).';

CREATE FUNCTION trg_certificat_origine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.prefecture_id, pf.region_admin_id
      INTO NEW.prefecture_origine_id, NEW.region_origine_id
      FROM sabou.praticien p JOIN sabou.prefecture pf ON pf.id = p.prefecture_id
     WHERE p.id = NEW.praticien_id;
  ELSIF NEW.prefecture_origine_id IS DISTINCT FROM OLD.prefecture_origine_id
     OR NEW.region_origine_id IS DISTINCT FROM OLD.region_origine_id THEN
    RAISE EXCEPTION 'Le territoire d''origine d''un certificat est figé'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ck_certificat_origine';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_certificat_origine BEFORE INSERT OR UPDATE ON certificat
  FOR EACH ROW EXECUTE FUNCTION trg_certificat_origine();

-- ---------- 3. Aperçu et application d'un redécoupage ----------
-- Contrôles communs. Renvoie l'ancien parent de l'objet.
CREATE FUNCTION redecoupage_controler(p_operation text, p_objet smallint, p_cible smallint, p_acteur bigint)
RETURNS smallint
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = sabou, pg_catalog, pg_temp AS $$
DECLARE v_parent smallint;
        v_objet_actif boolean;
        v_cible_actif boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM utilisateur WHERE id = p_acteur AND role_code = 'dg' AND statut = 'actif') THEN
    RAISE EXCEPTION 'Redécoupage réservé à la DG' USING ERRCODE = 'insufficient_privilege';
  END IF;
  CASE p_operation
    WHEN 'rattacher_prefecture' THEN
      SELECT region_admin_id, active INTO v_parent, v_objet_actif FROM prefecture WHERE id = p_objet;
      SELECT active INTO v_cible_actif FROM region_admin WHERE id = p_cible;
    WHEN 'rattacher_sous_prefecture' THEN
      SELECT prefecture_id, active INTO v_parent, v_objet_actif FROM sous_prefecture WHERE id = p_objet;
      SELECT active INTO v_cible_actif FROM prefecture WHERE id = p_cible;
    WHEN 'fusionner_prefectures' THEN
      SELECT region_admin_id, active INTO v_parent, v_objet_actif FROM prefecture WHERE id = p_objet;
      SELECT active INTO v_cible_actif FROM prefecture WHERE id = p_cible;
    ELSE
      RAISE EXCEPTION 'Opération inconnue : %', p_operation USING ERRCODE = 'invalid_parameter_value';
  END CASE;
  IF v_objet_actif IS NULL OR v_cible_actif IS NULL THEN
    RAISE EXCEPTION 'Territoire introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (v_objet_actif AND v_cible_actif) THEN
    RAISE EXCEPTION 'Territoire inactif' USING ERRCODE = 'check_violation', CONSTRAINT = 'ck_territoire_actif';
  END IF;
  IF (p_operation = 'fusionner_prefectures' AND p_objet = p_cible)
     OR (p_operation <> 'fusionner_prefectures' AND v_parent = p_cible) THEN
    RAISE EXCEPTION 'Rien ne change' USING ERRCODE = 'check_violation', CONSTRAINT = 'ck_redecoupage_identique';
  END IF;
  RETURN v_parent;
END $$;

-- Ce qui bouge, sans rien modifier : la DG le voit avant de confirmer, et la même valeur
-- est journalisée avec l'opération.
CREATE FUNCTION redecoupage_apercu(p_operation text, p_objet smallint, p_cible smallint, p_acteur bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = sabou, pg_catalog, pg_temp AS $$
DECLARE v_parent      smallint := redecoupage_controler(p_operation, p_objet, p_cible, p_acteur);
        v_praticiens  bigint[];
        v_region_av   smallint;   -- région de l'objet avant
        v_region_ap   smallint;   -- région de l'objet après
        v_pref_av     smallint;   -- préfecture avant (sous-préfecture, fusion)
        v_pref_ap     smallint;
        v_autres      int := 0;
        v_sous_pref   int := 0;
        v_admins      jsonb;
        v_noms        jsonb;
BEGIN
  IF p_operation = 'rattacher_prefecture' THEN
    v_region_av := v_parent; v_region_ap := p_cible;
    SELECT array_agg(id) INTO v_praticiens FROM praticien WHERE prefecture_id = p_objet;
    SELECT count(*) INTO v_autres FROM (
      SELECT 1 FROM alerte_territoriale WHERE prefecture_id = p_objet
      UNION ALL SELECT 1 FROM forum_discussion WHERE prefecture_id = p_objet AND region_admin_id IS NOT NULL) x;
    v_noms := jsonb_build_object(
      'objet',  (SELECT nom FROM prefecture WHERE id = p_objet),
      'avant',  (SELECT nom FROM region_admin WHERE id = v_parent),
      'cible',  (SELECT nom FROM region_admin WHERE id = p_cible));
  ELSE
    IF p_operation = 'rattacher_sous_prefecture' THEN
      v_pref_av := v_parent; v_pref_ap := p_cible;
      SELECT array_agg(id) INTO v_praticiens FROM praticien WHERE sous_prefecture_id = p_objet;
      v_noms := jsonb_build_object(
        'objet', (SELECT nom FROM sous_prefecture WHERE id = p_objet),
        'avant', (SELECT nom FROM prefecture WHERE id = v_parent),
        'cible', (SELECT nom FROM prefecture WHERE id = p_cible));
    ELSE
      v_pref_av := p_objet; v_pref_ap := p_cible;
      SELECT array_agg(id) INTO v_praticiens FROM praticien WHERE prefecture_id = p_objet;
      SELECT count(*) INTO v_sous_pref FROM sous_prefecture WHERE prefecture_id = p_objet;
      SELECT count(*) INTO v_autres FROM (
        SELECT 1 FROM demande_plante WHERE prefecture_id = p_objet
        UNION ALL SELECT 1 FROM signalement_sanitaire WHERE prefecture_id = p_objet
        UNION ALL SELECT 1 FROM litige WHERE prefecture_id = p_objet
        UNION ALL SELECT 1 FROM saisie_terrain WHERE prefecture_id = p_objet
        UNION ALL SELECT 1 FROM alerte_territoriale WHERE prefecture_id = p_objet
        UNION ALL SELECT 1 FROM forum_discussion WHERE prefecture_id = p_objet) x;
      v_noms := jsonb_build_object(
        'objet', (SELECT nom FROM prefecture WHERE id = p_objet),
        'avant', (SELECT r.nom FROM prefecture p JOIN region_admin r ON r.id = p.region_admin_id WHERE p.id = p_objet),
        'cible', (SELECT nom FROM prefecture WHERE id = p_cible));
    END IF;
    SELECT region_admin_id INTO v_region_av FROM prefecture WHERE id = v_pref_av;
    SELECT region_admin_id INTO v_region_ap FROM prefecture WHERE id = v_pref_ap;
  END IF;

  -- Administrateurs actifs dont le territoire visible change
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'nom', trim(coalesce(a.prenom, '') || ' ' || coalesce(a.nom, '')),
           'email', a.email, 'role', a.role_code, 'effet', a.effet) ORDER BY a.effet, a.nom, a.id), '[]')
    INTO v_admins
    FROM (
      SELECT u.*, CASE WHEN p_operation = 'fusionner_prefectures' THEN 'suspendu' ELSE 'perd' END AS effet
        FROM utilisateur u
       WHERE u.statut = 'actif' AND u.role_code = 'prefectoral' AND u.prefecture_id = v_pref_av
      UNION ALL
      SELECT u.*, 'gagne' FROM utilisateur u
       WHERE u.statut = 'actif' AND u.role_code = 'prefectoral' AND u.prefecture_id = v_pref_ap
      UNION ALL
      SELECT u.*, 'perd' FROM utilisateur u
       WHERE v_region_av <> v_region_ap
         AND u.statut = 'actif' AND u.role_code = 'regional' AND u.region_admin_id = v_region_av
      UNION ALL
      SELECT u.*, 'gagne' FROM utilisateur u
       WHERE v_region_av <> v_region_ap
         AND u.statut = 'actif' AND u.role_code = 'regional' AND u.region_admin_id = v_region_ap
    ) a;

  RETURN jsonb_build_object(
    'operation',       p_operation,
    'objetId',         p_objet,
    'cibleId',         p_cible,
    'objet',           v_noms ->> 'objet',
    'avant',           v_noms ->> 'avant',
    'cible',           v_noms ->> 'cible',
    'praticiens',      coalesce(cardinality(v_praticiens), 0),
    'dossiers',        (SELECT count(*) FROM dossier_certification WHERE praticien_id = ANY (coalesce(v_praticiens, '{}'))),
    'sousPrefectures', v_sous_pref,
    'autres',          v_autres,
    'administrateurs', v_admins);
END $$;

-- Application, dans la transaction de l'appelant. Renvoie l'aperçu calculé juste avant,
-- à journaliser tel quel ; les comptes suspendus y figurent (effet « suspendu »).
CREATE FUNCTION redecoupage_appliquer(p_operation text, p_objet smallint, p_cible smallint, p_acteur bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = sabou, pg_catalog, pg_temp AS $$
DECLARE v_apercu jsonb;
        v_region smallint;
BEGIN
  -- Verrou : deux redécoupages simultanés ne se croisent pas
  LOCK TABLE prefecture, sous_prefecture IN SHARE ROW EXCLUSIVE MODE;
  v_apercu := redecoupage_apercu(p_operation, p_objet, p_cible, p_acteur);

  IF p_operation = 'rattacher_prefecture' THEN
    UPDATE prefecture SET region_admin_id = p_cible WHERE id = p_objet;
    UPDATE alerte_territoriale SET region_admin_id = p_cible WHERE prefecture_id = p_objet;
    UPDATE forum_discussion SET region_admin_id = p_cible
     WHERE prefecture_id = p_objet AND region_admin_id IS NOT NULL;

  ELSIF p_operation = 'rattacher_sous_prefecture' THEN
    UPDATE sous_prefecture SET prefecture_id = p_cible WHERE id = p_objet;
    UPDATE praticien SET prefecture_id = p_cible WHERE sous_prefecture_id = p_objet;

  ELSE -- fusionner_prefectures : p_objet est absorbée par p_cible
    SELECT region_admin_id INTO v_region FROM prefecture WHERE id = p_cible;
    UPDATE sous_prefecture       SET prefecture_id = p_cible WHERE prefecture_id = p_objet;
    UPDATE praticien             SET prefecture_id = p_cible WHERE prefecture_id = p_objet;
    UPDATE demande_plante        SET prefecture_id = p_cible WHERE prefecture_id = p_objet;
    UPDATE signalement_sanitaire SET prefecture_id = p_cible WHERE prefecture_id = p_objet;
    UPDATE litige                SET prefecture_id = p_cible WHERE prefecture_id = p_objet;
    UPDATE saisie_terrain        SET prefecture_id = p_cible WHERE prefecture_id = p_objet;
    UPDATE alerte_territoriale   SET prefecture_id = p_cible, region_admin_id = v_region
     WHERE prefecture_id = p_objet;
    UPDATE forum_discussion
       SET prefecture_id = p_cible,
           region_admin_id = CASE WHEN region_admin_id IS NULL THEN NULL ELSE v_region END
     WHERE prefecture_id = p_objet;
    -- Comptes préfectoraux suspendus jusqu'à réaffectation (décision 1b) ; ils gardent leur
    -- ancienne préfecture, que la DG remplace en les réaffectant
    UPDATE utilisateur SET statut = 'suspendu'
     WHERE role_code = 'prefectoral' AND prefecture_id = p_objet AND statut = 'actif';
    UPDATE utilisateur SET prefecture_id = p_cible
     WHERE role_code <> 'prefectoral' AND prefecture_id = p_objet;
    UPDATE prefecture SET active = false WHERE id = p_objet;
  END IF;
  RETURN v_apercu;
END $$;

REVOKE EXECUTE ON FUNCTION redecoupage_controler(text, smallint, smallint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION redecoupage_apercu(text, smallint, smallint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION redecoupage_appliquer(text, smallint, smallint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redecoupage_apercu(text, smallint, smallint, bigint) TO sabou_app;
GRANT EXECUTE ON FUNCTION redecoupage_appliquer(text, smallint, smallint, bigint) TO sabou_app;
COMMENT ON FUNCTION redecoupage_appliquer(text, smallint, smallint, bigint) IS
  'US-022 : rattacher une préfecture, rattacher une sous-préfecture, fusionner deux préfectures ; renvoie l''aperçu à journaliser.';
