-- US-090 : un tableau de bord adapté à chaque profil (UC-67 ; CdC §6.2 à §6.6).
-- Décisions du maître d'œuvre du 20 novembre 2026 (05 §2.90) :
--   - indicateurs du cahier des charges pour chaque profil ; ceux dont la donnée n'existe pas
--     encore (revenus, vues, écoutes, réputation) ne sont pas renvoyés : le récit qui crée la
--     donnée ajoute l'indicateur (backlog, note sous US-090) ;
--   - données limitées à la zone du compte : la fonction s'exécute avec les droits de
--     l'appelant (SECURITY INVOKER), les règles RLS des tables s'appliquent donc ; les tables
--     sans RLS (certificat, préfecture, région) sont filtrées ici par la zone du contexte ;
--   - flux (dossiers consolidés, traitements expertisés) sur 12 mois glissants, comme
--     l'entonnoir de la DG (US-048) ; stocks (praticiens, traitements, plantes) à l'instant ;
--   - couverture d'une région : part de ses préfectures actives qui ont au moins un praticien
--     certifié (même définition que le « désert thérapeutique » de US-102, 05 §2.89).
-- Prouvé sur un vrai PostgreSQL : packages/db/test/tableau-de-bord.test.ts.
SET search_path = sabou, public;

-- Nombre de lignes détaillées dans les listes du tableau de bord (le total est toujours donné)
CREATE FUNCTION tableau_de_bord_limite() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

-- Horodatage ISO 8601 en UTC, lu tel quel par l'API et les applications
CREATE FUNCTION iso_utc(p timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

-- ---------------------------------------------------------------------
-- 1. Direction Générale (§6.2) : certifiés, traitements, plantes, certificats ; certifiés par
--    région ; statut du registre
-- ---------------------------------------------------------------------
CREATE FUNCTION tableau_de_bord_dg() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = sabou, pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'profil', 'dg',
    'certifies',   (SELECT count(*) FROM praticien WHERE statut = 'certifie'),
    'traitements', (SELECT count(*) FROM recette WHERE statut = 'certifiee'),
    'plantes',     (SELECT count(*) FROM plante WHERE statut = 'validee'),
    -- certificat n'a pas de RLS : seuls ceux des praticiens visibles comptent
    'certificats', (SELECT count(*) FROM certificat c
                     WHERE c.statut = 'actif' AND c.expire_le >= current_date
                       AND EXISTS (SELECT 1 FROM praticien p WHERE p.id = c.praticien_id)),
    'parRegion', coalesce((
      SELECT jsonb_agg(jsonb_build_object('region', r.nom, 'certifies', r.n) ORDER BY r.nom)
        FROM (SELECT ra.nom,
                     (SELECT count(*) FROM praticien p JOIN prefecture pf ON pf.id = p.prefecture_id
                       WHERE pf.region_admin_id = ra.id AND p.statut = 'certifie') AS n
                FROM region_admin ra WHERE ra.active) r), '[]'::jsonb),
    'registre', (SELECT jsonb_build_object(
                   'enAttente', count(*) FILTER (WHERE statut = 'en_attente'),
                   'certifies', count(*) FILTER (WHERE statut = 'certifie'),
                   'suspendus', count(*) FILTER (WHERE statut = 'suspendu'),
                   'rejetes',   count(*) FILTER (WHERE statut = 'rejete'))
                   FROM praticien))
$$;

-- ---------------------------------------------------------------------
-- 2. Admin régional (§6.3) : praticiens, consolidés, litiges, couverture, dossiers à
--    consolider ; dossiers par préfecture ; alertes du jour
-- ---------------------------------------------------------------------
CREATE FUNCTION tableau_de_bord_regional() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = sabou, pg_catalog, pg_temp AS $$
  WITH region AS (SELECT nullif(current_setting('sabou.region_id', true), '')::smallint AS id),
       prefs AS (SELECT pf.id, pf.nom FROM prefecture pf, region
                  WHERE pf.region_admin_id = region.id AND pf.active),
       -- Passages de l'étape 3 (consolidation) sur 12 mois glissants, un par dossier
       consolides AS (
         SELECT DISTINCT h.dossier_id, p.prefecture_id
           FROM dossier_historique h
           JOIN dossier_certification d ON d.id = h.dossier_id
           JOIN praticien p             ON p.id = d.praticien_id
          WHERE h.etape_depart = 3 AND h.decision = 'valide'
            AND h.decide_le >= now() - interval '12 months'),
       en_cours AS (
         SELECT d.etape_courante, p.prefecture_id
           FROM dossier_certification d JOIN praticien p ON p.id = d.praticien_id
          WHERE d.statut = 'en_cours'),
       alertes AS (
         SELECT a.*, pf.nom AS prefecture
           FROM alerte_territoriale a LEFT JOIN prefecture pf ON pf.id = a.prefecture_id
          WHERE a.statut <> 'close')
  SELECT jsonb_build_object(
    'profil', 'regional',
    'praticiens',   (SELECT count(*) FROM praticien),
    'consolides',   (SELECT count(*) FROM consolides),
    'litiges',      (SELECT count(*) FROM litige WHERE statut <> 'resolu'),
    'couverture', jsonb_build_object(
       'prefectures', (SELECT count(*) FROM prefs),
       'couvertes',   (SELECT count(*) FROM prefs
                        WHERE EXISTS (SELECT 1 FROM praticien p
                                       WHERE p.prefecture_id = prefs.id AND p.statut = 'certifie'))),
    'aConsolider',  (SELECT count(*) FROM en_cours WHERE etape_courante = 3),
    'parPrefecture', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'prefecture', prefs.nom,
               'aValider',    (SELECT count(*) FROM en_cours e WHERE e.prefecture_id = prefs.id AND e.etape_courante = 2),
               'aConsolider', (SELECT count(*) FROM en_cours e WHERE e.prefecture_id = prefs.id AND e.etape_courante = 3),
               'consolides',  (SELECT count(*) FROM consolides c WHERE c.prefecture_id = prefs.id))
             ORDER BY prefs.nom)
        FROM prefs), '[]'::jsonb),
    'alertes', jsonb_build_object(
       'total', (SELECT count(*) FROM alertes),
       'dernieres', coalesce((
         SELECT jsonb_agg(jsonb_build_object(
                  'id', a.id, 'type', a.type, 'statut', a.statut, 'prefecture', a.prefecture,
                  'description', a.description, 'le', iso_utc(a.created_at))
                ORDER BY a.created_at DESC, a.id DESC)
           FROM (SELECT * FROM alertes ORDER BY created_at DESC, id DESC
                  LIMIT tableau_de_bord_limite()) a), '[]'::jsonb)))
$$;

-- ---------------------------------------------------------------------
-- 3. Admin préfectoral (§6.4) : enregistrés, certifiés, en attente, recettes numérisées ;
--    répartition par spécialité ; dossiers à valider
-- ---------------------------------------------------------------------
CREATE FUNCTION tableau_de_bord_prefectoral() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = sabou, pg_catalog, pg_temp AS $$
  WITH a_valider AS (
    SELECT d.code, u.prenom || ' ' || u.nom AS nom, d.etape_entree_le
      FROM dossier_certification d
      JOIN praticien p   ON p.id = d.praticien_id
      JOIN utilisateur u ON u.id = p.utilisateur_id
     WHERE d.statut = 'en_cours' AND d.etape_courante = 2)
  SELECT jsonb_build_object(
    'profil', 'prefectoral',
    'enregistres', (SELECT count(*) FROM praticien),
    'certifies',   (SELECT count(*) FROM praticien WHERE statut = 'certifie'),
    'enAttente',   (SELECT count(*) FROM praticien WHERE statut = 'en_attente'),
    -- Recettes saisies par un agent de terrain (US-082), quel que soit leur statut
    'recettesNumerisees', (SELECT count(*) FROM recette WHERE saisi_par IS NOT NULL),
    'parSpecialite', coalesce((
      SELECT jsonb_agg(jsonb_build_object('specialite', s.libelle_fr, 'praticiens', s.n)
                       ORDER BY s.n DESC, s.libelle_fr)
        FROM (SELECT sp.libelle_fr, count(*) AS n
                FROM praticien p JOIN specialite sp ON sp.id = p.specialite_id
               GROUP BY sp.libelle_fr) s), '[]'::jsonb),
    'aValider', jsonb_build_object(
       'total', (SELECT count(*) FROM a_valider),
       -- Les plus anciens d'abord : ce sont eux qui approchent du blocage (R-CER-07)
       'dossiers', coalesce((
         SELECT jsonb_agg(jsonb_build_object('dossier', a.code, 'praticien', a.nom,
                                             'depuis', iso_utc(a.etape_entree_le))
                          ORDER BY a.etape_entree_le, a.code)
           FROM (SELECT * FROM a_valider ORDER BY etape_entree_le, code
                  LIMIT tableau_de_bord_limite()) a), '[]'::jsonb)))
$$;

-- ---------------------------------------------------------------------
-- 4. Comité scientifique (§6.5) : expertisés, en attente, plantes, alertes ; pathologies les
--    plus traitées ; file d'expertise
-- ---------------------------------------------------------------------
CREATE FUNCTION tableau_de_bord_scientifique() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = sabou, pg_catalog, pg_temp AS $$
  WITH file AS (
    SELECT r.code, r.titre_fr, m.nom_fr AS maladie,
           (SELECT max(h.decide_le) FROM recette_historique h
             WHERE h.recette_id = r.id AND h.statut_arrivee = 'transmise') AS depuis
      FROM recette r JOIN maladie m ON m.id = r.maladie_id
     WHERE r.statut = 'transmise')
  SELECT jsonb_build_object(
    'profil', 'scientifique',
    -- Traitements expertisés par le Comité sur 12 mois glissants, un par traitement
    'expertises', (SELECT count(DISTINCT recette_id) FROM recette_historique
                    WHERE statut_depart = 'transmise' AND statut_arrivee = 'expertisee'
                      AND decide_le >= now() - interval '12 months'),
    'enAttente',  (SELECT count(*) FROM file),
    'plantes',    (SELECT count(*) FROM plante WHERE statut = 'validee'),
    'plantesEnRevue', (SELECT count(*) FROM plante WHERE statut = 'en_revue'),
    -- Signalements sanitaires ouverts (US-100) : le Comité seul les lit (RLS)
    'alertes',    (SELECT count(*) FROM signalement_sanitaire WHERE statut <> 'clos'),
    'alertesGraves', (SELECT count(*) FROM signalement_sanitaire
                       WHERE statut <> 'clos' AND gravite = 'grave'),
    'topPathologies', coalesce((
      SELECT jsonb_agg(jsonb_build_object('maladie', t.nom_fr, 'traitements', t.n)
                       ORDER BY t.n DESC, t.nom_fr)
        FROM (SELECT m.nom_fr, count(*) AS n
                FROM recette r JOIN maladie m ON m.id = r.maladie_id
               WHERE r.statut = 'certifiee'
               GROUP BY m.nom_fr ORDER BY n DESC, m.nom_fr
               LIMIT tableau_de_bord_limite()) t), '[]'::jsonb),
    'file', jsonb_build_object(
       'total', (SELECT count(*) FROM file),
       'traitements', coalesce((
         SELECT jsonb_agg(jsonb_build_object('code', f.code, 'titre', f.titre_fr,
                                             'maladie', f.maladie, 'depuis', iso_utc(f.depuis))
                          ORDER BY f.depuis NULLS FIRST, f.code)
           FROM (SELECT * FROM file ORDER BY depuis NULLS FIRST, code
                  LIMIT tableau_de_bord_limite()) f), '[]'::jsonb)))
$$;

-- ---------------------------------------------------------------------
-- 5. Praticien (§6.6, application mobile) : ses traitements par état ; frise de certification
--    de son dernier dossier ; certificat en cours
-- ---------------------------------------------------------------------
CREATE FUNCTION tableau_de_bord_praticien() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = sabou, pg_catalog, pg_temp AS $$
  WITH moi AS (SELECT id FROM praticien WHERE utilisateur_id = contexte_utilisateur()),
       dossier AS (
         SELECT d.* FROM dossier_certification d, moi
          WHERE d.praticien_id = moi.id ORDER BY d.ouvert_le DESC, d.id DESC LIMIT 1),
       cert AS (
         SELECT c.numero, c.emis_le, c.expire_le FROM certificat c, moi
          WHERE c.praticien_id = moi.id AND c.statut = 'actif')
  SELECT jsonb_build_object(
    'profil', 'praticien',
    'traitements', (SELECT jsonb_build_object(
                      'certifies',  count(*) FILTER (WHERE r.statut = 'certifiee'),
                      'enExamen',   count(*) FILTER (WHERE r.statut IN ('soumise','transmise','expertisee')),
                      'brouillons', count(*) FILTER (WHERE r.statut = 'brouillon'),
                      'suspendus',  count(*) FILTER (WHERE r.statut = 'suspendue'))
                      FROM recette r, moi WHERE r.praticien_id = moi.id),
    'dossier', (SELECT jsonb_build_object(
                  'code', d.code, 'statut', d.statut, 'etape', d.etape_courante,
                  -- Dernière arrivée dans chaque étape franchie ou en cours ; l'étape 1 date de
                  -- l'ouverture du dossier
                  'etapes', (SELECT jsonb_agg(jsonb_build_object(
                                'etape', e.n,
                                'etat', CASE WHEN d.statut = 'approuve' OR e.n < d.etape_courante THEN 'franchie'
                                             WHEN e.n = d.etape_courante AND d.statut = 'en_cours' THEN 'en_cours'
                                             WHEN e.n = d.etape_courante THEN 'arretee'
                                             ELSE 'a_venir' END,
                                'le', CASE WHEN e.n = 1 THEN iso_utc(d.ouvert_le)
                                           WHEN e.n <= d.etape_courante THEN iso_utc((
                                             SELECT max(h.decide_le) FROM dossier_historique h
                                              WHERE h.dossier_id = d.id AND h.etape_arrivee = e.n))
                                      END) ORDER BY e.n)
                               FROM generate_series(1, 6) AS e(n)))
                  FROM dossier d),
    'certificat', (SELECT jsonb_build_object('numero', c.numero, 'emisLe', c.emis_le,
                                             'expireLe', c.expire_le) FROM cert c))
$$;

-- ---------------------------------------------------------------------
-- 6. Point d'entrée : le tableau de bord du profil du contexte ouvert (contexte_ouvrir)
-- ---------------------------------------------------------------------
CREATE FUNCTION tableau_de_bord() RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = sabou, pg_catalog, pg_temp AS $$
BEGIN
  CASE contexte_role()
    WHEN 'dg'           THEN RETURN tableau_de_bord_dg();
    WHEN 'regional'     THEN RETURN tableau_de_bord_regional();
    WHEN 'prefectoral'  THEN RETURN tableau_de_bord_prefectoral();
    WHEN 'scientifique' THEN RETURN tableau_de_bord_scientifique();
    WHEN 'praticien'    THEN RETURN tableau_de_bord_praticien();
    ELSE RAISE EXCEPTION 'Tableau de bord : aucun pour ce profil' USING ERRCODE = 'insufficient_privilege';
  END CASE;
END $$;
COMMENT ON FUNCTION tableau_de_bord() IS
  'Indicateurs du tableau de bord du profil connecté, limités à sa zone par les règles RLS (US-090, CdC §6.2 à §6.6).';

-- Les branches ne sont appelées que par le point d'entrée (contexte vérifié)
REVOKE EXECUTE ON FUNCTION tableau_de_bord_dg(), tableau_de_bord_regional(),
  tableau_de_bord_prefectoral(), tableau_de_bord_scientifique(), tableau_de_bord_praticien(),
  tableau_de_bord() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tableau_de_bord_dg(), tableau_de_bord_regional(),
  tableau_de_bord_prefectoral(), tableau_de_bord_scientifique(), tableau_de_bord_praticien(),
  tableau_de_bord() TO sabou_app;
