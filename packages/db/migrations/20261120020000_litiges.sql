-- US-101 : arbitrer les litiges, dont le recours de 30 jours après un rejet définitif (UC-43,
-- R-MOD-01, R-CER-04). Décisions du maître d'œuvre du 19 novembre 2026 (05 §2.88) :
-- - le praticien ouvre et suit son litige dans l'application mobile (pièces, échanges) ;
-- - litige ordinaire : l'admin régional de la région du praticien décide, décision motivée ;
-- - recours après un rejet définitif (dans les 30 jours) : le régional instruit et rend un
--   avis motivé, la DG décide ; recours accepté : statut du praticien rétabli, traitements
--   suspendus par le rejet remis en ligne, nouveau certificat signé par la DG si le praticien
--   était certifié (l'ancien reste révoqué), délai de 12 mois levé ;
-- - décision notifiée au praticien par SMS (le motif se lit dans son espace) ;
-- - un litige résolu est figé ; messages et pièces ne se modifient ni ne s'effacent.
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Modèle
-- ---------------------------------------------------------------------
CREATE SEQUENCE litige_numero;

ALTER TABLE litige
  ADD COLUMN type          text NOT NULL DEFAULT 'autre' CHECK (type IN ('recours','autre')),
  -- Recours : le rejet contesté (un seul recours par rejet)
  ADD COLUMN rejet_id      bigint UNIQUE REFERENCES rejet_definitif(id),
  -- Avis motivé du régional sur un recours
  ADD COLUMN avis_sens     text CHECK (avis_sens IN ('favorable','defavorable')),
  ADD COLUMN avis          text CHECK (btrim(avis) <> '' AND char_length(avis) <= 2000),
  ADD COLUMN avis_par      bigint REFERENCES utilisateur(id),
  ADD COLUMN avis_le       timestamptz,
  ADD COLUMN issue         text CHECK (issue IN ('accepte','refuse')),
  -- Recours accepté d'un praticien certifié : le nouveau certificat
  ADD COLUMN certificat_id bigint REFERENCES certificat(id),
  ADD CONSTRAINT ck_litige_objet CHECK (btrim(objet) <> '' AND char_length(objet) <= 200),
  ADD CONSTRAINT ck_litige_decision CHECK (btrim(decision) <> '' AND char_length(decision) <= 2000),
  ADD CONSTRAINT ck_litige_recours CHECK ((type = 'recours') = (rejet_id IS NOT NULL)),
  ADD CONSTRAINT ck_litige_avis CHECK (
    (avis IS NULL) = (avis_sens IS NULL) AND (avis IS NULL) = (avis_par IS NULL)
    AND (avis IS NULL) = (avis_le IS NULL) AND (avis IS NULL OR type = 'recours')),
  ADD CONSTRAINT ck_litige_issue CHECK ((statut = 'resolu') = (issue IS NOT NULL)),
  DROP CONSTRAINT litige_statut_check,
  ADD CONSTRAINT litige_statut_check CHECK (statut IN ('ouvert','en_arbitrage','avis_rendu','resolu'));

COMMENT ON COLUMN litige.type IS
  'recours : contestation d''un rejet définitif dans les 30 jours (R-CER-04), instruite par le régional, décidée par la DG ; autre : arbitrée par le régional (R-MOD-01).';
COMMENT ON COLUMN litige.statut IS
  'ouvert → en_arbitrage (premier message de l''administration) → avis_rendu (recours) → resolu (figé).';

ALTER TABLE litige_piece
  ADD COLUMN sha256 char(64) CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN mime   text CHECK (mime IN ('image/jpeg','image/png','application/pdf')),
  ADD COLUMN taille integer CHECK (taille BETWEEN 1 AND 5242880);
COMMENT ON COLUMN litige_piece.fichier_url IS
  'Clé du fichier dans le stockage, tirée au hasard (ni le litige ni le praticien n''y figurent).';

ALTER TABLE litige_message
  ADD CONSTRAINT ck_litige_message CHECK (btrim(contenu) <> '' AND char_length(contenu) <= 2000);

-- Échanges et pièces : ajout seulement (trace de l'instruction)
REVOKE UPDATE, DELETE, TRUNCATE ON litige_message, litige_piece FROM sabou_app;

-- Litige résolu : figé, pour tous les rôles, y compris le propriétaire des tables ; seul le
-- redécoupage territorial (US-024) peut le rattacher à une autre préfecture
CREATE FUNCTION trg_litige_fige() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'prefecture_id') = (to_jsonb(OLD) - 'prefecture_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Litige % résolu : aucune modification possible', OLD.code
    USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER trg_litige_fige BEFORE UPDATE OR DELETE ON litige
  FOR EACH ROW WHEN (OLD.statut = 'resolu') EXECUTE FUNCTION trg_litige_fige();

-- ---------------------------------------------------------------------
-- 2. Cloisonnement : le praticien voit ses litiges ; l'administration ceux de sa zone
--    (le Comité scientifique n'en connaît pas)
-- ---------------------------------------------------------------------
ALTER TABLE litige ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON litige TO sabou_app
  USING ((zone_visible(prefecture_id) AND contexte_role() <> 'scientifique')
         OR (contexte_role() = 'praticien'
             AND EXISTS (SELECT 1 FROM praticien p
                          WHERE p.id = litige.praticien_id AND p.utilisateur_id = contexte_utilisateur())))
  WITH CHECK ((zone_visible(prefecture_id) AND contexte_role() <> 'scientifique')
         OR (contexte_role() = 'praticien'
             AND EXISTS (SELECT 1 FROM praticien p
                          WHERE p.id = litige.praticien_id AND p.utilisateur_id = contexte_utilisateur())));
ALTER TABLE litige_message ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON litige_message TO sabou_app
  USING (EXISTS (SELECT 1 FROM litige l WHERE l.id = litige_message.litige_id))
  WITH CHECK (EXISTS (SELECT 1 FROM litige l WHERE l.id = litige_message.litige_id));
ALTER TABLE litige_piece ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON litige_piece TO sabou_app
  USING (EXISTS (SELECT 1 FROM litige l WHERE l.id = litige_piece.litige_id))
  WITH CHECK (EXISTS (SELECT 1 FROM litige l WHERE l.id = litige_piece.litige_id));

-- ---------------------------------------------------------------------
-- 3. Le recours accepté lève le délai de 12 mois avant un nouveau dossier
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_dossier_delai_rejet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM rejet_definitif r
              WHERE r.praticien_id = NEW.praticien_id AND r.decide_le > now() - interval '12 months'
                AND NOT EXISTS (SELECT 1 FROM litige l WHERE l.rejet_id = r.id AND l.issue = 'accepte'))
     OR EXISTS (SELECT 1 FROM dossier_certification d
                 WHERE d.praticien_id = NEW.praticien_id AND d.statut = 'rejete_definitif'
                   AND d.cloture_le > now() - interval '12 months'
                   AND NOT EXISTS (SELECT 1 FROM rejet_definitif r JOIN litige l ON l.rejet_id = r.id
                                    WHERE r.dossier_id = d.id AND l.issue = 'accepte')) THEN
    RAISE EXCEPTION 'Praticien % : nouveau dossier impossible moins de 12 mois après un rejet définitif', NEW.praticien_id;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 4. Fonctions (rôle de l'API ; acteur lu dans le contexte de zone)
-- ---------------------------------------------------------------------
-- Acteur actif du contexte
CREATE FUNCTION litige_acteur() RETURNS utilisateur LANGUAGE plpgsql STABLE AS $$
DECLARE v_usr utilisateur%ROWTYPE;
BEGIN
  SELECT * INTO v_usr FROM utilisateur WHERE id = contexte_utilisateur() AND statut = 'actif';
  IF NOT FOUND THEN RAISE EXCEPTION 'Litige : compte inconnu ou suspendu'; END IF;
  RETURN v_usr;
END $$;

-- Litige visible et verrouillé ; hors zone, introuvable (RLS)
CREATE FUNCTION litige_lire(p_code text) RETURNS litige LANGUAGE plpgsql AS $$
DECLARE v_lit litige%ROWTYPE;
BEGIN
  SELECT * INTO v_lit FROM litige WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Litige % introuvable', p_code; END IF;
  RETURN v_lit;
END $$;

-- Peut écrire dans l'instruction : le praticien (le sien), le régional de la région, la DG
-- pour un recours ; jamais après la résolution
CREATE FUNCTION litige_participant(p_lit litige, p_usr utilisateur) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_lit.statut = 'resolu' THEN
    RAISE EXCEPTION 'Litige % résolu : aucune modification possible', p_lit.code;
  END IF;
  IF NOT (p_usr.role_code IN ('praticien','regional') OR (p_usr.role_code = 'dg' AND p_lit.type = 'recours')) THEN
    RAISE EXCEPTION 'Litige % : action réservée au praticien et à l''administration qui l''instruit', p_lit.code;
  END IF;
END $$;

-- SMS au praticien (file de la table notification ; le texte est rédigé par l'API)
CREATE FUNCTION litige_prevenir(p_lit litige, p_modele text, p_parametres jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
  SELECT p.utilisateur_id, 'sms', p_modele, 'litige', p_lit.code, p_parametres
    FROM praticien p WHERE p.id = p_lit.praticien_id
$$;

-- Ouvrir un litige (praticien). Recours : praticien rejeté, dans les 30 jours du rejet, un
-- seul recours par rejet. Renvoie le code du litige.
CREATE FUNCTION litige_ouvrir(p_type text, p_objet text, p_message text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_usr   utilisateur%ROWTYPE := litige_acteur();
        v_pra   praticien%ROWTYPE;
        v_rejet rejet_definitif%ROWTYPE;
        v_code  text;
        v_id    bigint;
BEGIN
  IF v_usr.role_code <> 'praticien' THEN
    RAISE EXCEPTION 'Litige : ouverture réservée au praticien';
  END IF;
  SELECT * INTO v_pra FROM praticien WHERE utilisateur_id = v_usr.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Litige : fiche de praticien introuvable'; END IF;
  IF p_type = 'recours' THEN
    SELECT * INTO v_rejet FROM rejet_definitif
     WHERE praticien_id = v_pra.id ORDER BY decide_le DESC LIMIT 1;
    IF v_pra.statut <> 'rejete' OR NOT FOUND THEN
      RAISE EXCEPTION 'Litige : recours possible seulement après un rejet définitif';
    END IF;
    IF v_rejet.recours_jusquau < (now() AT TIME ZONE 'Africa/Conakry')::date THEN
      RAISE EXCEPTION 'Litige : délai de recours dépassé (%)', v_rejet.recours_jusquau;
    END IF;
    IF EXISTS (SELECT 1 FROM litige WHERE rejet_id = v_rejet.id) THEN
      RAISE EXCEPTION 'Litige : un recours est déjà ouvert contre ce rejet';
    END IF;
  ELSIF p_type IS DISTINCT FROM 'autre' THEN
    RAISE EXCEPTION 'Litige : type inconnu';
  END IF;

  v_code := 'LT-' || lpad(nextval('litige_numero')::text, 5, '0');
  INSERT INTO litige (code, objet, prefecture_id, ouvert_par, praticien_id, type, rejet_id)
  VALUES (v_code, btrim(p_objet), v_pra.prefecture_id, v_usr.id, v_pra.id, p_type,
          CASE WHEN p_type = 'recours' THEN v_rejet.id END)
  RETURNING id INTO v_id;
  INSERT INTO litige_message (litige_id, auteur_id, contenu) VALUES (v_id, v_usr.id, btrim(p_message));
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr.id, 'litige.ouvert', 'litige', v_code,
          jsonb_build_object('type', p_type, 'praticien', v_pra.code));
  RETURN v_code;
END $$;

-- Ajouter un message à l'instruction. Le premier message de l'administration passe le
-- litige « en arbitrage » ; un message de l'administration prévient le praticien par SMS.
CREATE FUNCTION litige_message_ajouter(p_code text, p_contenu text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_usr utilisateur%ROWTYPE := litige_acteur();
        v_lit litige%ROWTYPE := litige_lire(p_code);
        v_id  bigint;
BEGIN
  PERFORM litige_participant(v_lit, v_usr);
  INSERT INTO litige_message (litige_id, auteur_id, contenu)
  VALUES (v_lit.id, v_usr.id, btrim(p_contenu)) RETURNING id INTO v_id;
  IF v_usr.role_code <> 'praticien' THEN
    IF v_lit.statut = 'ouvert' THEN
      UPDATE litige SET statut = 'en_arbitrage' WHERE id = v_lit.id;
    END IF;
    PERFORM litige_prevenir(v_lit, 'litige.message');
  END IF;
  RETURN v_id;
END $$;

-- Joindre une pièce (fichier déjà dans le stockage) ; dix au plus par litige
CREATE FUNCTION litige_piece_ajouter(p_code text, p_cle text, p_sha256 text, p_mime text,
                                     p_taille integer) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_usr utilisateur%ROWTYPE := litige_acteur();
        v_lit litige%ROWTYPE := litige_lire(p_code);
        v_id  bigint;
BEGIN
  PERFORM litige_participant(v_lit, v_usr);
  IF (SELECT count(*) FROM litige_piece WHERE litige_id = v_lit.id) >= 10 THEN
    RAISE EXCEPTION 'Litige % : dix pièces au plus', v_lit.code;
  END IF;
  INSERT INTO litige_piece (litige_id, fichier_url, depose_par, sha256, mime, taille)
  VALUES (v_lit.id, p_cle, v_usr.id, p_sha256, p_mime, p_taille) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Avis motivé du régional sur un recours ; le recours passe à la DG
CREATE FUNCTION litige_avis_rendre(p_code text, p_sens text, p_avis text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_usr utilisateur%ROWTYPE := litige_acteur();
        v_lit litige%ROWTYPE := litige_lire(p_code);
BEGIN
  IF v_usr.role_code <> 'regional' THEN
    RAISE EXCEPTION 'Litige % : avis réservé à l''admin régional', v_lit.code;
  END IF;
  IF v_lit.type <> 'recours' OR v_lit.statut NOT IN ('ouvert','en_arbitrage') THEN
    RAISE EXCEPTION 'Litige % : avis possible seulement sur un recours en instruction', v_lit.code;
  END IF;
  UPDATE litige SET statut = 'avis_rendu', avis_sens = p_sens, avis = btrim(p_avis),
                    avis_par = v_usr.id, avis_le = now()
   WHERE id = v_lit.id;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr.id, 'litige.avis', 'litige', v_lit.code, jsonb_build_object('sens', p_sens));
END $$;

-- Recours accepté d'un praticien certifié : données du nouveau certificat (numéro, titulaire,
-- dates de 12 mois), à faire signer par l'API, comme certificat_preparer (US-045)
CREATE FUNCTION litige_certificat_preparer(p_code text)
RETURNS TABLE (numero text, titulaire text, emis_le date, expire_le date)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE v_usr      utilisateur%ROWTYPE := litige_acteur();
        v_lit      litige%ROWTYPE := litige_lire(p_code);
        v_code     text;
        v_nom      text;
        v_emis     date := (now() AT TIME ZONE 'Africa/Conakry')::date;
        v_numero   text;
        v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
BEGIN
  IF v_usr.role_code <> 'dg' OR v_lit.type <> 'recours' OR v_lit.statut <> 'avis_rendu' THEN
    RAISE EXCEPTION 'Litige % : décision du recours réservée à la DG, après l''avis du régional', v_lit.code;
  END IF;
  SELECT replace(p.code, '-', ''), u.prenom || ' ' || u.nom INTO v_code, v_nom
    FROM praticien p JOIN utilisateur u ON u.id = p.utilisateur_id
   WHERE p.id = v_lit.praticien_id;
  LOOP
    v_numero := 'SAB-' || extract(year FROM v_emis) || '-' || v_code || '-'
             || (SELECT string_agg(substr(v_alphabet, 1 + floor(random() * 32)::int, 1), '')
                   FROM generate_series(1, 3));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM certificat c WHERE c.numero = v_numero);
  END LOOP;
  RETURN QUERY SELECT v_numero, v_nom, v_emis, (v_emis + interval '12 months' - interval '1 day')::date;
END $$;

-- Décider. Litige ordinaire : le régional. Recours : la DG, après l'avis. Recours accepté :
-- praticien rétabli (certifié s'il l'était, sinon en attente), traitements suspendus par le
-- rejet remis en ligne, nouveau certificat enregistré s'il était certifié. SMS au praticien.
CREATE FUNCTION litige_decider(p_code text, p_issue text, p_motif text,
                               p_numero text DEFAULT NULL, p_emis_le date DEFAULT NULL,
                               p_expire_le date DEFAULT NULL, p_empreinte text DEFAULT NULL,
                               p_signature text DEFAULT NULL, p_kid text DEFAULT NULL,
                               p_cle_publique text DEFAULT NULL, p_qr text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_usr     utilisateur%ROWTYPE := litige_acteur();
        v_lit     litige%ROWTYPE := litige_lire(p_code);
        v_rejet   rejet_definitif%ROWTYPE;
        v_pra     praticien%ROWTYPE;
        v_ancien  certificat%ROWTYPE;
        v_cle     smallint;
        v_cert    bigint;
        v_rec     record;
        v_emis    date := (now() AT TIME ZONE 'Africa/Conakry')::date;
        v_remis   integer := 0;
BEGIN
  IF p_issue NOT IN ('accepte','refuse') THEN RAISE EXCEPTION 'Litige % : issue inconnue', v_lit.code; END IF;
  IF v_lit.type = 'autre' THEN
    IF v_usr.role_code <> 'regional' OR v_lit.statut NOT IN ('ouvert','en_arbitrage') THEN
      RAISE EXCEPTION 'Litige % : décision réservée à l''admin régional', v_lit.code;
    END IF;
  ELSIF v_usr.role_code <> 'dg' OR v_lit.statut <> 'avis_rendu' THEN
    RAISE EXCEPTION 'Litige % : décision du recours réservée à la DG, après l''avis du régional', v_lit.code;
  END IF;

  IF v_lit.type = 'recours' AND p_issue = 'accepte' THEN
    SELECT * INTO v_rejet FROM rejet_definitif WHERE id = v_lit.rejet_id;
    SELECT * INTO v_pra FROM praticien WHERE id = v_lit.praticien_id FOR UPDATE;
    IF v_pra.statut <> 'rejete' THEN
      RAISE EXCEPTION 'Litige % : le praticien n''est plus rejeté', v_lit.code;
    END IF;
    -- Certifié au moment du rejet : nouveau certificat signé (l'ancien reste révoqué)
    IF v_rejet.certificat_id IS NOT NULL THEN
      SELECT * INTO v_ancien FROM certificat WHERE id = v_rejet.certificat_id;
      IF p_emis_le IS DISTINCT FROM v_emis
         OR p_expire_le IS DISTINCT FROM (v_emis + interval '12 months' - interval '1 day')::date THEN
        RAISE EXCEPTION 'Litige % : dates du certificat périmées, à préparer de nouveau', v_lit.code;
      END IF;
      IF p_numero IS NULL OR p_numero !~ ('^SAB-[0-9]{4}-' || replace(v_pra.code, '-', '') || '-[A-Z2-9]{3}$') THEN
        RAISE EXCEPTION 'Litige % : numéro de certificat invalide', v_lit.code;
      END IF;
      IF p_qr IS NULL THEN RAISE EXCEPTION 'Litige % : QR du certificat manquant', v_lit.code; END IF;
      INSERT INTO cle_signature (kid, cle_publique) VALUES (p_kid, p_cle_publique) ON CONFLICT DO NOTHING;
      SELECT id INTO v_cle FROM cle_signature
       WHERE kid = p_kid AND cle_publique = p_cle_publique AND revoquee_le IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'Clé de signature % inconnue ou révoquée', p_kid; END IF;
    END IF;

    UPDATE praticien
       SET statut = CASE WHEN v_rejet.certificat_id IS NULL THEN 'en_attente' ELSE 'certifie' END
     WHERE id = v_pra.id;
    IF v_rejet.certificat_id IS NOT NULL THEN
      INSERT INTO certificat (numero, praticien_id, dossier_id, emis_par, emis_le, expire_le,
                              empreinte_sha3, signature, cle_id, qr)
      VALUES (p_numero, v_pra.id, v_ancien.dossier_id, v_usr.id, p_emis_le, p_expire_le,
              p_empreinte, p_signature, v_cle, p_qr)
      RETURNING id INTO v_cert;
      INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
      VALUES (v_usr.id, 'certificat.emis', 'certificat', p_numero,
              jsonb_build_object('litige', v_lit.code, 'cle', p_kid, 'empreinte', p_empreinte));
    END IF;
    -- Traitements suspendus par ce rejet (dernière étape de leur historique) : remis en ligne
    FOR v_rec IN SELECT r.id, r.code FROM recette r
                  WHERE r.praticien_id = v_pra.id AND r.statut = 'suspendue'
                    AND (SELECT h.motif FROM recette_historique h WHERE h.recette_id = r.id
                          ORDER BY h.id DESC LIMIT 1) = 'Rejet définitif du praticien'
                  ORDER BY r.id FOR UPDATE OF r LOOP
      UPDATE recette SET statut = 'certifiee' WHERE id = v_rec.id;
      INSERT INTO recette_historique (recette_id, statut_depart, statut_arrivee, motif, acteur_id)
      VALUES (v_rec.id, 'suspendue', 'certifiee', 'Recours accepté (' || v_lit.code || ')', v_usr.id);
      v_remis := v_remis + 1;
    END LOOP;
  END IF;

  UPDATE litige SET statut = 'resolu', issue = p_issue, decision = btrim(p_motif),
                    decide_par = v_usr.id, decide_le = now(), certificat_id = v_cert
   WHERE id = v_lit.id;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr.id, 'litige.decide', 'litige', v_lit.code,
          jsonb_build_object('type', v_lit.type, 'issue', p_issue, 'traitements_remis', v_remis)
          || CASE WHEN p_numero IS NULL OR v_cert IS NULL THEN '{}'::jsonb
                  ELSE jsonb_build_object('certificat', p_numero) END);
  PERFORM litige_prevenir(v_lit, 'litige.decide', jsonb_build_object('issue', p_issue));
  RETURN p_issue;
END $$;
