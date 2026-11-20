-- US-091 : rapports mensuels et historique des exports (UC-36, UC-67 ; R-MOD-09).
-- Décisions du maître d'œuvre du 20 novembre 2026 (05 §2.91) :
--   - chaîne complète : le préfectoral envoie son rapport au régional ; le régional regroupe
--     les rapports de ses préfectures et envoie le sien à la DG ;
--   - rapport du mois écoulé, prérempli dès le 1er (calculé dans la base, aux droits de son
--     auteur : la zone s'applique par les règles RLS) ; commentaire ; l'envoi le fige ;
--   - le destinataire peut le renvoyer avec un motif : l'auteur prépare une nouvelle version,
--     l'ancienne est gardée telle quelle ;
--   - export PDF et XLSX de chaque tableau de bord et des rapports, avec historique : chaque
--     export garde la photographie des données exportées, le fichier se régénère à l'identique.
-- Prouvé sur un vrai PostgreSQL : packages/db/test/rapports.test.ts.
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Rapport mensuel
-- ---------------------------------------------------------------------
CREATE TABLE rapport_mensuel (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  niveau           text NOT NULL CHECK (niveau IN ('prefectoral','regional')),
  -- Zone du rapport : la préfecture pour un rapport préfectoral, et toujours sa région
  prefecture_id    smallint REFERENCES prefecture(id),
  region_admin_id  smallint NOT NULL REFERENCES region_admin(id),
  -- Premier jour du mois rapporté
  mois             date NOT NULL CHECK (extract(day FROM mois) = 1),
  version          smallint NOT NULL DEFAULT 1 CHECK (version >= 1),
  statut           text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','envoye','renvoye')),
  contenu          jsonb NOT NULL,
  commentaire      text CHECK (char_length(commentaire) <= 4000),
  calcule_le       timestamptz NOT NULL DEFAULT now(),
  redige_par       bigint NOT NULL REFERENCES utilisateur(id),
  envoye_par       bigint REFERENCES utilisateur(id),
  envoye_le        timestamptz,
  renvoi_motif     text CHECK (btrim(renvoi_motif) <> '' AND char_length(renvoi_motif) <= 1000),
  renvoye_par      bigint REFERENCES utilisateur(id),
  renvoye_le       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rapport_zone CHECK ((niveau = 'prefectoral') = (prefecture_id IS NOT NULL)),
  CONSTRAINT ck_rapport_envoye CHECK (statut = 'brouillon' OR (envoye_par IS NOT NULL AND envoye_le IS NOT NULL)),
  CONSTRAINT ck_rapport_renvoye CHECK ((statut = 'renvoye') = (renvoye_le IS NOT NULL AND renvoi_motif IS NOT NULL AND renvoye_par IS NOT NULL))
);
-- Une version par numéro ; une seule version vivante (brouillon ou envoyée) par zone et par mois
CREATE UNIQUE INDEX ux_rapport_version
  ON rapport_mensuel (niveau, region_admin_id, coalesce(prefecture_id, 0), mois, version);
CREATE UNIQUE INDEX ux_rapport_vivant
  ON rapport_mensuel (niveau, region_admin_id, coalesce(prefecture_id, 0), mois)
  WHERE statut <> 'renvoye';
CREATE INDEX ix_rapport_recus ON rapport_mensuel (region_admin_id, mois) WHERE statut <> 'brouillon';
COMMENT ON TABLE rapport_mensuel IS
  'Rapport mensuel préfectoral → régional → DG (R-MOD-09, UC-36) : prérempli, commenté, figé à l''envoi ; renvoi motivé = nouvelle version.';

-- Lecture : l'auteur (sa zone) ; le destinataire une fois le rapport envoyé (le régional pour
-- les préfectures de sa région, la DG pour les régions). Le Comité et les praticiens : rien.
CREATE FUNCTION rapport_visible(p_niveau text, p_prefecture smallint, p_region smallint, p_statut text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE contexte_role()
    WHEN 'prefectoral' THEN p_niveau = 'prefectoral'
                            AND p_prefecture = nullif(current_setting('sabou.prefecture_id', true), '')::smallint
    WHEN 'regional'    THEN p_region = nullif(current_setting('sabou.region_id', true), '')::smallint
                            AND (p_niveau = 'regional' OR p_statut <> 'brouillon')
    WHEN 'dg'          THEN p_niveau = 'regional' AND p_statut <> 'brouillon'
    ELSE false
  END
$$;
ALTER TABLE rapport_mensuel ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON rapport_mensuel TO sabou_app
  USING (rapport_visible(niveau, prefecture_id, region_admin_id, statut))
  -- Écriture : l'auteur dans sa zone, ou le destinataire qui renvoie (statut « renvoyé »)
  WITH CHECK (rapport_visible(niveau, prefecture_id, region_admin_id,
                              CASE WHEN statut = 'renvoye' THEN 'renvoye' ELSE 'brouillon' END)
              AND CASE WHEN statut = 'renvoye'
                       -- Renvoi : le destinataire seulement
                       THEN (niveau = 'prefectoral' AND contexte_role() = 'regional')
                            OR (niveau = 'regional' AND contexte_role() = 'dg')
                       -- Rédaction et envoi : l'auteur de ce niveau seulement
                       ELSE contexte_role() = niveau END);
-- Rien ne s'efface : un rapport renvoyé reste lisible avec son motif
REVOKE DELETE, TRUNCATE ON rapport_mensuel FROM sabou_app;

-- Figé à l'envoi : seul le renvoi motivé change encore un rapport envoyé ; un rapport renvoyé
-- ne change plus du tout
CREATE FUNCTION trg_rapport_fige() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.statut = 'renvoye'
     OR (OLD.statut = 'envoye' AND (NEW.statut <> 'renvoye'
         OR NEW.contenu IS DISTINCT FROM OLD.contenu
         OR NEW.commentaire IS DISTINCT FROM OLD.commentaire
         OR NEW.calcule_le IS DISTINCT FROM OLD.calcule_le
         OR NEW.envoye_le IS DISTINCT FROM OLD.envoye_le)) THEN
    RAISE EXCEPTION 'Rapport % : envoyé, il ne peut plus être modifié', OLD.id;
  END IF;
  IF (NEW.niveau, NEW.prefecture_id, NEW.region_admin_id, NEW.mois, NEW.version, NEW.redige_par)
     IS DISTINCT FROM (OLD.niveau, OLD.prefecture_id, OLD.region_admin_id, OLD.mois, OLD.version, OLD.redige_par) THEN
    RAISE EXCEPTION 'Rapport % : zone, mois et version ne changent pas', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_rapport_fige BEFORE UPDATE ON rapport_mensuel
  FOR EACH ROW EXECUTE FUNCTION trg_rapport_fige();

-- ---------------------------------------------------------------------
-- 2. Contenu prérempli (« activité, délais, anomalies », CdC §6.4), aux droits de l'auteur
-- ---------------------------------------------------------------------
-- Sorties d'une étape pendant le mois : décision, durée passée dans l'étape (même calcul que
-- l'entonnoir, §2.38), dossier et préfecture du praticien. Les règles RLS limitent à la zone.
CREATE FUNCTION rapport_sorties(p_etape smallint, p_debut timestamptz, p_fin timestamptz)
RETURNS TABLE (decision text, jours numeric, prefecture_id smallint)
LANGUAGE sql STABLE SET search_path = sabou, pg_catalog, pg_temp AS $$
  SELECT s.decision, s.jours, s.prefecture_id
    FROM (SELECT h.etape_depart, h.decision, h.decide_le, p.prefecture_id,
                 extract(epoch FROM h.decide_le - coalesce(lag(h.decide_le) OVER (PARTITION BY h.dossier_id
                                                                    ORDER BY h.decide_le, h.id),
                                                   d.ouvert_le)) / 86400 AS jours
            FROM dossier_historique h
            JOIN dossier_certification d ON d.id = h.dossier_id
            JOIN praticien p             ON p.id = d.praticien_id) s
   WHERE s.etape_depart = p_etape AND s.decide_le >= p_debut AND s.decide_le < p_fin
$$;

-- Délais d'une étape : passages, moyenne (jours, une décimale), hors délai de 3 jours (R-CER-07)
CREATE FUNCTION rapport_delais(p_etape smallint, p_debut timestamptz, p_fin timestamptz,
                               p_prefecture smallint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = sabou, pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'passages',    count(*),
    'valides',     count(*) FILTER (WHERE decision = 'valide'),
    'renvoyes',    count(*) FILTER (WHERE decision = 'rejete'),
    'moyenneJours', round(avg(jours), 1),
    'horsDelai',   count(*) FILTER (WHERE jours > 3),
    'objectifJours', 3)
    FROM rapport_sorties(p_etape, p_debut, p_fin)
   WHERE p_prefecture IS NULL OR prefecture_id = p_prefecture
$$;

CREATE FUNCTION rapport_contenu_prefectoral(p_mois date) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = sabou, pg_catalog, pg_temp AS $$
  WITH periode AS (SELECT p_mois::timestamptz AS debut, (p_mois + interval '1 month')::timestamptz AS fin)
  SELECT jsonb_build_object(
    'activite', jsonb_build_object(
       'nouveauxPraticiens', (SELECT count(*) FROM praticien, periode
                               WHERE created_at >= debut AND created_at < fin),
       'dossiersSoumis',     (SELECT count(*) FROM dossier_historique h, periode
                               WHERE h.decision = 'soumis' AND h.decide_le >= debut AND h.decide_le < fin),
       'visitesRealisees',   (SELECT count(*) FROM visite_terrain v, periode
                               WHERE v.statut = 'realisee' AND v.realisee_le >= debut AND v.realisee_le < fin),
       'recettesNumerisees', (SELECT count(*) FROM recette r, periode
                               WHERE r.saisi_par IS NOT NULL AND r.created_at >= debut AND r.created_at < fin),
       'praticiensPublies',  (SELECT count(*) FROM dossier_historique h, periode
                               WHERE h.decision = 'publie' AND h.decide_le >= debut AND h.decide_le < fin)),
    'delais', (SELECT rapport_delais(2::smallint, debut, fin) FROM periode),
    'anomalies', jsonb_build_object(
       -- Photographie au moment du calcul : dossiers sans décision depuis plus de 15 jours
       'dossiersBloques', coalesce((
          SELECT jsonb_agg(jsonb_build_object('dossier', d.code, 'etape', d.etape_courante,
                                              'depuis', iso_utc(d.etape_entree_le))
                           ORDER BY d.etape_entree_le)
            FROM dossier_certification d
           WHERE d.statut = 'en_cours' AND d.etape_courante BETWEEN 2 AND 5
             AND d.etape_entree_le < now() - interval '15 days'), '[]'::jsonb),
       'alertesOuvertes', (SELECT count(*) FROM alerte_territoriale, periode
                            WHERE created_at < fin AND (close_le IS NULL OR close_le >= fin))),
    'registre', (SELECT jsonb_build_object(
                   'enregistres', count(*),
                   'certifies',   count(*) FILTER (WHERE statut = 'certifie'),
                   'enAttente',   count(*) FILTER (WHERE statut = 'en_attente'))
                   FROM praticien))
$$;

CREATE FUNCTION rapport_contenu_regional(p_mois date) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = sabou, pg_catalog, pg_temp AS $$
  WITH periode AS (SELECT p_mois::timestamptz AS debut, (p_mois + interval '1 month')::timestamptz AS fin),
       region AS (SELECT nullif(current_setting('sabou.region_id', true), '')::smallint AS id),
       prefs AS (SELECT pf.id, pf.nom FROM prefecture pf, region
                  WHERE pf.region_admin_id = region.id AND pf.active),
       -- Rapport préfectoral reçu pour le mois : la version envoyée (ou la dernière renvoyée)
       recus AS (SELECT DISTINCT ON (r.prefecture_id) r.*
                   FROM rapport_mensuel r
                  WHERE r.niveau = 'prefectoral' AND r.mois = p_mois AND r.statut <> 'brouillon'
                  ORDER BY r.prefecture_id, (r.statut = 'envoye') DESC, r.version DESC)
  SELECT jsonb_build_object(
    'activite', jsonb_build_object(
       'litigesOuverts', (SELECT count(*) FROM litige, periode WHERE created_at >= debut AND created_at < fin),
       'litigesResolus', (SELECT count(*) FROM litige, periode WHERE decide_le >= debut AND decide_le < fin),
       'traitementsTransmis', (SELECT count(*) FROM recette_historique h, periode
                                WHERE h.statut_depart = 'soumise' AND h.statut_arrivee = 'transmise'
                                  AND h.decide_le >= debut AND h.decide_le < fin)),
    'delais', (SELECT rapport_delais(3::smallint, debut, fin) FROM periode),
    'anomalies', jsonb_build_object(
       'dossiersBloques', coalesce((
          SELECT jsonb_agg(jsonb_build_object('dossier', d.code, 'etape', d.etape_courante,
                                              'depuis', iso_utc(d.etape_entree_le))
                           ORDER BY d.etape_entree_le)
            FROM dossier_certification d
           WHERE d.statut = 'en_cours' AND d.etape_courante BETWEEN 2 AND 5
             AND d.etape_entree_le < now() - interval '15 days'), '[]'::jsonb),
       'alertesOuvertes', (SELECT count(*) FROM alerte_territoriale, periode
                            WHERE created_at < fin AND (close_le IS NULL OR close_le >= fin)),
       'rapportsManquants', (SELECT count(*) FROM prefs
                              WHERE NOT EXISTS (SELECT 1 FROM recus WHERE recus.prefecture_id = prefs.id
                                                                     AND recus.statut = 'envoye'))),
    'couverture', jsonb_build_object(
       'prefectures', (SELECT count(*) FROM prefs),
       'couvertes',   (SELECT count(*) FROM prefs WHERE EXISTS (
                         SELECT 1 FROM praticien p WHERE p.prefecture_id = prefs.id AND p.statut = 'certifie'))),
    -- Regroupement des rapports des préfectures (R-MOD-09)
    'prefectures', coalesce((
       SELECT jsonb_agg(jsonb_build_object(
                'prefecture', prefs.nom,
                'rapport', CASE WHEN r.id IS NULL THEN 'manquant' WHEN r.statut = 'envoye' THEN 'recu' ELSE 'renvoye' END,
                'version', r.version,
                'envoyeLe', iso_utc(r.envoye_le),
                'activite', r.contenu -> 'activite',
                'delais', r.contenu -> 'delais',
                'commentaire', r.commentaire)
              ORDER BY prefs.nom)
         FROM prefs LEFT JOIN recus r ON r.prefecture_id = prefs.id), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------
-- 3. Actions (rôle de l'API ; acteur lu dans le contexte de zone)
-- ---------------------------------------------------------------------
CREATE FUNCTION rapport_acteur() RETURNS utilisateur LANGUAGE plpgsql STABLE AS $$
DECLARE v_usr utilisateur%ROWTYPE;
BEGIN
  SELECT * INTO v_usr FROM utilisateur WHERE id = contexte_utilisateur() AND statut = 'actif'
     AND role_code IN ('dg','regional','prefectoral');
  IF NOT FOUND THEN RAISE EXCEPTION 'Rapport : action réservée à l''administration territoriale'; END IF;
  RETURN v_usr;
END $$;

-- Prépare (ou actualise) le rapport du mois pour l'auteur : préfectoral ou régional, mois écoulé
-- seulement. Brouillon existant : contenu recalculé, commentaire gardé. Rapport déjà envoyé :
-- rendu tel quel. Dernière version renvoyée : nouvelle version, avec le commentaire repris.
CREATE FUNCTION rapport_mensuel_preparer(p_mois date) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_usr     utilisateur%ROWTYPE := rapport_acteur();
        v_niveau  text;
        v_region  smallint;
        v_der     rapport_mensuel%ROWTYPE;
        v_contenu jsonb;
        v_id      bigint;
BEGIN
  IF v_usr.role_code NOT IN ('prefectoral','regional') THEN
    RAISE EXCEPTION 'Rapport : rédaction réservée au préfectoral et au régional';
  END IF;
  IF p_mois IS NULL OR extract(day FROM p_mois) <> 1
     OR p_mois >= date_trunc('month', now() AT TIME ZONE 'Africa/Conakry')::date THEN
    RAISE EXCEPTION 'Rapport : seul un mois écoulé peut être rapporté';
  END IF;
  v_niveau := v_usr.role_code;
  v_region := coalesce(v_usr.region_admin_id,
                       (SELECT region_admin_id FROM prefecture WHERE id = v_usr.prefecture_id));
  SELECT * INTO v_der FROM rapport_mensuel
   WHERE niveau = v_niveau AND region_admin_id = v_region
     AND prefecture_id IS NOT DISTINCT FROM (CASE WHEN v_niveau = 'prefectoral' THEN v_usr.prefecture_id END)
     AND mois = p_mois
   ORDER BY version DESC LIMIT 1 FOR UPDATE;
  IF FOUND AND v_der.statut = 'envoye' THEN RETURN v_der.id; END IF;
  v_contenu := CASE v_niveau WHEN 'prefectoral' THEN rapport_contenu_prefectoral(p_mois)
                             ELSE rapport_contenu_regional(p_mois) END;
  IF FOUND AND v_der.statut = 'brouillon' THEN
    UPDATE rapport_mensuel SET contenu = v_contenu, calcule_le = now() WHERE id = v_der.id;
    RETURN v_der.id;
  END IF;
  INSERT INTO rapport_mensuel (niveau, prefecture_id, region_admin_id, mois, version, contenu,
                               commentaire, redige_par)
  VALUES (v_niveau, CASE WHEN v_niveau = 'prefectoral' THEN v_usr.prefecture_id END, v_region, p_mois,
          coalesce(v_der.version + 1, 1), v_contenu, v_der.commentaire, v_usr.id)
  -- Deux préparations simultanées du même mois : la seconde reprend la version créée par la
  -- première au lieu d'échouer sur l'index unique
  ON CONFLICT (niveau, region_admin_id, coalesce(prefecture_id, 0), mois) WHERE statut <> 'renvoye'
  DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM rapport_mensuel
     WHERE niveau = v_niveau AND region_admin_id = v_region
       AND coalesce(prefecture_id, 0) = coalesce(CASE WHEN v_niveau = 'prefectoral' THEN v_usr.prefecture_id END, 0)
       AND mois = p_mois AND statut <> 'renvoye';
    RETURN v_id;
  END IF;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr.id, 'rapport.prepare', 'rapport', v_id::text,
          jsonb_build_object('mois', p_mois, 'version', coalesce(v_der.version + 1, 1)));
  RETURN v_id;
END $$;

-- Brouillon de l'auteur, verrouillé ; hors zone : introuvable (RLS)
CREATE FUNCTION rapport_brouillon(p_id bigint, p_usr utilisateur) RETURNS rapport_mensuel
LANGUAGE plpgsql AS $$
DECLARE v_rap rapport_mensuel%ROWTYPE;
BEGIN
  SELECT * INTO v_rap FROM rapport_mensuel WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rapport % introuvable', p_id; END IF;
  IF v_rap.niveau <> p_usr.role_code THEN
    RAISE EXCEPTION 'Rapport % : seul son auteur peut le modifier', p_id;
  END IF;
  IF v_rap.statut <> 'brouillon' THEN
    RAISE EXCEPTION 'Rapport % : envoyé, il ne peut plus être modifié', p_id;
  END IF;
  RETURN v_rap;
END $$;

CREATE FUNCTION rapport_mensuel_commenter(p_id bigint, p_commentaire text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_usr utilisateur%ROWTYPE := rapport_acteur();
        v_rap rapport_mensuel%ROWTYPE := rapport_brouillon(p_id, v_usr);
BEGIN
  UPDATE rapport_mensuel SET commentaire = nullif(btrim(p_commentaire), '') WHERE id = v_rap.id;
END $$;

-- Envoi : contenu recalculé une dernière fois puis figé ; le destinataire est prévenu dans
-- l'application et par e-mail (en file). p_calcule_le : version vue à l'écran (refus si le
-- contenu a été recalculé entre-temps, même règle que les décisions, §2.31).
CREATE FUNCTION rapport_mensuel_envoyer(p_id bigint, p_calcule_le timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_usr utilisateur%ROWTYPE := rapport_acteur();
        v_rap rapport_mensuel%ROWTYPE := rapport_brouillon(p_id, v_usr);
BEGIN
  -- Comparaison à la seconde : l'heure est transmise à l'écran au format ISO 8601 (iso_utc)
  IF date_trunc('second', v_rap.calcule_le) <> date_trunc('second', p_calcule_le) THEN
    RAISE EXCEPTION 'Rapport % : les chiffres ont changé depuis votre lecture, relisez-les', p_id;
  END IF;
  UPDATE rapport_mensuel SET statut = 'envoye', envoye_par = v_usr.id, envoye_le = now()
   WHERE id = v_rap.id;
  INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
  SELECT u.id, c.canal, 'rapport.recu', 'rapport', p_id::text,
         jsonb_build_object('mois', v_rap.mois, 'niveau', v_rap.niveau)
    FROM utilisateur u CROSS JOIN (VALUES ('application'), ('email')) AS c(canal)
   WHERE u.statut = 'actif'
     AND ((v_rap.niveau = 'prefectoral' AND u.role_code = 'regional' AND u.region_admin_id = v_rap.region_admin_id)
          OR (v_rap.niveau = 'regional' AND u.role_code = 'dg'));
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr.id, 'rapport.envoye', 'rapport', p_id::text,
          jsonb_build_object('mois', v_rap.mois, 'version', v_rap.version));
END $$;

-- Renvoi motivé par le destinataire (régional pour un rapport préfectoral de sa région, DG pour
-- un rapport régional) ; l'auteur est prévenu et prépare une nouvelle version
CREATE FUNCTION rapport_mensuel_renvoyer(p_id bigint, p_motif text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_usr utilisateur%ROWTYPE := rapport_acteur();
        v_rap rapport_mensuel%ROWTYPE;
BEGIN
  SELECT * INTO v_rap FROM rapport_mensuel WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rapport % introuvable', p_id; END IF;
  IF NOT ((v_rap.niveau = 'prefectoral' AND v_usr.role_code = 'regional')
          OR (v_rap.niveau = 'regional' AND v_usr.role_code = 'dg')) THEN
    RAISE EXCEPTION 'Rapport % : renvoi réservé à son destinataire', p_id;
  END IF;
  IF v_rap.statut <> 'envoye' THEN
    RAISE EXCEPTION 'Rapport % : seul un rapport envoyé peut être renvoyé', p_id;
  END IF;
  IF coalesce(btrim(p_motif), '') = '' THEN RAISE EXCEPTION 'Rapport : motif du renvoi obligatoire'; END IF;
  UPDATE rapport_mensuel
     SET statut = 'renvoye', renvoi_motif = btrim(p_motif), renvoye_par = v_usr.id, renvoye_le = now()
   WHERE id = p_id;
  INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
  SELECT u.id, c.canal, 'rapport.renvoye', 'rapport', p_id::text, jsonb_build_object('mois', v_rap.mois)
    FROM utilisateur u CROSS JOIN (VALUES ('application'), ('email')) AS c(canal)
   WHERE u.statut = 'actif'
     AND ((v_rap.niveau = 'prefectoral' AND u.role_code = 'prefectoral' AND u.prefecture_id = v_rap.prefecture_id)
          OR (v_rap.niveau = 'regional' AND u.role_code = 'regional' AND u.region_admin_id = v_rap.region_admin_id));
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr.id, 'rapport.renvoye', 'rapport', p_id::text, jsonb_build_object('mois', v_rap.mois));
END $$;

-- ---------------------------------------------------------------------
-- 4. Historique des exports (table rapport_export du schéma initial)
-- ---------------------------------------------------------------------
ALTER TABLE rapport_export
  ADD COLUMN prefecture_id    smallint REFERENCES prefecture(id),
  ADD COLUMN region_admin_id  smallint REFERENCES region_admin(id),
  ADD COLUMN rapport_id       bigint REFERENCES rapport_mensuel(id),
  -- Photographie des données exportées : le fichier se régénère à l'identique
  ADD COLUMN contenu          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT ck_export_type CHECK (type IN ('tableau_de_bord','rapport_mensuel')),
  ADD CONSTRAINT ck_export_format CHECK (format IN ('pdf','xlsx')),
  ADD CONSTRAINT ck_export_rapport CHECK ((type = 'rapport_mensuel') = (rapport_id IS NOT NULL));
COMMENT ON TABLE rapport_export IS
  'Historique des exports PDF et XLSX (US-091) : qui, quoi, quand, et la photographie des données exportées.';
CREATE INDEX ix_export_recent ON rapport_export (created_at DESC);

-- Lecture : ses propres exports, et ceux de sa zone (la DG voit tout ; le régional sa région ;
-- le préfectoral sa préfecture ; le Comité, national, les siens seulement)
CREATE FUNCTION export_visible(p_auteur bigint, p_prefecture smallint, p_region smallint)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_auteur = contexte_utilisateur() OR CASE contexte_role()
    WHEN 'dg'          THEN true
    WHEN 'regional'    THEN p_region = nullif(current_setting('sabou.region_id', true), '')::smallint
    WHEN 'prefectoral' THEN p_prefecture = nullif(current_setting('sabou.prefecture_id', true), '')::smallint
    ELSE false
  END
$$;
ALTER TABLE rapport_export ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON rapport_export TO sabou_app
  USING (export_visible(demande_par, prefecture_id, region_admin_id))
  WITH CHECK (demande_par = contexte_utilisateur());
-- Historique en ajout seul
REVOKE UPDATE, DELETE, TRUNCATE ON rapport_export FROM sabou_app;

-- Crée l'export (photographie calculée ici, jamais fournie par l'appelant) et renvoie son id
CREATE FUNCTION export_creer(p_type text, p_format text, p_rapport bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_usr     utilisateur%ROWTYPE;
        v_rap     rapport_mensuel%ROWTYPE;
        v_contenu jsonb;
        v_debut   date;
        v_fin     date;
        v_id      bigint;
BEGIN
  SELECT * INTO v_usr FROM utilisateur WHERE id = contexte_utilisateur() AND statut = 'actif'
     AND role_code IN ('dg','regional','prefectoral','scientifique');
  IF NOT FOUND THEN RAISE EXCEPTION 'Export : réservé à l''administration'; END IF;
  IF p_format NOT IN ('pdf','xlsx') THEN RAISE EXCEPTION 'Export : format inconnu'; END IF;
  IF p_type = 'tableau_de_bord' THEN
    v_contenu := jsonb_build_object(
      'zone', coalesce((SELECT nom FROM prefecture WHERE id = v_usr.prefecture_id),
                       (SELECT nom FROM region_admin WHERE id = v_usr.region_admin_id), 'National'),
      'indicateurs', tableau_de_bord());
  ELSIF p_type = 'rapport_mensuel' THEN
    SELECT * INTO v_rap FROM rapport_mensuel WHERE id = p_rapport;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rapport % introuvable', p_rapport; END IF;
    v_debut := v_rap.mois;
    v_fin := (v_rap.mois + interval '1 month' - interval '1 day')::date;
    v_contenu := jsonb_build_object(
      'niveau', v_rap.niveau, 'mois', v_rap.mois, 'version', v_rap.version, 'statut', v_rap.statut,
      'zone', coalesce((SELECT nom FROM prefecture WHERE id = v_rap.prefecture_id),
                       (SELECT nom FROM region_admin WHERE id = v_rap.region_admin_id)),
      'region', (SELECT nom FROM region_admin WHERE id = v_rap.region_admin_id),
      'auteur', (SELECT prenom || ' ' || nom FROM utilisateur WHERE id = v_rap.redige_par),
      'calculeLe', iso_utc(v_rap.calcule_le), 'envoyeLe', iso_utc(v_rap.envoye_le),
      'renvoiMotif', v_rap.renvoi_motif,
      'contenu', v_rap.contenu, 'commentaire', v_rap.commentaire);
  ELSE
    RAISE EXCEPTION 'Export : type inconnu';
  END IF;
  INSERT INTO rapport_export (type, format, periode_debut, periode_fin, demande_par, statut,
                              prefecture_id, region_admin_id, rapport_id, contenu)
  VALUES (p_type, p_format, v_debut, v_fin, v_usr.id, 'pret', v_usr.prefecture_id,
          coalesce(v_usr.region_admin_id, (SELECT region_admin_id FROM prefecture WHERE id = v_usr.prefecture_id)),
          p_rapport, v_contenu)
  RETURNING id INTO v_id;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_usr.id, 'export.cree', 'export', v_id::text,
          jsonb_build_object('type', p_type, 'format', p_format, 'rapport', p_rapport));
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION rapport_sorties(smallint, timestamptz, timestamptz),
  rapport_delais(smallint, timestamptz, timestamptz, smallint),
  rapport_contenu_prefectoral(date), rapport_contenu_regional(date), rapport_acteur(),
  rapport_mensuel_preparer(date), rapport_brouillon(bigint, utilisateur),
  rapport_mensuel_commenter(bigint, text), rapport_mensuel_envoyer(bigint, timestamptz),
  rapport_mensuel_renvoyer(bigint, text), export_creer(text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rapport_sorties(smallint, timestamptz, timestamptz),
  rapport_delais(smallint, timestamptz, timestamptz, smallint),
  rapport_contenu_prefectoral(date), rapport_contenu_regional(date), rapport_acteur(),
  rapport_mensuel_preparer(date), rapport_brouillon(bigint, utilisateur),
  rapport_mensuel_commenter(bigint, text), rapport_mensuel_envoyer(bigint, timestamptz),
  rapport_mensuel_renvoyer(bigint, text), export_creer(text, text, bigint) TO sabou_app;
