-- US-100 : traiter les signalements de danger et d'effets indésirables (UC-08, UC-54,
-- R-SAN-01 à 03). Décisions du maître d'œuvre du 19 novembre 2026 (05 §2.83) :
--   - dépôt public, sans compte, depuis la page /signaler du site : traitement (REC-…) ou
--     plante (PL-…) ; contact facultatif, visible du seul Comité, effacé 12 mois après la
--     clôture (signalements_effacer_contacts, appelée à chaque relève de la file des SMS) ;
--   - file du Comité scientifique : graves en tête, délai cible 24 h (RLS : Comité seul) ;
--   - décision motivée : aucune action, révision (le traitement revient au praticien en
--     brouillon, avec SMS, et refait le circuit ; une plante revient à la revue du Comité),
--     suspension (le traitement quitte le site aussitôt ; le Comité la lève avec un motif),
--     retrait (définitif) ;
--   - prouvé sur un vrai PostgreSQL : packages/db/test/signalements.test.ts.
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Cloisonnement : le Comité seul lit les signalements ; écritures par fonctions
-- ---------------------------------------------------------------------
ALTER TABLE signalement_sanitaire ENABLE ROW LEVEL SECURITY;
CREATE POLICY comite ON signalement_sanitaire FOR SELECT TO sabou_app
  USING (contexte_role() = 'scientifique');
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON signalement_sanitaire FROM sabou_app;
COMMENT ON COLUMN signalement_sanitaire.contact IS
  'Contact facultatif laissé par l''auteur : visible du seul Comité, effacé 12 mois après la clôture (US-100).';

-- Référence lisible du signalement (SIG-00001), remise à l'auteur et affichée au Comité
CREATE FUNCTION signalement_reference(p_id bigint) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'SIG-' || lpad(p_id::text, 5, '0') $$;

-- ---------------------------------------------------------------------
-- 2. Transitions du Comité sur un traitement publié
-- ---------------------------------------------------------------------
-- Ajouts au tableau de US-061 : révision (certifié ou suspendu → brouillon, renvoi avec SMS
-- « recette.renvoyee ») et retrait par le Comité ; motif exigé quand le Comité lève une
-- suspension (la recertification par la DG après un recours, US-047, reste inchangée).
-- Le statut de départ figure dans les paramètres du SMS : une levée de suspension ne se lit
-- pas comme une première certification.
CREATE OR REPLACE FUNCTION recette_transition(p_recette bigint, p_vers text, p_acteur bigint, p_motif text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_rec           recette%ROWTYPE;
        v_usr           utilisateur%ROWTYPE;
        v_prat_user     bigint;
        v_pref          smallint;
        v_region        smallint;
        v_motif_requis  boolean;
        v_renvoi        boolean;
BEGIN
  SELECT * INTO v_rec FROM recette WHERE id = p_recette FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_recette; END IF;
  SELECT * INTO v_usr FROM utilisateur WHERE id = p_acteur AND statut = 'actif';
  IF NOT FOUND THEN RAISE EXCEPTION 'Acteur % inconnu ou suspendu', p_acteur; END IF;
  SELECT pr.utilisateur_id, pr.prefecture_id, pf.region_admin_id INTO v_prat_user, v_pref, v_region
    FROM praticien pr JOIN prefecture pf ON pf.id = pr.prefecture_id WHERE pr.id = v_rec.praticien_id;

  SELECT bool_or(rg.motif_requis), bool_or(rg.renvoi) INTO v_motif_requis, v_renvoi
    FROM (VALUES
      ('brouillon', 'soumise',    'praticien',    false, false), ('brouillon', 'soumise',   'prefectoral',  false, false),
      ('soumise',   'transmise',  'regional',     false, false), ('soumise',   'brouillon', 'regional',     true,  true),
      ('transmise', 'expertisee', 'scientifique', false, false), ('transmise', 'soumise',   'scientifique', true,  true),
      ('expertisee','certifiee',  'dg',           false, false), ('expertisee','transmise', 'dg',           true,  true),
      ('certifiee', 'suspendue',  'scientifique', true,  false), ('certifiee', 'suspendue', 'dg',           true,  false),
      ('suspendue', 'certifiee',  'scientifique', true,  false), ('suspendue', 'certifiee', 'dg',           false, false),
      ('certifiee', 'brouillon',  'scientifique', true,  true),  ('suspendue', 'brouillon', 'scientifique', true,  true),
      ('certifiee', 'retiree',    'scientifique', true,  false), ('suspendue', 'retiree',   'scientifique', true,  false),
      ('certifiee', 'retiree',    'praticien',    false, false), ('suspendue', 'retiree',   'praticien',    false, false),
      ('certifiee', 'retiree',    'dg',           true,  false), ('suspendue', 'retiree',   'dg',           true,  false)
    ) AS rg(de, vers, qui, motif_requis, renvoi)
   WHERE rg.de = v_rec.statut AND rg.vers = p_vers AND rg.qui = v_usr.role_code
     AND (rg.qui <> 'praticien'   OR v_usr.id = v_prat_user)
     AND (rg.qui <> 'prefectoral' OR v_usr.prefecture_id = v_pref)
     AND (rg.qui <> 'regional'    OR v_usr.region_admin_id = v_region);

  IF v_motif_requis IS NULL THEN
    RAISE EXCEPTION 'Transition % → % interdite pour l''acteur % sur le traitement %', v_rec.statut, p_vers, p_acteur, v_rec.code;
  END IF;
  IF v_motif_requis AND COALESCE(btrim(p_motif), '') = '' THEN
    RAISE EXCEPTION 'Transition % → % : motif obligatoire', v_rec.statut, p_vers;
  END IF;

  UPDATE recette SET statut = p_vers WHERE id = v_rec.id;   -- trg_recette_publiable contrôle la certification
  INSERT INTO recette_historique (recette_id, statut_depart, statut_arrivee, motif, acteur_id)
  VALUES (v_rec.id, v_rec.statut, p_vers, nullif(btrim(p_motif), ''), p_acteur);
  INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
  VALUES (v_prat_user, 'sms', CASE WHEN v_renvoi THEN 'recette.renvoyee' ELSE 'recette.' || p_vers END,
          'recette', v_rec.code, jsonb_build_object('statut', p_vers, 'de', v_rec.statut));
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'recette.' || p_vers, 'recette', v_rec.code,
          jsonb_build_object('de', v_rec.statut, 'motif', nullif(btrim(p_motif), '')));
  RETURN p_vers;
END $$;

-- ---------------------------------------------------------------------
-- 3. Dépôt public (sans compte)
-- ---------------------------------------------------------------------
-- Code d'un traitement publié (certifié ou suspendu) ou d'une plante validée : ce que le
-- public a pu voir. La limite par adresse IP et le leurre sont tenus par l'API (05 §2.83).
CREATE FUNCTION signalement_deposer(p_type text, p_code text, p_gravite text,
                                    p_description text, p_contact text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql
SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_code    text := upper(btrim(COALESCE(p_code, '')));
        v_objet   text;
        v_id      bigint;
        v_pref    smallint;
        v_sig     bigint;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('danger', 'effet_indesirable') THEN
    RAISE EXCEPTION 'Signalement : type invalide';
  END IF;
  IF p_gravite IS NULL OR p_gravite NOT IN ('faible', 'moyenne', 'grave') THEN
    RAISE EXCEPTION 'Signalement : gravité invalide';
  END IF;
  IF length(btrim(COALESCE(p_description, ''))) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'Signalement : description de 10 à 2000 caractères';
  END IF;
  IF length(btrim(COALESCE(p_contact, ''))) > 120 THEN
    RAISE EXCEPTION 'Signalement : contact de 120 caractères au plus';
  END IF;

  IF v_code ~ '^REC-\d+$' THEN
    SELECT 'recette', r.id, p.prefecture_id INTO v_objet, v_id, v_pref
      FROM recette r JOIN praticien p ON p.id = r.praticien_id
     WHERE r.code = v_code AND r.statut IN ('certifiee', 'suspendue');
  ELSIF v_code ~ '^PL-\d+$' THEN
    SELECT 'plante', pl.id INTO v_objet, v_id
      FROM plante pl WHERE pl.code = v_code AND pl.statut = 'validee';
  END IF;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Signalement : code % inconnu', v_code;
  END IF;

  INSERT INTO signalement_sanitaire (type, objet_type, objet_id, contact, description, gravite, prefecture_id)
  VALUES (p_type, v_objet, v_id, nullif(btrim(p_contact), ''), btrim(p_description), p_gravite, v_pref)
  RETURNING id INTO v_sig;
  -- Journal sans le contact ni la description : seule la trace du dépôt
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (NULL, 'signalement.depose', 'signalement', signalement_reference(v_sig),
          jsonb_build_object('objet', v_code, 'type', p_type, 'gravite', p_gravite));
  RETURN signalement_reference(v_sig);
END $$;

-- ---------------------------------------------------------------------
-- 4. Décision motivée du Comité
-- ---------------------------------------------------------------------
CREATE FUNCTION signalement_decider(p_reference text, p_decision text, p_motif text)
RETURNS text LANGUAGE plpgsql
SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_usr     bigint := contexte_utilisateur();
        v_sig     signalement_sanitaire%ROWTYPE;
        v_statut  text;
        v_code    text;
BEGIN
  IF contexte_role() IS DISTINCT FROM 'scientifique' THEN
    RAISE EXCEPTION 'Signalement : décision réservée au Comité scientifique';
  END IF;
  SELECT * INTO v_sig FROM signalement_sanitaire
   WHERE signalement_reference(id) = upper(btrim(COALESCE(p_reference, ''))) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Signalement % introuvable', p_reference; END IF;
  IF v_sig.statut = 'clos' THEN
    RAISE EXCEPTION 'Signalement % : déjà clos', p_reference;
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('aucune_action', 'revision', 'suspension', 'retrait') THEN
    RAISE EXCEPTION 'Signalement : décision invalide';
  END IF;
  IF COALESCE(btrim(p_motif), '') = '' THEN
    RAISE EXCEPTION 'Signalement : motif obligatoire';
  END IF;

  IF v_sig.objet_type = 'recette' AND p_decision <> 'aucune_action' THEN
    SELECT statut, code INTO v_statut, v_code FROM recette WHERE id = v_sig.objet_id;
    -- Déjà suspendu : une nouvelle suspension ne change rien (le motif est gardé au signalement)
    IF NOT (p_decision = 'suspension' AND v_statut = 'suspendue') THEN
      PERFORM recette_transition(v_sig.objet_id,
        CASE p_decision WHEN 'revision' THEN 'brouillon' WHEN 'suspension' THEN 'suspendue'
                        ELSE 'retiree' END,
        v_usr, p_motif);
    END IF;
  ELSIF v_sig.objet_type = 'plante' AND p_decision IN ('suspension', 'retrait') THEN
    RAISE EXCEPTION 'Signalement : décision % sans objet pour une plante', p_decision;
  ELSIF v_sig.objet_type = 'plante' AND p_decision = 'revision' THEN
    -- La plante revient à la revue du Comité : elle quitte les fiches publiques. La validation
    -- précédente est effacée de la fiche (ck_plante_validee) et reste au journal d'audit.
    UPDATE plante SET statut = 'en_revue', valide_par = NULL, valide_le = NULL
     WHERE id = v_sig.objet_id AND statut = 'validee';
  ELSIF v_sig.objet_type = 'produit' AND p_decision <> 'aucune_action' THEN
    RAISE EXCEPTION 'Signalement : décision % sans objet pour un produit', p_decision;
  END IF;

  UPDATE signalement_sanitaire
     SET statut = 'clos', decision = p_decision, motif_decision = btrim(p_motif),
         traite_par = v_usr, traite_le = now()
   WHERE id = v_sig.id;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr, 'signalement.' || p_decision, 'signalement', signalement_reference(v_sig.id),
          jsonb_build_object('motif', btrim(p_motif)));
  RETURN p_decision;
END $$;

-- Levée d'une suspension par le Comité, avec un motif ; le traitement revient en ligne si
-- les conditions de certification sont toujours remplies (trg_recette_publiable)
CREATE FUNCTION traitement_suspension_lever(p_code text, p_motif text)
RETURNS text LANGUAGE plpgsql
SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_id bigint;
BEGIN
  IF contexte_role() IS DISTINCT FROM 'scientifique' THEN
    RAISE EXCEPTION 'Levée de suspension réservée au Comité scientifique';
  END IF;
  SELECT id INTO v_id FROM recette WHERE code = p_code AND statut = 'suspendue';
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_code; END IF;
  RETURN recette_transition(v_id, 'certifiee', contexte_utilisateur(), p_motif);
END $$;

-- ---------------------------------------------------------------------
-- 5. Effacement des contacts, 12 mois après la clôture
-- ---------------------------------------------------------------------
CREATE FUNCTION signalements_effacer_contacts() RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
  UPDATE signalement_sanitaire SET contact = NULL
   WHERE contact IS NOT NULL AND statut = 'clos' AND traite_le < now() - interval '12 months';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE EXECUTE ON FUNCTION signalement_deposer(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION signalement_deposer(text, text, text, text, text) TO sabou_app;
REVOKE EXECUTE ON FUNCTION signalement_decider(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION signalement_decider(text, text, text) TO sabou_app;
REVOKE EXECUTE ON FUNCTION traitement_suspension_lever(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION traitement_suspension_lever(text, text) TO sabou_app;
REVOKE EXECUTE ON FUNCTION signalements_effacer_contacts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION signalements_effacer_contacts() TO sabou_app;
