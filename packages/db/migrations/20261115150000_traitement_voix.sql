-- US-070 : traiter chaque voix déposée (UC-73, CdC §8, 05_Choix_Techniques §2.17 et §2.43).
--   - une voix déposée (fichier d'origine dans le stockage objet) entre dans une file ; l'API
--     la traite : réduction du bruit, normalisation du volume, Opus 24 kbit/s et secours AAC ;
--   - durée, taille et empreinte sont calculées sur le fichier publié et enregistrées dans
--     audio_fichier, avec le dépositaire et son consentement ;
--   - trois essais au plus ; au-delà, le dépôt est en échec, avec la raison.
-- Le rattachement de la voix à un nom de plante ou de maladie relève de US-053 et US-071.
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Fichier publié : Opus (WebM) et secours AAC (MP4)
-- ---------------------------------------------------------------------
ALTER TABLE audio_fichier
  ADD COLUMN chemin_secours text UNIQUE,
  ADD COLUMN taille_secours_octets integer CHECK (taille_secours_octets > 0);
COMMENT ON COLUMN audio_fichier.chemin_secours IS
  'Version AAC (MP4) pour les navigateurs qui lisent mal Opus (05 §2.7) ; même voix traitée.';

-- ---------------------------------------------------------------------
-- 2. Dépôts : la voix telle qu'enregistrée, en attente de traitement
-- ---------------------------------------------------------------------
CREATE TABLE voix_depot (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  depose_par      bigint NOT NULL REFERENCES utilisateur(id),
  cle_originale   text   NOT NULL UNIQUE,
  type_mime       text   NOT NULL CHECK (type_mime IN ('audio/webm','audio/ogg','audio/mp4','audio/wav','audio/mpeg')),
  taille_octets   integer NOT NULL CHECK (taille_octets > 0),
  sha256_original char(64) NOT NULL CHECK (sha256_original ~ '^[0-9a-f]{64}$'),
  -- Consentement de la personne qui parle (R-LNG-11), recopié sur la voix publiée
  consentement    boolean NOT NULL,
  statut          text   NOT NULL DEFAULT 'en_attente'
                  CHECK (statut IN ('en_attente','en_cours','traitee','echec')),
  tentatives      smallint NOT NULL DEFAULT 0 CHECK (tentatives BETWEEN 0 AND 3),
  erreur          text CHECK (char_length(erreur) <= 500),
  pris_le         timestamptz,
  audio_id        bigint UNIQUE REFERENCES audio_fichier(id),
  depose_le       timestamptz NOT NULL DEFAULT now(),
  traite_le       timestamptz,
  CONSTRAINT ck_voix_depot_traitee CHECK ((statut = 'traitee') = (audio_id IS NOT NULL))
);
CREATE INDEX ix_voix_depot_file ON voix_depot (depose_le) WHERE statut IN ('en_attente','en_cours');
COMMENT ON TABLE voix_depot IS
  'Voix déposées en attente de traitement (US-070) : original dans le stockage objet, trois essais au plus.';

-- Dépôt par un compte actif : administrateurs (enregistrement des noms, US-071) et
-- praticiens (traitements, à venir). L'acteur est celui du contexte de session.
CREATE FUNCTION voix_deposer(p_cle text, p_type_mime text, p_taille integer, p_sha256 text,
                             p_consentement boolean)
RETURNS voix_depot LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_usr utilisateur%ROWTYPE;
        v_dep voix_depot%ROWTYPE;
BEGIN
  SELECT * INTO v_usr FROM utilisateur WHERE id = contexte_utilisateur() AND statut = 'actif';
  IF NOT FOUND THEN RAISE EXCEPTION 'Acteur inconnu ou suspendu'; END IF;
  IF v_usr.role_code NOT IN ('dg','regional','prefectoral','scientifique','praticien') THEN
    RAISE EXCEPTION 'Dépôt de voix non autorisé pour ce profil';
  END IF;
  INSERT INTO voix_depot (depose_par, cle_originale, type_mime, taille_octets, sha256_original,
                          consentement)
  VALUES (v_usr.id, p_cle, p_type_mime, p_taille, p_sha256, p_consentement)
  RETURNING * INTO v_dep;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr.id, 'voix.deposee', 'voix_depot', v_dep.id::text,
          jsonb_build_object('sha256', v_dep.sha256_original, 'consentement', p_consentement));
  RETURN v_dep;
END $$;

-- État d'un dépôt, pour la personne qui l'a déposé seulement
CREATE FUNCTION voix_depot_etat(p_depot bigint)
RETURNS TABLE (statut text, erreur text, duree_sec numeric, taille_octets integer, sha256 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
  SELECT d.statut, CASE WHEN d.statut = 'echec' THEN d.erreur END, a.duree_sec, a.taille_octets,
         a.sha256
    FROM voix_depot d LEFT JOIN audio_fichier a ON a.id = d.audio_id
   WHERE d.id = p_depot AND d.depose_par = contexte_utilisateur()
$$;

-- ---------------------------------------------------------------------
-- 3. File de traitement, relevée par l'API (sans contexte d'utilisateur)
-- ---------------------------------------------------------------------
-- Prend jusqu'à p_nombre dépôts : en attente, ou « en cours » depuis plus de 10 minutes
-- (traitement interrompu par un arrêt de l'API). Une seule instance prend chaque dépôt.
CREATE FUNCTION voix_depots_prendre(p_nombre integer)
RETURNS TABLE (id bigint, cle_originale text, type_mime text, tentatives smallint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
-- Colonnes de la table prioritaires sur les colonnes de résultat de même nom
#variable_conflict use_column
BEGIN
  -- Interrompu au troisième essai : échec, plutôt qu'un quatrième essai
  UPDATE voix_depot SET statut = 'echec', erreur = 'Traitement interrompu à chaque essai',
                        traite_le = now()
   WHERE statut = 'en_cours' AND pris_le < now() - interval '10 minutes' AND tentatives >= 3;
  RETURN QUERY
  WITH pris AS (
    SELECT d.id FROM voix_depot d
     WHERE d.statut = 'en_attente'
        OR (d.statut = 'en_cours' AND d.pris_le < now() - interval '10 minutes')
     ORDER BY d.depose_le
     LIMIT least(greatest(p_nombre, 1), 10)
     FOR UPDATE SKIP LOCKED)
  UPDATE voix_depot d SET statut = 'en_cours', pris_le = now(), tentatives = d.tentatives + 1
    FROM pris WHERE d.id = pris.id
  RETURNING d.id, d.cle_originale, d.type_mime, d.tentatives;
END $$;

-- Voix traitée : fichier publié (Opus et AAC), durée, taille et empreinte du fichier Opus
CREATE FUNCTION voix_depot_terminer(p_depot bigint, p_chemin text, p_chemin_secours text,
                                    p_duree_sec numeric, p_taille integer,
                                    p_taille_secours integer, p_sha256 text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_dep   voix_depot%ROWTYPE;
        v_audio bigint;
BEGIN
  SELECT * INTO v_dep FROM voix_depot WHERE id = p_depot AND statut = 'en_cours' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dépôt % absent ou pas en cours', p_depot; END IF;
  INSERT INTO audio_fichier (chemin, duree_sec, format, taille_octets, sha256, enregistre_par,
                             consentement_voix, consentement_le, chemin_secours,
                             taille_secours_octets)
  VALUES (p_chemin, round(p_duree_sec, 2), 'opus', p_taille, p_sha256, v_dep.depose_par,
          v_dep.consentement, CASE WHEN v_dep.consentement THEN v_dep.depose_le END,
          p_chemin_secours, p_taille_secours)
  RETURNING id INTO v_audio;
  UPDATE voix_depot SET statut = 'traitee', audio_id = v_audio, erreur = NULL, traite_le = now()
   WHERE id = p_depot;
  RETURN v_audio;
END $$;

-- Échec d'un essai : nouvel essai au passage suivant, échec définitif au troisième
CREATE FUNCTION voix_depot_echouer(p_depot bigint, p_erreur text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_statut text;
BEGIN
  UPDATE voix_depot
     SET statut = CASE WHEN tentatives >= 3 THEN 'echec' ELSE 'en_attente' END,
         erreur = left(p_erreur, 500),
         traite_le = CASE WHEN tentatives >= 3 THEN now() END
   WHERE id = p_depot AND statut = 'en_cours'
  RETURNING statut INTO v_statut;
  RETURN v_statut;
END $$;

-- Aucune écriture directe : dépôts et voix publiées passent par ces fonctions
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON voix_depot FROM sabou_app;
REVOKE EXECUTE ON FUNCTION voix_deposer(text, text, integer, text, boolean),
  voix_depot_etat(bigint), voix_depots_prendre(integer),
  voix_depot_terminer(bigint, text, text, numeric, integer, integer, text),
  voix_depot_echouer(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION voix_deposer(text, text, integer, text, boolean),
  voix_depot_etat(bigint), voix_depots_prendre(integer),
  voix_depot_terminer(bigint, text, text, numeric, integer, integer, text),
  voix_depot_echouer(bigint, text) TO sabou_app;
