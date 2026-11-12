-- US-031 : envoi des SMS mis en file par les fonctions de workflow (table notification).
-- L'API relève la file, envoie par le fournisseur choisi (SMS_PROVIDER) et refait 3
-- tentatives en cas d'erreur ; au-delà, l'échec est visible (tableau de bord de la DG,
-- décision du maître d'œuvre du 12 novembre 2026) et tracé au journal d'audit.
SET search_path = sabou, public;

ALTER TABLE notification
  -- Données du message, figées à la transition (étape d'arrivée) : le texte décrit la
  -- décision prise, pas l'état du dossier au moment de l'envoi
  ADD COLUMN parametres          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Prochain essai : maintenant à la création, puis après chaque échec (1, 5, 15 min) ;
  -- repoussé pendant un envoi en cours, pour qu'un seul processus le prenne
  ADD COLUMN prochaine_tentative timestamptz NOT NULL DEFAULT now(),
  -- Dernière erreur du fournisseur, pour comprendre un échec (jamais le texte du message)
  ADD COLUMN derniere_erreur     text,
  ADD COLUMN echouee_le          timestamptz,
  ADD CONSTRAINT ck_notification_tentatives CHECK (tentatives BETWEEN 0 AND 4),
  ADD CONSTRAINT ck_notification_echec CHECK ((statut = 'echec') = (echouee_le IS NOT NULL));

-- File d'envoi : messages en attente dont l'heure d'essai est venue
DROP INDEX ix_notification_file;
CREATE INDEX ix_notification_file ON notification (prochaine_tentative, id) WHERE statut = 'en_attente';
-- Échecs affichés à la DG, du plus récent au plus ancien
CREATE INDEX ix_notification_echec ON notification (echouee_le DESC) WHERE statut = 'echec';

-- La notification porte l'étape d'arrivée ; le reste de la fonction est inchangé.
-- ---------------------------------------------------------------------
-- Transition d'un dossier de certification : responsable et zone contrôlés,
-- aucune étape sautée, rejet = retour à l'étape précédente (R-CER-01 à 05).
CREATE OR REPLACE FUNCTION dossier_transition(p_dossier bigint, p_decision text, p_acteur bigint, p_motif text DEFAULT NULL)
RETURNS smallint LANGUAGE plpgsql AS $$
DECLARE v_dos     dossier_certification%ROWTYPE;
        v_usr     utilisateur%ROWTYPE;
        v_pra     praticien%ROWTYPE;
        v_region  smallint;
        v_arrivee smallint;
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
    UPDATE praticien SET statut = 'certifie' WHERE id = v_pra.id;
    UPDATE recette SET statut = 'certifiee' WHERE dossier_id = v_dos.id AND statut = 'expertisee';
  ELSIF p_decision = 'rejet_definitif' THEN
    UPDATE praticien SET statut = 'rejete' WHERE id = v_pra.id;
  END IF;

  INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
  VALUES (v_pra.utilisateur_id, 'sms', 'dossier.' || p_decision, 'dossier', v_dos.code,
          jsonb_build_object('etape', v_arrivee));
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'dossier.' || p_decision, 'dossier', v_dos.code,
          jsonb_build_object('de', v_dos.etape_courante, 'vers', v_arrivee, 'motif', p_motif));
  RETURN v_arrivee;
END $$;

-- ---------------------------------------------------------------------
-- Relève de la file par l'API. Plusieurs instances de l'API peuvent relever en même temps :
-- SKIP LOCKED et le bail (prochaine_tentative repoussée) font qu'un message n'est pris que
-- par une seule. Un processus arrêté pendant l'envoi rend le message à la fin du bail : au
-- pire un SMS en double, jamais un SMS perdu.
CREATE FUNCTION notification_sms_prendre(p_limite integer, p_bail interval)
RETURNS TABLE (id bigint, telephone text, modele text, objet_id text, parametres jsonb, tentatives smallint)
LANGUAGE sql SET search_path = sabou, public, pg_temp AS $$
  WITH pris AS (
    SELECT n.id FROM notification n
     WHERE n.statut = 'en_attente' AND n.canal = 'sms' AND n.prochaine_tentative <= now()
     ORDER BY n.prochaine_tentative, n.id
     LIMIT p_limite
     FOR UPDATE SKIP LOCKED)
  UPDATE notification n SET prochaine_tentative = now() + p_bail
    FROM pris
   WHERE n.id = pris.id
  RETURNING n.id, (SELECT u.telephone FROM utilisateur u WHERE u.id = n.destinataire_id),
            n.modele, n.objet_id, n.parametres, n.tentatives;
$$;

-- Résultat d'un essai. p_erreur NULL : envoyé. Sinon, nouvel essai après 1, 5 puis 15 min ;
-- après le 4e essai (3 nouvelles tentatives, US-031) ou une erreur définitive (pas de
-- numéro, modèle inconnu), le message passe en échec et l'échec est tracé au journal d'audit.
CREATE FUNCTION notification_sms_resultat(p_id bigint, p_erreur text, p_definitive boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SET search_path = sabou, public, pg_temp AS $$
DECLARE v_n     notification%ROWTYPE;
        v_essai smallint;
BEGIN
  SELECT * INTO v_n FROM notification WHERE id = p_id AND statut = 'en_attente' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification % introuvable ou déjà traitée', p_id; END IF;
  v_essai := v_n.tentatives + 1;

  IF p_erreur IS NULL THEN
    UPDATE notification SET statut = 'envoyee', tentatives = v_essai, envoyee_le = now(),
                            derniere_erreur = NULL
     WHERE id = p_id;
    RETURN 'envoyee';
  END IF;

  IF p_definitive OR v_essai >= 4 THEN
    UPDATE notification SET statut = 'echec', tentatives = v_essai, echouee_le = now(),
                            derniere_erreur = left(p_erreur, 500)
     WHERE id = p_id;
    INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
    VALUES (NULL, 'notification.echec', v_n.objet_type, v_n.objet_id,
            jsonb_build_object('notification', p_id, 'canal', v_n.canal, 'modele', v_n.modele,
                               'tentatives', v_essai, 'erreur', left(p_erreur, 500)));
    RETURN 'echec';
  END IF;

  UPDATE notification
     SET tentatives = v_essai, derniere_erreur = left(p_erreur, 500),
         prochaine_tentative = now() + (ARRAY[interval '1 minute', interval '5 minutes',
                                              interval '15 minutes'])[v_essai]
   WHERE id = p_id;
  RETURN 'en_attente';
END $$;
