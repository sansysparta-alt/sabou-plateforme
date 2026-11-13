-- US-046 : publication du praticien à l'étape 6 (UC-70, R-CER-01, R-REC-08, R-REC-11 ;
-- 05_Choix_Techniques.md §2.35).
-- L'étape 6 est automatique (R-CER-01) : elle s'exécute dans la transaction de l'approbation,
-- juste après l'émission du certificat. Le praticien passe « certifié » et les traitements
-- expertisés joints au dossier passent « certifiés ».
-- Un traitement qui ne peut pas être certifié (quota de la formule gratuite, plante non
-- validée, section manquante) reste « expertisé », la raison est tracée au journal d'audit :
-- il ne bloque ni l'approbation ni la certification du praticien.
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- Transition d'un dossier de certification : responsable et zone contrôlés,
-- aucune étape sautée, rejet = retour à l'étape précédente (R-CER-01 à 05).
-- Changements de US-046 (le reste est inchangé, cf. 20261112120000_notification_envoi.sql) :
--   - l'approbation (5 → 6) ne met plus de SMS en file : la publication suit dans la même
--     transaction et son SMS annonce la certification (un seul SMS au lieu de deux) ;
--   - la publication certifie les traitements expertisés un par un, dans l'ordre où ils ont
--     été joints ; un refus de trg_recette_publiable laisse le traitement « expertisé ».
CREATE OR REPLACE FUNCTION dossier_transition(p_dossier bigint, p_decision text, p_acteur bigint, p_motif text DEFAULT NULL)
RETURNS smallint LANGUAGE plpgsql AS $$
DECLARE v_dos     dossier_certification%ROWTYPE;
        v_usr     utilisateur%ROWTYPE;
        v_pra     praticien%ROWTYPE;
        v_region  smallint;
        v_arrivee smallint;
        v_rec     record;
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
                jsonb_build_object('dossier', v_dos.code));
      EXCEPTION WHEN raise_exception THEN
        -- Refus de trg_recette_publiable (R-REC-06, R-REC-11) : le traitement attend
        INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
        VALUES (p_acteur, 'recette.certification_differee', 'recette', v_rec.code,
                jsonb_build_object('dossier', v_dos.code, 'motif', SQLERRM));
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
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'dossier.' || p_decision, 'dossier', v_dos.code,
          jsonb_build_object('de', v_dos.etape_courante, 'vers', v_arrivee, 'motif', p_motif));
  RETURN v_arrivee;
END $$;

-- ---------------------------------------------------------------------
-- Émission du certificat (US-045), suivie de la publication (US-046). Seul changement :
-- la dernière instruction. La publication est enregistrée au nom de la DG qui approuve :
-- elle en est la conséquence directe, et l'historique exige un auteur (R-CER-05).
CREATE OR REPLACE FUNCTION certificat_emettre(p_dossier bigint, p_acteur bigint, p_numero text,
                                              p_emis_le date, p_expire_le date, p_empreinte text,
                                              p_signature text, p_kid text, p_cle_publique text, p_qr text)
RETURNS smallint LANGUAGE plpgsql AS $$
DECLARE v_dos   dossier_certification%ROWTYPE;
        v_cle   smallint;
        v_emis  date := (now() AT TIME ZONE 'Africa/Conakry')::date;
BEGIN
  v_dos := certificat_controler(p_dossier, p_acteur);
  IF p_emis_le IS DISTINCT FROM v_emis
     OR p_expire_le IS DISTINCT FROM (v_emis + interval '12 months' - interval '1 day')::date THEN
    RAISE EXCEPTION 'Dossier % : dates du certificat périmées, à préparer de nouveau', v_dos.code;
  END IF;
  IF p_numero IS NULL OR p_numero !~ ('^SAB-[0-9]{4}-' || replace((SELECT code FROM praticien
                                       WHERE id = v_dos.praticien_id), '-', '') || '-[A-Z2-9]{3}$') THEN
    RAISE EXCEPTION 'Dossier % : numéro de certificat invalide', v_dos.code;
  END IF;
  IF p_qr IS NULL THEN RAISE EXCEPTION 'Dossier % : QR du certificat manquant', v_dos.code; END IF;

  INSERT INTO cle_signature (kid, cle_publique) VALUES (p_kid, p_cle_publique)
    ON CONFLICT DO NOTHING;
  SELECT id INTO v_cle FROM cle_signature
   WHERE kid = p_kid AND cle_publique = p_cle_publique AND revoquee_le IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clé de signature % inconnue ou révoquée', p_kid;
  END IF;

  UPDATE certificat SET statut = 'expire'
   WHERE praticien_id = v_dos.praticien_id AND statut = 'actif';
  INSERT INTO certificat (numero, praticien_id, dossier_id, emis_par, emis_le, expire_le,
                          empreinte_sha3, signature, cle_id, qr)
  VALUES (p_numero, v_dos.praticien_id, v_dos.id, p_acteur, p_emis_le, p_expire_le,
          p_empreinte, p_signature, v_cle, p_qr);
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'certificat.emis', 'certificat', p_numero,
          jsonb_build_object('dossier', v_dos.code, 'cle', p_kid, 'empreinte', p_empreinte));

  PERFORM dossier_transition(v_dos.id, 'valide', p_acteur);
  RETURN dossier_transition(v_dos.id, 'publie', p_acteur);
END $$;

-- ---------------------------------------------------------------------
-- Rattrapage : un dossier approuvé avant cette migration (étape 6, certificat actif) est
-- publié au nom de la DG qui a émis son certificat. Aucun en production (pas encore livrée).
DO $$
DECLARE v_dos record;
BEGIN
  FOR v_dos IN SELECT d.id, c.emis_par FROM dossier_certification d
                 JOIN certificat c ON c.dossier_id = d.id AND c.statut = 'actif'
                WHERE d.statut = 'en_cours' AND d.etape_courante = 6 ORDER BY d.id
  LOOP
    PERFORM dossier_transition(v_dos.id, 'publie', v_dos.emis_par);
  END LOOP;
END $$;
