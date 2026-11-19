-- US-074 : suivre la couverture vocale par langue et publier les voix validées (UC-63,
-- R-GOV-05, R-LNG-10 à 12).
--   - couverture : pour chaque langue de voix, part des sections des traitements certifiés
--     dont la voix est publiée ;
--   - retards par région (celle du praticien) : voix en attente depuis plus de 7 jours, à
--     chaque étape (brouillon, envoyée, validée) ;
--   - publication groupée par la DG : toutes les voix validées des traitements certifiés,
--     d'une langue ou de toutes ; une voix sans consentement, ou des effets indésirables sans
--     contrôle du Comité, reste validée et est comptée « bloquée » avec sa raison.
SET search_path = sabou, public;

-- Délai au-delà duquel une voix en attente est en retard
CREATE FUNCTION voix_delai_retard() RETURNS interval LANGUAGE sql IMMUTABLE AS $$
  SELECT interval '7 days'
$$;

-- Voix publiable : validée, traitement certifié avec le consentement du praticien, voix avec
-- le consentement de la personne qui parle, contrôle du Comité pour les effets indésirables
CREATE FUNCTION voix_section_blocage(p_section bigint, p_langue text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN v.statut <> 'valide' THEN 'pas validée'
    WHEN r.statut <> 'certifiee' THEN 'traitement non certifié'
    WHEN r.consentement_le IS NULL THEN 'consentement du praticien absent'
    WHEN NOT coalesce(a.consentement_voix, false) THEN 'consentement de la personne qui parle absent'
    WHEN s.type_code = 'effets_indesirables' AND v.controle_comite_par IS NULL
      THEN 'contrôle du Comité attendu'
  END
    FROM recette_section_voix v
    JOIN recette_section s ON s.id = v.section_id
    JOIN recette r ON r.id = s.recette_id
    JOIN audio_fichier a ON a.id = v.audio_id
   WHERE v.section_id = p_section AND v.langue_code = p_langue
$$;

CREATE FUNCTION traitement_voix_publier(p_langue text DEFAULT NULL)
RETURNS TABLE (publiees integer, bloquees integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_act utilisateur%ROWTYPE;
        v_pub integer;
        v_blo integer;
BEGIN
  v_act := voix_nom_acteur();
  IF v_act.role_code <> 'dg' THEN
    RAISE EXCEPTION 'Publication réservée à la Direction Générale';
  END IF;
  WITH cible AS (
    SELECT v.section_id, v.langue_code, voix_section_blocage(v.section_id, v.langue_code) AS raison
      FROM recette_section_voix v
     WHERE v.statut = 'valide' AND (p_langue IS NULL OR v.langue_code = p_langue)
       FOR UPDATE OF v
  ), pub AS (
    UPDATE recette_section_voix v SET statut = 'publie', publie_par = v_act.id
      FROM cible c
     WHERE c.raison IS NULL AND v.section_id = c.section_id AND v.langue_code = c.langue_code
    RETURNING v.section_id
  )
  SELECT (SELECT count(*) FROM pub), (SELECT count(*) FROM cible WHERE raison IS NOT NULL)
    INTO v_pub, v_blo;
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (v_act.id, 'recette.voix_publiees', 'langue', coalesce(p_langue, 'toutes'),
          jsonb_build_object('publiees', v_pub, 'bloquees', v_blo));
  RETURN QUERY SELECT v_pub, v_blo;
END $$;

-- Couverture par langue : sections des traitements certifiés, publiées, en cours, bloquées
CREATE FUNCTION voix_couverture()
RETURNS TABLE (langue text, langue_nom text, sections integer, publiees integer,
               validees integer, bloquees integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
  SELECT l.code, l.nom_fr,
         count(s.id)::int,
         count(*) FILTER (WHERE v.statut = 'publie')::int,
         count(*) FILTER (WHERE v.statut = 'valide')::int,
         count(*) FILTER (WHERE v.statut = 'valide'
                            AND voix_section_blocage(v.section_id, v.langue_code) IS NOT NULL)::int
    FROM langue l
    LEFT JOIN recette r ON r.statut = 'certifiee'
    LEFT JOIN recette_section s ON s.recette_id = r.id
    LEFT JOIN recette_section_voix v ON v.section_id = s.id AND v.langue_code = l.code
   WHERE l.voix AND l.active
     AND EXISTS (SELECT 1 FROM utilisateur u WHERE u.id = contexte_utilisateur() AND u.role_code = 'dg')
   GROUP BY l.code, l.nom_fr, l.ordre
   ORDER BY l.ordre, l.nom_fr
$$;

-- Retards par région administrative du praticien : voix en attente depuis plus de 7 jours
CREATE FUNCTION voix_retards()
RETURNS TABLE (region text, brouillons integer, envoyees integer, validees integer,
               plus_ancienne date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
  SELECT ra.nom,
         count(*) FILTER (WHERE v.statut = 'brouillon')::int,
         count(*) FILTER (WHERE v.statut = 'traduit')::int,
         count(*) FILTER (WHERE v.statut = 'valide')::int,
         min(v.updated_at)::date
    FROM recette_section_voix v
    JOIN recette_section s ON s.id = v.section_id
    JOIN recette r ON r.id = s.recette_id
    JOIN praticien p ON p.id = r.praticien_id
    JOIN prefecture pf ON pf.id = p.prefecture_id
    JOIN region_admin ra ON ra.id = pf.region_admin_id
   WHERE v.statut IN ('brouillon', 'traduit', 'valide') AND r.statut <> 'retiree'
     AND v.updated_at < now() - voix_delai_retard()
     AND EXISTS (SELECT 1 FROM utilisateur u WHERE u.id = contexte_utilisateur() AND u.role_code = 'dg')
   GROUP BY ra.nom
   ORDER BY count(*) DESC, ra.nom
$$;

REVOKE EXECUTE ON FUNCTION traitement_voix_publier(text), voix_couverture(), voix_retards()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION traitement_voix_publier(text), voix_couverture(), voix_retards()
  TO sabou_app;
