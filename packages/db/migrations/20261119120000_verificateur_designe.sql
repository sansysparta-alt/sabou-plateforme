-- Agent de vérification désigné par l'administrateur régional (US-040d, décision du
-- maître d'œuvre du 19 novembre 2026, 05 §2.71).
-- Quand la préfecture du praticien n'a qu'un agent, l'auteur d'un dossier terrain ne peut
-- pas le vérifier lui-même (séparation des tâches, US-040c) : l'administrateur régional
-- désigne un autre agent préfectoral actif de sa région.
--   - la désignation n'est écrite que par dossier_verificateur_designer, contrôlée par
--     trg_dossier_verificateur (rôle, région, auteur exclu, étape 1 ou 2) et journalisée ;
--   - l'agent désigné voit ce seul dossier (praticien, pièces, visites, historique) ;
--   - une fois un agent désigné, lui seul vérifie le dossier à l'étape 2.
SET search_path = sabou, public;

ALTER TABLE dossier_certification
  ADD COLUMN verificateur_designe    bigint REFERENCES utilisateur(id),
  ADD COLUMN verificateur_designe_le timestamptz;
CREATE INDEX ix_dossier_verificateur ON dossier_certification (verificateur_designe)
  WHERE verificateur_designe IS NOT NULL;
COMMENT ON COLUMN dossier_certification.verificateur_designe IS
  'Agent préfectoral désigné par l''administrateur régional pour vérifier ce dossier terrain à l''étape 2 (US-040d).';

-- Contrôle de toute désignation, quel que soit le chemin d'écriture
CREATE FUNCTION trg_dossier_verificateur() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_region smallint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.verificateur_designe IS NOT NULL OR NEW.verificateur_designe_le IS NOT NULL THEN
      RAISE EXCEPTION 'Un agent de vérification se désigne après la création du dossier';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.verificateur_designe IS NOT DISTINCT FROM OLD.verificateur_designe
     AND NEW.verificateur_designe_le IS NOT DISTINCT FROM OLD.verificateur_designe_le THEN
    RETURN NEW;
  END IF;
  SELECT pf.region_admin_id INTO v_region
    FROM praticien p JOIN prefecture pf ON pf.id = p.prefecture_id WHERE p.id = OLD.praticien_id;
  IF NOT EXISTS (SELECT 1 FROM utilisateur
                  WHERE id = contexte_utilisateur() AND role_code = 'regional'
                    AND statut = 'actif' AND region_admin_id = v_region) THEN
    RAISE EXCEPTION 'Désignation réservée à l''administrateur régional de la région du dossier'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.cree_par IS NULL THEN
    RAISE EXCEPTION 'Désignation réservée aux dossiers terrain (US-040d)';
  END IF;
  IF OLD.statut <> 'en_cours' OR OLD.etape_courante > 2 THEN
    RAISE EXCEPTION 'Dossier % : désignation possible aux étapes 1 et 2 seulement', OLD.code;
  END IF;
  IF NEW.verificateur_designe IS NULL OR NEW.verificateur_designe = OLD.cree_par
     OR NOT EXISTS (SELECT 1 FROM utilisateur u JOIN prefecture pf ON pf.id = u.prefecture_id
                     WHERE u.id = NEW.verificateur_designe AND u.role_code = 'prefectoral'
                       AND u.statut = 'actif' AND pf.region_admin_id = v_region) THEN
    RAISE EXCEPTION 'Agent non désignable : un agent préfectoral actif de la région, autre que l''auteur du dossier';
  END IF;
  NEW.verificateur_designe_le := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_dossier_verificateur
  BEFORE INSERT OR UPDATE OF verificateur_designe, verificateur_designe_le ON dossier_certification
  FOR EACH ROW EXECUTE FUNCTION trg_dossier_verificateur();

-- Désignation par l'administrateur régional, dans son contexte (cloisonnement appliqué :
-- un dossier hors de sa région est introuvable), journalisée
CREATE FUNCTION dossier_verificateur_designer(p_code text, p_agent bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_avant bigint;
BEGIN
  SELECT verificateur_designe INTO v_avant FROM dossier_certification WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dossier % introuvable', p_code; END IF;
  UPDATE dossier_certification SET verificateur_designe = p_agent WHERE code = p_code;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (contexte_utilisateur(), 'dossier.verificateur_designe', 'dossier', p_code,
          jsonb_strip_nulls(jsonb_build_object('agent', p_agent, 'precedent', v_avant)));
END $$;
REVOKE EXECUTE ON FUNCTION dossier_verificateur_designer(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dossier_verificateur_designer(text, bigint) TO sabou_app;

-- Lecture pour la règle de praticien : SECURITY DEFINER pour lire les dossiers sans passer
-- par leur propre règle, qui lit praticien (récursion évitée)
CREATE FUNCTION praticien_verificateur_designe(p_praticien bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = sabou, pg_catalog, pg_temp AS $$
  SELECT contexte_role() = 'prefectoral' AND EXISTS (
    SELECT 1 FROM dossier_certification d
     WHERE d.praticien_id = p_praticien AND d.verificateur_designe = contexte_utilisateur())
$$;
REVOKE EXECUTE ON FUNCTION praticien_verificateur_designe(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION praticien_verificateur_designe(bigint) TO sabou_app;

-- Praticien : l'agent désigné voit la fiche du praticien, en lecture seulement
DROP POLICY zone ON praticien;
CREATE POLICY zone ON praticien TO sabou_app
  USING (zone_visible(prefecture_id)
         OR (contexte_role() = 'praticien' AND utilisateur_id = contexte_utilisateur())
         OR praticien_verificateur_designe(id))
  WITH CHECK (zone_visible(prefecture_id)
         OR (contexte_role() = 'praticien' AND utilisateur_id = contexte_utilisateur()));

-- Dossier : l'agent désigné voit ce seul dossier, pas les autres dossiers du praticien.
-- Pièces, visites et historique suivent leur dossier (règles inchangées).
DROP POLICY zone ON dossier_certification;
CREATE POLICY zone ON dossier_certification TO sabou_app
  USING ((contexte_role() = 'prefectoral' AND verificateur_designe = contexte_utilisateur())
         OR EXISTS (SELECT 1 FROM praticien p WHERE p.id = dossier_certification.praticien_id
                     AND (zone_visible(p.prefecture_id)
                          OR (contexte_role() = 'praticien' AND p.utilisateur_id = contexte_utilisateur()))))
  WITH CHECK ((contexte_role() = 'prefectoral' AND verificateur_designe = contexte_utilisateur())
         OR EXISTS (SELECT 1 FROM praticien p WHERE p.id = dossier_certification.praticien_id
                     AND (zone_visible(p.prefecture_id)
                          OR (contexte_role() = 'praticien' AND p.utilisateur_id = contexte_utilisateur()))));

-- Transition : seule la règle de l'étape 2 change (le reste est celui de
-- 20261118120000_dossier_terrain.sql)
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
             -- Séparation des tâches (décision du maître d'œuvre du 19/11) : l'agent qui a
             -- créé le dossier terrain ne le vérifie pas lui-même. Si l'administrateur
             -- régional a désigné un agent (US-040d), lui seul vérifie le dossier.
             WHEN 2 THEN v_usr.role_code = 'prefectoral' AND v_dos.cree_par IS DISTINCT FROM v_usr.id
                         AND CASE WHEN v_dos.verificateur_designe IS NOT NULL
                                  THEN v_usr.id = v_dos.verificateur_designe
                                  ELSE v_usr.prefecture_id = v_pra.prefecture_id END
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
