-- US-046, demandes du maître d'œuvre du 13 novembre 2026 (05_Choix_Techniques.md §2.35) :
--   - le journal d'audit marque la publication et la certification des traitements comme
--     automatiques (« automatique » : true) ;
--   - les traitements restés « expertisés » à la publication sont annoncés au praticien par
--     SMS (nombre et raison : quota de la formule gratuite, ou contenu à compléter) ;
--   - règle de choix en formule gratuite (R-REC-11 prime sur R-REC-08) : le quota de 3 compte
--     les traitements déjà certifiés du praticien ; les places restantes vont aux traitements
--     joints au dossier dans l'ordre de leur création (le plus ancien d'abord).
--   - la raison de l'attente est aussi enregistrée sur le traitement (recette.attente_raison),
--     lue directement par le Studio (US-060) ; le journal d'audit garde la trace.
-- dossier_transition change ; le reste est celui de 20261113160000_publication_praticien.sql.
SET search_path = sabou, public;

-- Raison pour laquelle un traitement expertisé attend sa certification : NULL hors attente
ALTER TABLE recette ADD COLUMN attente_raison text
  CHECK (attente_raison IN ('quota','contenu')),
  ADD CONSTRAINT ck_recette_attente_expertisee
  CHECK (attente_raison IS NULL OR statut = 'expertisee');
COMMENT ON COLUMN recette.attente_raison IS
  'Traitement resté « expertisé » à la publication du dossier : quota de la formule gratuite (R-REC-11) ou contenu à compléter (R-REC-06). Effacée dès que le statut change.';

-- Tout changement de statut (certification au passage en GOLD, contenu complété, retrait)
-- efface la raison : aucun chemin de certification n'a à y penser
CREATE OR REPLACE FUNCTION trg_recette_attente() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.statut IS DISTINCT FROM OLD.statut THEN NEW.attente_raison := NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_recette_attente BEFORE UPDATE OF statut ON recette
  FOR EACH ROW EXECUTE FUNCTION trg_recette_attente();

-- Rattrapage : dossiers publiés par la migration précédente (bases de développement)
UPDATE recette r SET attente_raison = j.raison
  FROM (SELECT DISTINCT ON (objet_id) objet_id, details->>'raison' AS raison
          FROM journal_audit WHERE action = 'recette.certification_differee'
         ORDER BY objet_id, id DESC) j
 WHERE r.code = j.objet_id AND r.statut = 'expertisee';

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
             WHEN 1 THEN v_usr.id = v_pra.utilisateur_id
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
