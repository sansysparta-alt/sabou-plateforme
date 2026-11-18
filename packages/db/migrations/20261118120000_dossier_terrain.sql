-- US-040c : dossier terrain créé par l'Admin Préfectoral pour un praticien sans smartphone
-- (décision du maître d'ouvrage du 18 novembre 2026 : compte praticien sans mot de passe, le
-- SMS l'invite à le définir par « mot de passe oublié », US-069).
-- - dossier_certification.cree_par : l'agent qui a créé le dossier (mention et journal) ;
-- - seul un préfectoral crée un dossier terrain, pour sa préfecture, à l'étape 1 ;
-- - à l'étape 1, il dépose et retire les pièces du seul dossier qu'il a créé, et le soumet :
--   le dossier entre ensuite dans le circuit habituel (étapes 2 à 6, US-042 à US-047) ;
-- - dossier_terrain_ouvrir : compte, fiche, dossier et SMS au praticien, en une transaction.
SET search_path = sabou, public;

ALTER TABLE dossier_certification ADD COLUMN cree_par bigint REFERENCES utilisateur(id);
COMMENT ON COLUMN dossier_certification.cree_par IS
  'Agent préfectoral qui a créé ce dossier terrain (US-040c) ; NULL : dossier ouvert par le praticien.';

-- Création par le préfectoral de la préfecture du praticien, à l'étape 1 ; jamais modifiée
CREATE FUNCTION trg_dossier_terrain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.cree_par IS DISTINCT FROM OLD.cree_par THEN
      RAISE EXCEPTION 'L''auteur d''un dossier terrain ne change pas'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.cree_par IS NULL THEN RETURN NEW; END IF;
  IF contexte_role() IS DISTINCT FROM 'prefectoral'
     OR NEW.cree_par IS DISTINCT FROM contexte_utilisateur()
     OR NEW.etape_courante <> 1 OR NEW.statut <> 'en_cours' OR NEW.type <> 'initial'
     OR NOT EXISTS (SELECT 1 FROM praticien p JOIN utilisateur u ON u.id = NEW.cree_par
                     WHERE p.id = NEW.praticien_id AND p.prefecture_id = u.prefecture_id) THEN
    RAISE EXCEPTION 'Un dossier terrain est créé par l''agent préfectoral de la préfecture du praticien, à l''étape 1'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_dossier_terrain BEFORE INSERT OR UPDATE OF cree_par ON dossier_certification
  FOR EACH ROW EXECUTE FUNCTION trg_dossier_terrain();

-- Pièces à l'étape 1 : un préfectoral ne touche qu'aux pièces du dossier terrain qu'il a créé,
-- et seulement aux pièces du praticien (le compte rendu de visite vient à l'étape 2, R-CER-06)
CREATE FUNCTION trg_piece_terrain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_piece dossier_piece%ROWTYPE;
        v_dos   dossier_certification%ROWTYPE;
BEGIN
  v_piece := CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  IF contexte_role() IS DISTINCT FROM 'prefectoral' THEN RETURN v_piece; END IF;
  SELECT * INTO v_dos FROM dossier_certification WHERE id = v_piece.dossier_id;
  IF v_dos.etape_courante IS DISTINCT FROM 1 THEN RETURN v_piece; END IF;
  IF v_dos.statut <> 'en_cours' OR v_dos.cree_par IS DISTINCT FROM contexte_utilisateur()
     OR TG_OP = 'UPDATE'
     OR v_piece.type NOT IN ('identite','justificatif','photo','autre')
     OR (TG_OP = 'INSERT' AND NEW.depose_par IS DISTINCT FROM contexte_utilisateur()) THEN
    RAISE EXCEPTION 'Pièce non modifiable : seul l''agent qui a créé ce dossier terrain y dépose des pièces, à l''étape 1'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_piece;
END $$;
CREATE TRIGGER trg_piece_terrain BEFORE INSERT OR UPDATE OR DELETE ON dossier_piece
  FOR EACH ROW EXECUTE FUNCTION trg_piece_terrain();

-- Compte, fiche et dossier terrain, plus le SMS d'invitation au praticien, dans le contexte
-- de l'agent (cloisonnement et déclencheurs appliqués). Le compte Keycloak, sans mot de
-- passe, est créé avant par l'API. Renvoie le dossier et le compte du praticien.
CREATE FUNCTION dossier_terrain_ouvrir(
  p_keycloak_id uuid, p_telephone text, p_prenom text, p_nom text, p_specialite smallint,
  p_sous_prefecture smallint, p_langue text, p_annees smallint
) RETURNS TABLE (dossier_id bigint, dossier_code text, utilisateur_id bigint)
LANGUAGE plpgsql AS $$
DECLARE v_agent utilisateur%ROWTYPE;
        v_usr   bigint;
        v_pra   bigint;
        v_dos   dossier_certification%ROWTYPE;
BEGIN
  SELECT * INTO v_agent FROM utilisateur
   WHERE id = contexte_utilisateur() AND role_code = 'prefectoral' AND statut = 'actif';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dossier terrain réservé à l''agent préfectoral'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO utilisateur (telephone, prenom, nom, role_code, statut, keycloak_id)
  VALUES (p_telephone, p_prenom, p_nom, 'praticien', 'actif', p_keycloak_id)
  RETURNING id INTO v_usr;
  INSERT INTO praticien (utilisateur_id, specialite_id, prefecture_id, sous_prefecture_id,
                         langue_principale, annees_experience)
  VALUES (v_usr, p_specialite, v_agent.prefecture_id, p_sous_prefecture, p_langue, p_annees)
  RETURNING id INTO v_pra;
  INSERT INTO dossier_certification (praticien_id, cree_par)
  VALUES (v_pra, v_agent.id)
  RETURNING * INTO v_dos;
  INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
  VALUES (v_usr, 'sms', 'dossier.terrain_cree', 'dossier', v_dos.code, '{}'::jsonb);
  RETURN QUERY SELECT v_dos.id, v_dos.code, v_usr;
END $$;
GRANT EXECUTE ON FUNCTION dossier_terrain_ouvrir(uuid, text, text, text, smallint, smallint, text, smallint) TO sabou_app;

-- Transition d'un dossier : à l'étape 1, l'agent qui a créé le dossier terrain le soumet.
-- Seule cette règle change ; le reste est celui de 20261113170000_publication_traces.sql.
CREATE OR REPLACE FUNCTION dossier_transition(p_dossier bigint, p_decision text, p_acteur bigint, p_motif text DEFAULT NULL)
RETURNS smallint LANGUAGE plpgsql AS $$
DECLARE v_dos     dossier_certification%ROWTYPE;
        v_usr     utilisateur%ROWTYPE;
        v_pra     praticien%ROWTYPE;
        v_region  smallint;
        v_arrivee smallint;
        v_rec     record;
        v_quota   integer := 0;
        v_contenu integer := 0;
        v_raison  text;
BEGIN
  SELECT * INTO v_dos FROM dossier_certification WHERE id = p_dossier FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dossier % introuvable', p_dossier; END IF;
  IF v_dos.statut <> 'en_cours' THEN RAISE EXCEPTION 'Dossier % clos (%)', v_dos.code, v_dos.statut; END IF;

  SELECT * INTO v_usr FROM utilisateur WHERE id = p_acteur AND statut = 'actif';
  IF NOT FOUND THEN RAISE EXCEPTION 'Acteur % inconnu ou suspendu', p_acteur; END IF;
  SELECT * INTO v_pra FROM praticien WHERE id = v_dos.praticien_id;
  SELECT region_admin_id INTO v_region FROM prefecture WHERE id = v_pra.prefecture_id;

  IF p_decision = 'rejet_definitif' THEN
    IF v_usr.role_code <> 'dg' THEN RAISE EXCEPTION 'Le rejet définitif est réservé à la Direction Générale'; END IF;
    v_arrivee := v_dos.etape_courante;
  ELSE
    -- COALESCE : une zone absente (NULL) vaut refus, jamais autorisation
    IF NOT COALESCE(CASE v_dos.etape_courante
             -- Le praticien, ou l'agent préfectoral de sa préfecture pour le dossier terrain
             -- qu'il a lui-même créé (US-040c)
             WHEN 1 THEN v_usr.id = v_pra.utilisateur_id
                         OR (v_dos.cree_par = v_usr.id AND v_usr.role_code = 'prefectoral'
                             AND v_usr.prefecture_id = v_pra.prefecture_id)
             WHEN 2 THEN v_usr.role_code = 'prefectoral' AND v_usr.prefecture_id = v_pra.prefecture_id
             WHEN 3 THEN v_usr.role_code = 'regional' AND v_usr.region_admin_id = v_region
             WHEN 4 THEN v_usr.role_code = 'scientifique'
             ELSE v_usr.role_code = 'dg'
           END, false) THEN
      RAISE EXCEPTION 'Acteur % non habilité pour l''étape % du dossier %', p_acteur, v_dos.etape_courante, v_dos.code;
    END IF;
    v_arrivee := CASE
      WHEN p_decision = 'soumis' AND v_dos.etape_courante = 1             THEN 2
      WHEN p_decision = 'valide' AND v_dos.etape_courante BETWEEN 2 AND 5 THEN v_dos.etape_courante + 1
      WHEN p_decision = 'rejete' AND v_dos.etape_courante BETWEEN 2 AND 5 THEN v_dos.etape_courante - 1
      WHEN p_decision = 'publie' AND v_dos.etape_courante = 6             THEN 6
    END;
    IF v_arrivee IS NULL THEN
      RAISE EXCEPTION 'Décision « % » impossible à l''étape % du dossier %', p_decision, v_dos.etape_courante, v_dos.code;
    END IF;
  END IF;

  IF p_decision = 'valide' AND v_dos.etape_courante = 2 AND v_dos.visite_requise AND NOT EXISTS (
       SELECT 1 FROM visite_terrain vt WHERE vt.dossier_id = v_dos.id AND vt.statut = 'realisee') THEN
    RAISE EXCEPTION 'Dossier % : visite terrain signée requise avant validation (R-CER-06)', v_dos.code;
  END IF;
  IF p_decision = 'publie' AND NOT EXISTS (
       SELECT 1 FROM certificat c WHERE c.dossier_id = v_dos.id AND c.statut = 'actif') THEN
    RAISE EXCEPTION 'Dossier % : certificat signé requis avant publication', v_dos.code;
  END IF;

  INSERT INTO dossier_historique (dossier_id, etape_depart, etape_arrivee, decision, motif, acteur_id)
  VALUES (v_dos.id, v_dos.etape_courante, v_arrivee, p_decision, p_motif, p_acteur);

  UPDATE dossier_certification
     SET etape_courante  = v_arrivee,
         etape_entree_le = now(),
         statut     = CASE p_decision WHEN 'publie' THEN 'approuve' WHEN 'rejet_definitif' THEN 'rejete_definitif' ELSE 'en_cours' END,
         cloture_le = CASE WHEN p_decision IN ('publie','rejet_definitif') THEN now() END
   WHERE id = v_dos.id;

  IF p_decision = 'publie' THEN
    -- Le praticien d'abord : trg_recette_publiable exige un praticien certifié (R-REC-08)
    UPDATE praticien SET statut = 'certifie' WHERE id = v_pra.id;
    FOR v_rec IN SELECT id, code FROM recette
                  WHERE dossier_id = v_dos.id AND statut = 'expertisee' ORDER BY id FOR UPDATE
    LOOP
      BEGIN
        UPDATE recette SET statut = 'certifiee' WHERE id = v_rec.id;
        INSERT INTO recette_historique (recette_id, statut_depart, statut_arrivee, acteur_id)
        VALUES (v_rec.id, 'expertisee', 'certifiee', p_acteur);
        INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
        VALUES (p_acteur, 'recette.certifiee', 'recette', v_rec.code,
                jsonb_build_object('dossier', v_dos.code, 'automatique', true));
      EXCEPTION WHEN raise_exception THEN
        -- Refus de trg_recette_publiable : le traitement attend. Raison classée d'après
        -- l'état (pas d'après le texte de l'erreur) : quota de la formule gratuite atteint
        -- (R-REC-11), sinon contenu à compléter (plante non validée, section manquante, R-REC-06)
        IF formule_active(v_pra.id) = 'gratuit'
           AND (SELECT count(*) FROM recette r2
                 WHERE r2.praticien_id = v_pra.id AND r2.statut = 'certifiee') >= 3 THEN
          v_raison := 'quota';
          v_quota := v_quota + 1;
        ELSE
          v_raison := 'contenu';
          v_contenu := v_contenu + 1;
        END IF;
        UPDATE recette SET attente_raison = v_raison WHERE id = v_rec.id;
        INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
        VALUES (p_acteur, 'recette.certification_differee', 'recette', v_rec.code,
                jsonb_build_object('dossier', v_dos.code, 'automatique', true,
                                   'raison', v_raison, 'motif', SQLERRM));
      END;
    END LOOP;
  ELSIF p_decision = 'rejet_definitif' THEN
    UPDATE praticien SET statut = 'rejete' WHERE id = v_pra.id;
  END IF;

  IF NOT (p_decision = 'valide' AND v_arrivee = 6) THEN
    INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
    VALUES (v_pra.utilisateur_id, 'sms', 'dossier.' || p_decision, 'dossier', v_dos.code,
            jsonb_build_object('etape', v_arrivee));
  END IF;
  -- Traitements restés « expertisés » : le praticien en est informé, nombre et raison
  IF v_quota + v_contenu > 0 THEN
    INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
    VALUES (v_pra.utilisateur_id, 'sms', 'dossier.traitements_en_attente', 'dossier', v_dos.code,
            jsonb_build_object('etape', v_arrivee, 'quota', v_quota, 'contenu', v_contenu));
  END IF;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'dossier.' || p_decision, 'dossier', v_dos.code,
          jsonb_build_object('de', v_dos.etape_courante, 'vers', v_arrivee, 'motif', p_motif)
          -- La publication suit l'approbation sans décision humaine (R-CER-01)
          || CASE WHEN p_decision = 'publie' THEN jsonb_build_object('automatique', true)
                  ELSE '{}'::jsonb END);
  RETURN v_arrivee;
END $$;
