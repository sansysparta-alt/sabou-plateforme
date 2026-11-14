-- US-048 : l'entonnoir des 6 étapes et les dossiers bloqués (UC-67, R-CER-07).
--   - Par étape : dossiers en cours, dossiers bloqués, délai moyen des passages terminés
--     sur 12 mois glissants (temps entre l'arrivée dans l'étape et la décision qui l'en fait
--     sortir), à comparer au délai cible de 3 jours (R-CER-07).
--   - Dossiers bloqués : en cours, sans décision depuis plus de 15 jours, de l'étape 2 à 5 :
--     à l'étape 1, le dossier attend le praticien, pas une décision de l'administration.
--   - Fonctions aux droits de l'appelant : le cloisonnement par zone (RLS) s'applique ; la
--     DG voit le national. L'API les réserve aujourd'hui à la DG.
-- p_maintenant : l'heure de référence, fixée par les tests ; l'API ne la passe pas.
-- Voir 05_Choix_Techniques.md §2.38.

SET search_path = sabou, public;

CREATE FUNCTION certification_entonnoir(p_maintenant timestamptz DEFAULT now())
RETURNS TABLE (etape integer, en_cours integer, bloques integer, passages integer,
               delai_moyen_jours numeric)
LANGUAGE sql STABLE SET search_path = sabou, pg_catalog, pg_temp AS $$
  WITH sorties AS (
    -- Chaque décision fait sortir le dossier de etape_depart ; il y était entré à la
    -- décision précédente, ou à l'ouverture du dossier pour la première
    SELECT h.etape_depart AS etape, h.decide_le,
           h.decide_le - coalesce(lag(h.decide_le) OVER (PARTITION BY h.dossier_id
                                                         ORDER BY h.decide_le, h.id),
                                  d.ouvert_le) AS duree
      FROM dossier_historique h JOIN dossier_certification d ON d.id = h.dossier_id),
  delais AS (
    SELECT s.etape, count(*)::int AS passages,
           round((extract(epoch FROM avg(s.duree)) / 86400)::numeric, 1) AS moyenne
      FROM sorties s
     WHERE s.decide_le > p_maintenant - interval '12 months' AND s.decide_le <= p_maintenant
     GROUP BY s.etape),
  encours AS (
    SELECT d.etape_courante AS etape, count(*)::int AS en_cours,
           (count(*) FILTER (WHERE d.etape_courante BETWEEN 2 AND 5
                               AND d.etape_entree_le < p_maintenant - interval '15 days'))::int AS bloques
      FROM dossier_certification d
     WHERE d.statut = 'en_cours'
     GROUP BY d.etape_courante)
  SELECT e.n, coalesce(c.en_cours, 0), coalesce(c.bloques, 0), coalesce(l.passages, 0), l.moyenne
    FROM generate_series(1, 6) AS e(n)
    LEFT JOIN encours c ON c.etape = e.n
    LEFT JOIN delais l  ON l.etape = e.n
   ORDER BY e.n
$$;

CREATE FUNCTION certification_dossiers_bloques(p_maintenant timestamptz DEFAULT now())
RETURNS TABLE (dossier text, praticien text, nom text, etape integer, prefecture text,
               region text, depuis timestamptz, jours integer)
LANGUAGE sql STABLE SET search_path = sabou, pg_catalog, pg_temp AS $$
  SELECT d.code, pr.code, u.prenom || ' ' || u.nom, d.etape_courante::int, pf.nom, ra.nom,
         d.etape_entree_le,
         floor(extract(epoch FROM p_maintenant - d.etape_entree_le) / 86400)::int
    FROM dossier_certification d
    JOIN praticien pr    ON pr.id = d.praticien_id
    JOIN utilisateur u   ON u.id = pr.utilisateur_id
    JOIN prefecture pf   ON pf.id = pr.prefecture_id
    JOIN region_admin ra ON ra.id = pf.region_admin_id
   WHERE d.statut = 'en_cours' AND d.etape_courante BETWEEN 2 AND 5
     AND d.etape_entree_le < p_maintenant - interval '15 days'
   ORDER BY d.etape_entree_le, d.id
$$;

REVOKE EXECUTE ON FUNCTION certification_entonnoir(timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION certification_dossiers_bloques(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION certification_entonnoir(timestamptz) TO sabou_app;
GRANT EXECUTE ON FUNCTION certification_dossiers_bloques(timestamptz) TO sabou_app;

-- Dossiers en cours par ancienneté dans l'étape (bloqués) : index partiel existant
-- ix_dossier_etape (etape_courante, etape_entree_le) WHERE statut = 'en_cours'.
