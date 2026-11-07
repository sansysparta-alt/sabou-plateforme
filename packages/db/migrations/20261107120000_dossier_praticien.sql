-- Dossier de certification soumis par le praticien (US-040a, 05_Choix_Techniques.md §2.26).
--   - Le praticien s'inscrit lui-même, comme le citoyen (domaine Keycloak « sabou-public ») :
--     numéro de mobile guinéen, prénom, nom, mot de passe ; adresse e-mail facultative.
--     Un numéro ne porte qu'un seul compte du domaine public (citoyen ou praticien).
--   - Sa fiche (spécialité, préfecture, langue) et son dossier sont créés par lui ; les
--     champs qui relèvent de l'administration (statut, code, notes, vues) lui sont fermés.
--   - Pièces : le praticien ne dépose que ses propres pièces, à l'étape 1 seulement.
--   - Soumission : refusée sans pièce d'identité ni photo (décision du maître d'œuvre du
--     7 novembre 2026 ; les justificatifs sont facultatifs et contrôlés lors de la visite).
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Comptes praticiens
-- ---------------------------------------------------------------------
ALTER TABLE utilisateur
  DROP CONSTRAINT ck_identite_role,
  -- E-mail et nom restent exigés pour les comptes d'administration
  ADD CONSTRAINT ck_identite_role CHECK (
    role_code IN ('citoyen','praticien') OR (email IS NOT NULL AND nom IS NOT NULL)),
  -- Praticien : nom (porté par le certificat), mobile guinéen, pas de zone d'administration
  ADD CONSTRAINT ck_praticien CHECK (
    role_code <> 'praticien' OR (
      nom IS NOT NULL
      AND telephone IS NOT NULL
      AND telephone ~ '^\+2246[0-9]{8}$'
      AND region_admin_id IS NULL
      AND prefecture_id IS NULL));

-- Les 9 chiffres du numéro sont l'identifiant de connexion du domaine public :
-- un seul compte par numéro, citoyen ou praticien
DROP INDEX ux_utilisateur_telephone_citoyen;
CREATE UNIQUE INDEX ux_utilisateur_telephone_public
  ON utilisateur (telephone) WHERE role_code IN ('citoyen','praticien');

COMMENT ON COLUMN utilisateur.telephone IS
  'Numéro au format international (+224…). Citoyen et praticien : mobile guinéen, unique dans le domaine Keycloak « sabou-public », dont ses 9 chiffres nationaux sont l''identifiant de connexion.';

-- ---------------------------------------------------------------------
-- 2. Codes lisibles, attribués par la base
-- ---------------------------------------------------------------------
-- Le jeu d'exemple utilise PR-1041… et DS-1041… : les codes attribués commencent à 2001
CREATE SEQUENCE praticien_code_seq START 2001;
CREATE SEQUENCE dossier_code_seq START 2001;
ALTER TABLE praticien ALTER COLUMN code SET DEFAULT 'PR-' || nextval('praticien_code_seq');
ALTER TABLE dossier_certification ALTER COLUMN code SET DEFAULT 'DS-' || nextval('dossier_code_seq');
GRANT USAGE, SELECT ON SEQUENCE praticien_code_seq, dossier_code_seq TO sabou_app;

-- ---------------------------------------------------------------------
-- 3. Ce que le praticien peut écrire lui-même
-- ---------------------------------------------------------------------
-- Fiche : à la création, statut « en attente », sans note ni vue ; ensuite, seuls
-- spécialité, localité, langue et expérience restent modifiables par lui
CREATE FUNCTION trg_praticien_par_praticien() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF contexte_role() IS DISTINCT FROM 'praticien' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.statut <> 'en_attente' OR NEW.note_moyenne IS NOT NULL OR NEW.nb_avis <> 0 OR NEW.nb_vues <> 0 THEN
      RAISE EXCEPTION 'Une nouvelle fiche de praticien est « en attente », sans note ni vue'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF (NEW.code, NEW.utilisateur_id, NEW.statut, NEW.note_moyenne, NEW.nb_avis, NEW.nb_vues)
        IS DISTINCT FROM
        (OLD.code, OLD.utilisateur_id, OLD.statut, OLD.note_moyenne, OLD.nb_avis, OLD.nb_vues) THEN
    RAISE EXCEPTION 'Le praticien ne modifie pas le code, le statut, les notes ni les vues de sa fiche'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_praticien_par_praticien BEFORE INSERT OR UPDATE ON praticien
  FOR EACH ROW EXECUTE FUNCTION trg_praticien_par_praticien();

-- Dossier : le praticien n'ouvre qu'un dossier initial, à l'étape 1
CREATE FUNCTION trg_dossier_par_praticien() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF contexte_role() IS DISTINCT FROM 'praticien' THEN RETURN NEW; END IF;
  IF NEW.etape_courante <> 1 OR NEW.statut <> 'en_cours' OR NEW.type <> 'initial' OR NOT NEW.visite_requise THEN
    RAISE EXCEPTION 'Le praticien ouvre un dossier initial, à l''étape 1'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_dossier_par_praticien BEFORE INSERT ON dossier_certification
  FOR EACH ROW EXECUTE FUNCTION trg_dossier_par_praticien();

-- Pièces : le praticien dépose ou retire ses pièces tant que le dossier est à l'étape 1 ;
-- le compte rendu de visite appartient au préfectoral (R-CER-06)
CREATE FUNCTION trg_piece_par_praticien() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_piece dossier_piece%ROWTYPE;
        v_etape smallint;
BEGIN
  IF contexte_role() IS DISTINCT FROM 'praticien' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_piece := CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  SELECT etape_courante INTO v_etape FROM dossier_certification
   WHERE id = v_piece.dossier_id AND statut = 'en_cours';
  IF TG_OP = 'UPDATE' OR v_etape IS DISTINCT FROM 1
     OR v_piece.type NOT IN ('identite','justificatif','photo','autre')
     OR (TG_OP = 'INSERT' AND NEW.depose_par IS DISTINCT FROM contexte_utilisateur()) THEN
    RAISE EXCEPTION 'Pièce non modifiable par le praticien à ce stade'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_piece;
END $$;
CREATE TRIGGER trg_piece_par_praticien BEFORE INSERT OR UPDATE OR DELETE ON dossier_piece
  FOR EACH ROW EXECUTE FUNCTION trg_piece_par_praticien();

-- Type et taille des pièces déposées (contrôlés aussi par l'API, sur le contenu du fichier)
ALTER TABLE dossier_piece
  ADD COLUMN type_mime text CHECK (type_mime IN ('image/jpeg','image/png','application/pdf')),
  ADD COLUMN taille_octets integer CHECK (taille_octets BETWEEN 1 AND 5242880);
COMMENT ON COLUMN dossier_piece.fichier_url IS
  'Clé de l''objet dans le stockage S3 (SeaweedFS), jamais une adresse publique : le fichier est servi par l''API, après contrôle des droits.';

-- ---------------------------------------------------------------------
-- 4. Soumission : pièces obligatoires
-- ---------------------------------------------------------------------
-- Pièces obligatoires manquantes d'un dossier, dans l'ordre d'affichage (aux droits de
-- l'appelant : le cloisonnement s'applique)
CREATE FUNCTION dossier_pieces_manquantes(p_dossier bigint) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(t.type ORDER BY t.ordre), '{}')
    FROM (VALUES ('identite', 1), ('photo', 2)) AS t(type, ordre)
   WHERE NOT EXISTS (SELECT 1 FROM dossier_piece p WHERE p.dossier_id = p_dossier AND p.type = t.type)
$$;
GRANT EXECUTE ON FUNCTION dossier_pieces_manquantes(bigint) TO sabou_app;

-- Contrôle porté par l'historique : toute soumission (étape 1 → 2) passe par lui
CREATE FUNCTION trg_dossier_soumission_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_manquantes text[];
BEGIN
  IF NEW.decision = 'soumis' THEN
    v_manquantes := dossier_pieces_manquantes(NEW.dossier_id);
    IF cardinality(v_manquantes) > 0 THEN
      RAISE EXCEPTION 'Pièces obligatoires manquantes : %', array_to_string(v_manquantes, ', ')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_dossier_soumission_complete BEFORE INSERT ON dossier_historique
  FOR EACH ROW EXECUTE FUNCTION trg_dossier_soumission_complete();
