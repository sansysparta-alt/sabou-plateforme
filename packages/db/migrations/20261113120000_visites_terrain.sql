-- US-041 : planifier et réaliser les visites terrain (UC-30, R-CER-06, R-MOD-02).
-- Décision du maître d'œuvre (12 novembre 2026) : le compte rendu est saisi en ligne par
-- l'admin préfectoral, connecté avec son second facteur ; le texte est figé, avec son
-- empreinte SHA3-256 (calculée par l'API, comme celle des certificats, R-QR-02), son auteur
-- et l'heure de signature, tracés au journal d'audit. La photo de la fiche papier est
-- facultative (pièce « compte_rendu_visite », compte_rendu_piece_id).
SET search_path = sabou, public;

ALTER TABLE visite_terrain
  ADD COLUMN constats       text CHECK (char_length(constats) <= 5000 AND btrim(constats) <> ''),
  ADD COLUMN avis           text CHECK (avis IN ('favorable','reserve','defavorable')),
  ADD COLUMN empreinte_sha3 char(64) CHECK (empreinte_sha3 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN signe_par      bigint REFERENCES utilisateur(id),
  ADD COLUMN signe_le       timestamptz,
  DROP CONSTRAINT ck_visite_realisee,
  -- Une visite réalisée porte toujours son compte rendu signé (critère 2 de US-041)
  ADD CONSTRAINT ck_visite_realisee CHECK (
    statut <> 'realisee' OR (realisee_le IS NOT NULL AND constats IS NOT NULL AND avis IS NOT NULL
                             AND empreinte_sha3 IS NOT NULL AND signe_par IS NOT NULL
                             AND signe_le IS NOT NULL));

COMMENT ON COLUMN visite_terrain.rappel_envoye_le IS
  'Heure de mise en file du rappel au praticien (la veille de la visite) ; NULL tant qu''il n''est pas parti.';
COMMENT ON COLUMN visite_terrain.compte_rendu_piece_id IS
  'Photo facultative de la fiche papier ; le compte rendu qui fait foi est le texte signé (constats, avis).';
COMMENT ON COLUMN visite_terrain.empreinte_sha3 IS
  'SHA3-256 du compte rendu (version, dossier, visite, date, avis, constats, auteur), calculé par l''API.';

-- Une seule visite planifiée à la fois par dossier : replanifier change sa date
CREATE UNIQUE INDEX ux_visite_planifiee ON visite_terrain (dossier_id) WHERE statut = 'planifiee';
-- Rappels à mettre en file : visites planifiées dont le rappel n'est pas parti
CREATE INDEX ix_visite_rappel ON visite_terrain (prevue_le) WHERE statut = 'planifiee' AND rappel_envoye_le IS NULL;

-- ---------------------------------------------------------------------
-- Compte rendu figé : une visite réalisée ne change plus, sauf l'ajout unique de la photo
-- de la fiche papier ; une visite annulée non plus. Vaut pour tous les rôles, y compris
-- le propriétaire des tables.
CREATE FUNCTION trg_visite_figee() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.statut = 'realisee'
     AND OLD.compte_rendu_piece_id IS NULL AND NEW.compte_rendu_piece_id IS NOT NULL
     AND (to_jsonb(NEW) - 'compte_rendu_piece_id') = (to_jsonb(OLD) - 'compte_rendu_piece_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Visite % % : compte rendu figé, aucune modification possible', OLD.id, OLD.statut
    USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER trg_visite_figee BEFORE UPDATE ON visite_terrain
  FOR EACH ROW WHEN (OLD.statut IN ('realisee','annulee')) EXECUTE FUNCTION trg_visite_figee();

-- ---------------------------------------------------------------------
-- Contrôles communs : dossier en cours à l'étape 2, acteur préfectoral actif de la
-- préfecture du praticien. Le RLS de zone seul laisserait passer l'admin régional et la DG,
-- qui voient le dossier ; la visite est l'affaire du préfectoral (R-MOD-02).
CREATE FUNCTION visite_controler(p_dossier bigint, p_acteur bigint)
RETURNS dossier_certification LANGUAGE plpgsql AS $$
DECLARE v_dos dossier_certification%ROWTYPE;
BEGIN
  SELECT * INTO v_dos FROM dossier_certification WHERE id = p_dossier FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dossier % introuvable', p_dossier; END IF;
  IF NOT EXISTS (
       SELECT 1 FROM utilisateur u JOIN praticien p ON p.id = v_dos.praticien_id
        WHERE u.id = p_acteur AND u.statut = 'actif' AND u.role_code = 'prefectoral'
          AND u.prefecture_id = p.prefecture_id) THEN
    RAISE EXCEPTION 'Acteur % non habilité pour les visites du dossier %', p_acteur, v_dos.code;
  END IF;
  IF v_dos.statut <> 'en_cours' OR v_dos.etape_courante <> 2 THEN
    RAISE EXCEPTION 'Dossier % : visite possible seulement à l''étape 2', v_dos.code;
  END IF;
  RETURN v_dos;
END $$;

-- Planifier (ou replanifier) la visite d'un dossier. Replanifier remet le rappel à zéro :
-- le praticien est prévenu la veille de la nouvelle date. Renvoie l'identifiant de la visite.
CREATE FUNCTION visite_planifier(p_dossier bigint, p_acteur bigint, p_prevue_le timestamptz)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_dos    dossier_certification%ROWTYPE;
        v_visite bigint;
BEGIN
  v_dos := visite_controler(p_dossier, p_acteur);
  IF p_prevue_le IS NULL OR p_prevue_le <= now() OR p_prevue_le > now() + interval '90 days' THEN
    RAISE EXCEPTION 'Dossier % : date de visite hors des 90 prochains jours', v_dos.code;
  END IF;

  UPDATE visite_terrain SET prevue_le = p_prevue_le, admin_id = p_acteur, rappel_envoye_le = NULL
   WHERE dossier_id = v_dos.id AND statut = 'planifiee'
  RETURNING id INTO v_visite;
  IF v_visite IS NULL THEN
    INSERT INTO visite_terrain (dossier_id, admin_id, prevue_le)
    VALUES (v_dos.id, p_acteur, p_prevue_le)
    RETURNING id INTO v_visite;
  END IF;

  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'visite.planifiee', 'dossier', v_dos.code,
          jsonb_build_object('visite', v_visite, 'prevue_le', p_prevue_le));
  RETURN v_visite;
END $$;

-- Enregistrer la visite planifiée comme réalisée, avec son compte rendu signé. p_realisee_le
-- est la date de la visite (heure de Conakry), entre la soumission du dossier et
-- aujourd'hui. L'auteur et l'heure de signature sont ceux de l'appel.
CREATE FUNCTION visite_realiser(p_dossier bigint, p_acteur bigint, p_visite bigint,
                                p_realisee_le date, p_constats text, p_avis text,
                                p_empreinte text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_dos dossier_certification%ROWTYPE;
        v_aujourdhui date := (now() AT TIME ZONE 'Africa/Conakry')::date;
BEGIN
  v_dos := visite_controler(p_dossier, p_acteur);
  PERFORM 1 FROM visite_terrain
   WHERE id = p_visite AND dossier_id = v_dos.id AND statut = 'planifiee' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dossier % : aucune visite planifiée à enregistrer', v_dos.code;
  END IF;
  IF p_realisee_le IS NULL OR p_realisee_le > v_aujourdhui
     OR p_realisee_le < (v_dos.etape_entree_le AT TIME ZONE 'Africa/Conakry')::date THEN
    RAISE EXCEPTION 'Dossier % : date de visite entre la soumission et aujourd''hui', v_dos.code;
  END IF;

  UPDATE visite_terrain
     SET statut = 'realisee',
         realisee_le = p_realisee_le::timestamp AT TIME ZONE 'Africa/Conakry',
         constats = p_constats, avis = p_avis, empreinte_sha3 = p_empreinte,
         signe_par = p_acteur, signe_le = now()
   WHERE id = p_visite;

  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'visite.realisee', 'dossier', v_dos.code,
          jsonb_build_object('visite', p_visite, 'realisee_le', p_realisee_le, 'avis', p_avis,
                             'empreinte_sha3', p_empreinte));
  RETURN p_visite;
END $$;

-- Joindre la photo de la fiche papier à une visite réalisée (facultatif, une seule fois),
-- tant que le dossier est à l'étape 2. Le fichier est déjà dans le stockage ; la base garde
-- sa clé et son empreinte. Renvoie l'identifiant de la pièce.
CREATE FUNCTION visite_photo_joindre(p_dossier bigint, p_acteur bigint, p_visite bigint,
                                     p_cle text, p_sha256 text, p_type_mime text, p_taille integer)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_dos   dossier_certification%ROWTYPE;
        v_piece bigint;
BEGIN
  v_dos := visite_controler(p_dossier, p_acteur);
  PERFORM 1 FROM visite_terrain
   WHERE id = p_visite AND dossier_id = v_dos.id AND statut = 'realisee'
     AND compte_rendu_piece_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dossier % : photo possible une seule fois, sur une visite réalisée', v_dos.code;
  END IF;
  INSERT INTO dossier_piece (dossier_id, type, fichier_url, sha256, depose_par, type_mime, taille_octets)
  VALUES (v_dos.id, 'compte_rendu_visite', p_cle, p_sha256, p_acteur, p_type_mime, p_taille)
  RETURNING id INTO v_piece;
  UPDATE visite_terrain SET compte_rendu_piece_id = v_piece WHERE id = p_visite;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'visite.photo', 'dossier', v_dos.code,
          jsonb_build_object('visite', p_visite, 'piece', v_piece, 'sha256', p_sha256));
  RETURN v_piece;
END $$;

-- ---------------------------------------------------------------------
-- Rappel au praticien la veille de sa visite (critère 1 de US-041), à partir de 8 h
-- (heure de Conakry) : pas de SMS la nuit. Une visite planifiée moins d'un jour à l'avance
-- reçoit son rappel au passage suivant. Appelée par l'API avant chaque relève de la file
-- des SMS ; elle parcourt toutes les zones, d'où SECURITY DEFINER, et ne fait que cela.
-- Le SMS ne donne que la date et le code du dossier, figés à la mise en file.
-- p_maintenant : l'heure de référence, fixée par les tests ; l'API ne la passe pas.
CREATE FUNCTION visite_rappels_mettre_en_file(p_maintenant timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sabou, pg_catalog, pg_temp AS $$
DECLARE v_nombre integer;
BEGIN
  WITH dues AS (
    SELECT vt.id FROM visite_terrain vt
     WHERE vt.statut = 'planifiee' AND vt.rappel_envoye_le IS NULL AND vt.prevue_le > p_maintenant
       AND p_maintenant >= (((vt.prevue_le AT TIME ZONE 'Africa/Conakry')::date - 1) + time '08:00')
                    AT TIME ZONE 'Africa/Conakry'
     FOR UPDATE SKIP LOCKED),
  marquees AS (
    UPDATE visite_terrain vt SET rappel_envoye_le = now()
      FROM dues WHERE vt.id = dues.id
    RETURNING vt.dossier_id, vt.prevue_le)
  INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
  SELECT p.utilisateur_id, 'sms', 'visite.rappel', 'dossier', d.code,
         jsonb_build_object('prevueLe', to_char(m.prevue_le AT TIME ZONE 'Africa/Conakry',
                                                'YYYY-MM-DD"T"HH24:MI'))
    FROM marquees m
    JOIN dossier_certification d ON d.id = m.dossier_id
    JOIN praticien p             ON p.id = d.praticien_id;
  GET DIAGNOSTICS v_nombre = ROW_COUNT;
  RETURN v_nombre;
END $$;
REVOKE EXECUTE ON FUNCTION visite_rappels_mettre_en_file(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION visite_rappels_mettre_en_file(timestamptz) TO sabou_app;
