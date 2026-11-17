-- US-047 : prononcer un rejet définitif (UC-61, R-CER-04, R-QR-06, R-CER-05).
-- Décisions du maître d'œuvre (12 et 14 novembre 2026, 05_Choix_Techniques.md §2.36) :
--   - réservé à la Direction Générale ; motif limité à trois cas, avec une précision écrite ;
--     « pratique dangereuse » exige la date et la référence de l'avis du Comité scientifique ;
--   - prononcé à tout moment : sur un dossier en cours (étapes 1 à 5), qui est clos, ou sur
--     un praticien déjà certifié sans dossier en cours ;
--   - le certificat actif est révoqué ; les traitements certifiés passent « suspendus »
--     (réversible si le recours aboutit) ; les traitements en cours d'examen gardent leur
--     statut mais ne progressent plus : ils sortent des files du régional et du Comité ;
--   - un seul SMS, qui donne la date limite du recours (date du rejet + 30 jours) et oriente
--     vers l'administration de la préfecture, jusqu'aux litiges (US-101) ;
--   - nouveau dossier possible 12 mois après le rejet.
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. La décision, conservée telle quelle (aucune modification ni suppression par l'API)
-- ---------------------------------------------------------------------
CREATE TABLE rejet_definitif (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  praticien_id           bigint NOT NULL REFERENCES praticien(id),
  -- Dossier en cours clos par le rejet, certificat révoqué : NULL s'il n'y en avait pas
  dossier_id             bigint REFERENCES dossier_certification(id),
  certificat_id          bigint REFERENCES certificat(id),
  motif                  text NOT NULL
                         CHECK (motif IN ('fraude_documentaire','usurpation_identite','pratique_dangereuse')),
  motif_detail           text NOT NULL CHECK (btrim(motif_detail) <> '' AND char_length(motif_detail) <= 1000),
  avis_comite_le         date,
  avis_comite_reference  text CHECK (btrim(avis_comite_reference) <> '' AND char_length(avis_comite_reference) <= 100),
  decide_par             bigint NOT NULL REFERENCES utilisateur(id),
  decide_le              timestamptz NOT NULL DEFAULT now(),
  -- Dernier jour du recours, heure de Conakry (UTC, sans heure d'été)
  recours_jusquau        date NOT NULL,
  -- L'avis du Comité est exigé pour une pratique dangereuse, et réservé à ce motif
  CONSTRAINT ck_rejet_avis_comite CHECK (
    (motif = 'pratique_dangereuse') = (avis_comite_le IS NOT NULL AND avis_comite_reference IS NOT NULL)),
  CONSTRAINT ck_rejet_avis_anterieur CHECK (
    avis_comite_le IS NULL OR avis_comite_le <= (decide_le AT TIME ZONE 'Africa/Conakry')::date),
  CONSTRAINT ck_rejet_recours CHECK (
    recours_jusquau = (decide_le AT TIME ZONE 'Africa/Conakry')::date + 30)
);
CREATE INDEX ix_rejet_praticien ON rejet_definitif (praticien_id, decide_le DESC);
COMMENT ON TABLE rejet_definitif IS
  'Rejets définitifs prononcés par la DG (R-CER-04) : motif encadré, avis du Comité pour une pratique dangereuse, date limite du recours de 30 jours.';

-- Visible si son praticien l'est (même règle que le dossier) ; une décision ne se réécrit pas
ALTER TABLE rejet_definitif ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON rejet_definitif TO sabou_app
  USING (EXISTS (SELECT 1 FROM praticien p WHERE p.id = rejet_definitif.praticien_id))
  WITH CHECK (EXISTS (SELECT 1 FROM praticien p WHERE p.id = rejet_definitif.praticien_id));
REVOKE UPDATE, DELETE, TRUNCATE ON rejet_definitif FROM sabou_app;

-- ---------------------------------------------------------------------
-- 2. Le rejet définitif d'un dossier ne passe plus par dossier_transition : il exige la
--    décision complète (motif encadré, recours). L'historique du dossier n'accepte la
--    décision « rejet_definitif » que si elle est enregistrée dans rejet_definitif.
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_historique_rejet_definitif() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.decision = 'rejet_definitif' AND NOT EXISTS (
       SELECT 1 FROM rejet_definitif r WHERE r.dossier_id = NEW.dossier_id) THEN
    RAISE EXCEPTION 'Dossier % : le rejet définitif se prononce par praticien_rejeter (motif encadré, recours de 30 jours)',
      NEW.dossier_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_historique_rejet_definitif BEFORE INSERT ON dossier_historique
  FOR EACH ROW EXECUTE FUNCTION trg_historique_rejet_definitif();

-- ---------------------------------------------------------------------
-- 3. Traitements d'un praticien rejeté : plus aucune progression dans le circuit (ils
--    sortent des files du régional et du Comité). Restent possibles : le retour en
--    brouillon, la suspension et le retrait. SECURITY DEFINER : le statut du praticien est
--    lu quelle que soit la zone de l'acteur (le RLS le masquerait hors zone).
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_recette_praticien_rejete() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.statut IN ('soumise','transmise','expertisee','certifiee')
     AND NEW.statut IS DISTINCT FROM OLD.statut
     AND EXISTS (SELECT 1 FROM praticien p WHERE p.id = NEW.praticien_id AND p.statut = 'rejete') THEN
    RAISE EXCEPTION 'Traitement % : praticien rejeté définitivement, le traitement ne progresse plus', NEW.code;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_recette_praticien_rejete BEFORE UPDATE OF statut ON recette
  FOR EACH ROW EXECUTE FUNCTION trg_recette_praticien_rejete();
-- Fonction de trigger seulement : personne ne l'appelle directement
REVOKE EXECUTE ON FUNCTION trg_recette_praticien_rejete() FROM PUBLIC;

-- ---------------------------------------------------------------------
-- 4. Nouveau dossier : 12 mois après le rejet, qu'il ait clos un dossier ou non. Les
--    dossiers rejetés avant US-047 (bases de développement) restent comptés.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_dossier_delai_rejet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM rejet_definitif r
              WHERE r.praticien_id = NEW.praticien_id AND r.decide_le > now() - interval '12 months')
     OR EXISTS (SELECT 1 FROM dossier_certification d
                 WHERE d.praticien_id = NEW.praticien_id AND d.statut = 'rejete_definitif'
                   AND d.cloture_le > now() - interval '12 months') THEN
    RAISE EXCEPTION 'Praticien % : nouveau dossier impossible moins de 12 mois après un rejet définitif', NEW.praticien_id;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 5. Prononcer le rejet, en une transaction : décision, dossier clos, certificat révoqué,
--    traitements certifiés suspendus, praticien « rejeté », un SMS, journal d'audit.
-- ---------------------------------------------------------------------
CREATE FUNCTION praticien_rejeter(p_praticien bigint, p_acteur bigint, p_motif text, p_detail text,
                                  p_avis_le date DEFAULT NULL, p_avis_reference text DEFAULT NULL)
RETURNS rejet_definitif LANGUAGE plpgsql AS $$
DECLARE v_usr        utilisateur%ROWTYPE;
        v_pra        praticien%ROWTYPE;
        v_dos        dossier_certification%ROWTYPE;
        v_cer        certificat%ROWTYPE;
        v_rej        rejet_definitif%ROWTYPE;
        v_rec        record;
        v_libelle    text;
        v_suspendus  integer := 0;
BEGIN
  SELECT * INTO v_usr FROM utilisateur WHERE id = p_acteur AND statut = 'actif';
  IF NOT FOUND THEN RAISE EXCEPTION 'Acteur % inconnu ou suspendu', p_acteur; END IF;
  IF v_usr.role_code <> 'dg' THEN
    RAISE EXCEPTION 'Le rejet définitif est réservé à la Direction Générale';
  END IF;
  SELECT * INTO v_pra FROM praticien WHERE id = p_praticien FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Praticien % introuvable', p_praticien; END IF;
  IF v_pra.statut = 'rejete' THEN
    RAISE EXCEPTION 'Praticien % déjà rejeté définitivement', v_pra.code;
  END IF;
  -- Motif inconnu : NULL ici, refusé par la contrainte de la table
  v_libelle := CASE p_motif WHEN 'fraude_documentaire' THEN 'Fraude documentaire'
                            WHEN 'usurpation_identite' THEN 'Usurpation d''identité'
                            WHEN 'pratique_dangereuse' THEN 'Pratique dangereuse avérée' END;

  SELECT * INTO v_dos FROM dossier_certification
   WHERE praticien_id = v_pra.id AND statut = 'en_cours' FOR UPDATE;
  SELECT * INTO v_cer FROM certificat
   WHERE praticien_id = v_pra.id AND statut = 'actif' FOR UPDATE;

  INSERT INTO rejet_definitif (praticien_id, dossier_id, certificat_id, motif, motif_detail,
                               avis_comite_le, avis_comite_reference, decide_par, recours_jusquau)
  VALUES (v_pra.id, v_dos.id, v_cer.id, p_motif, btrim(p_detail), p_avis_le, btrim(p_avis_reference),
          p_acteur, (now() AT TIME ZONE 'Africa/Conakry')::date + 30)
  RETURNING * INTO v_rej;

  -- Dossier en cours : clos à son étape, la décision entre dans son historique (R-CER-05)
  IF v_dos.id IS NOT NULL THEN
    INSERT INTO dossier_historique (dossier_id, etape_depart, etape_arrivee, decision, motif, acteur_id)
    VALUES (v_dos.id, v_dos.etape_courante, v_dos.etape_courante, 'rejet_definitif',
            v_libelle || ' : ' || btrim(p_detail), p_acteur);
    UPDATE dossier_certification
       SET statut = 'rejete_definitif', cloture_le = now(), etape_entree_le = now()
     WHERE id = v_dos.id;
  END IF;

  -- Certificat révoqué avec le motif du rejet (R-QR-06) ; le QR répond « rouge » (R-QR-05)
  IF v_cer.id IS NOT NULL THEN
    UPDATE certificat SET statut = 'revoque', revoque_le = now(),
                          motif_revocation = 'Rejet définitif : ' || v_libelle
     WHERE id = v_cer.id;
    INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
    VALUES (p_acteur, 'certificat.revoque', 'certificat', v_cer.numero,
            jsonb_build_object('praticien', v_pra.code, 'rejet', v_rej.id, 'automatique', true));
  END IF;

  -- Traitements certifiés : suspendus, réversible si le recours aboutit
  FOR v_rec IN SELECT id, code FROM recette
                WHERE praticien_id = v_pra.id AND statut = 'certifiee' ORDER BY id FOR UPDATE
  LOOP
    UPDATE recette SET statut = 'suspendue' WHERE id = v_rec.id;
    INSERT INTO recette_historique (recette_id, statut_depart, statut_arrivee, motif, acteur_id)
    VALUES (v_rec.id, 'certifiee', 'suspendue', 'Rejet définitif du praticien', p_acteur);
    INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
    VALUES (p_acteur, 'recette.suspendue', 'recette', v_rec.code,
            jsonb_build_object('praticien', v_pra.code, 'rejet', v_rej.id, 'automatique', true));
    v_suspendus := v_suspendus + 1;
  END LOOP;

  -- Le certificat est déjà révoqué : trg_praticien_revocation n'a plus rien à faire
  UPDATE praticien SET statut = 'rejete' WHERE id = v_pra.id;

  -- Un seul SMS : la décision et la date limite du recours (le motif se lit dans l'espace
  -- du praticien, décision du 12 novembre 2026)
  INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
  VALUES (v_pra.utilisateur_id, 'sms', 'praticien.rejet_definitif',
          CASE WHEN v_dos.id IS NULL THEN 'praticien' ELSE 'dossier' END,
          COALESCE(v_dos.code, v_pra.code),
          jsonb_strip_nulls(jsonb_build_object('dossier', v_dos.code,
                                               'recoursJusquau', v_rej.recours_jusquau::text)));
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'praticien.rejet_definitif', 'praticien', v_pra.code,
          jsonb_strip_nulls(jsonb_build_object(
            'rejet', v_rej.id, 'motif', p_motif, 'dossier', v_dos.code, 'etape', v_dos.etape_courante,
            'certificat', v_cer.numero, 'traitementsSuspendus', v_suspendus,
            'avisComite', v_rej.avis_comite_reference, 'recoursJusquau', v_rej.recours_jusquau::text)));
  RETURN v_rej;
END $$;
COMMENT ON FUNCTION praticien_rejeter(bigint, bigint, text, text, date, text) IS
  'Rejet définitif par la DG (US-047, R-CER-04) : décision, dossier clos, certificat révoqué, traitements certifiés suspendus, SMS avec la date limite du recours.';
