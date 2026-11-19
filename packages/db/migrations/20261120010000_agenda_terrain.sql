-- US-083 : agenda des visites de l'agent préfectoral et compte rendu signé depuis le téléphone
-- (UC-30). Décisions du maître d'œuvre du 19 novembre 2026 (05 §2.87) :
-- - le compte rendu est rédigé et attesté sans réseau ; l'empreinte SHA3-256 reste calculée
--   par l'API à la réception ; deux heures sont gardées : l'heure d'attestation déclarée par
--   le téléphone (atteste_le_declare) et l'heure de réception par le serveur (signe_le) ;
-- - itinéraire sans carte intégrée : liste ordonnée par jour puis par localité.
-- La photo de la fiche signée reste la pièce « compte_rendu_visite » du dossier (US-041).

-- ---------------------------------------------------------------------
-- 1. Heure d'attestation déclarée par le téléphone
-- ---------------------------------------------------------------------
-- Déclarative (horloge du téléphone) : elle n'est jamais l'heure qui fait foi, qui reste
-- signe_le. Gardée seulement si elle précède l'arrivée au serveur (dix minutes d'écart
-- d'horloge tolérées) ; figée avec le reste du compte rendu (trg_visite_figee).
ALTER TABLE visite_terrain
  ADD COLUMN atteste_le_declare timestamptz,
  ADD CONSTRAINT ck_visite_atteste_declare CHECK (
    atteste_le_declare IS NULL
    OR (signe_le IS NOT NULL AND atteste_le_declare <= signe_le + interval '10 minutes'));

COMMENT ON COLUMN visite_terrain.atteste_le_declare IS
  'Heure d''attestation déclarée par le téléphone (compte rendu rédigé sans réseau) ; signe_le, heure de réception par le serveur, fait foi.';

-- Même fonction, avec l'heure déclarée en plus (facultative : la gestion ne la passe pas).
-- Les droits d'exécution sont ceux de la fonction d'origine (aucun droit particulier).
DROP FUNCTION visite_realiser(bigint, bigint, bigint, date, text, text, text);
CREATE FUNCTION visite_realiser(p_dossier bigint, p_acteur bigint, p_visite bigint,
                                p_realisee_le date, p_constats text, p_avis text,
                                p_empreinte text, p_atteste_le timestamptz DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_dos dossier_certification%ROWTYPE;
        v_aujourdhui date := (now() AT TIME ZONE 'Africa/Conakry')::date;
BEGIN
  v_dos := visite_controler(p_dossier, p_acteur);
  PERFORM 1 FROM visite_terrain
   WHERE id = p_visite AND dossier_id = v_dos.id AND statut = 'planifiee' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dossier % : aucune visite planifiée à enregistrer', v_dos.code;
  END IF;
  IF p_realisee_le IS NULL OR p_realisee_le > v_aujourdhui
     OR p_realisee_le < (v_dos.etape_entree_le AT TIME ZONE 'Africa/Conakry')::date THEN
    RAISE EXCEPTION 'Dossier % : date de visite entre la soumission et aujourd''hui', v_dos.code;
  END IF;
  IF p_atteste_le IS NOT NULL AND p_atteste_le > now() + interval '10 minutes' THEN
    RAISE EXCEPTION 'Dossier % : heure d''attestation postérieure à la réception', v_dos.code;
  END IF;

  UPDATE visite_terrain
     SET statut = 'realisee',
         realisee_le = p_realisee_le::timestamp AT TIME ZONE 'Africa/Conakry',
         constats = p_constats, avis = p_avis, empreinte_sha3 = p_empreinte,
         signe_par = p_acteur, signe_le = now(), atteste_le_declare = p_atteste_le
   WHERE id = p_visite;

  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'visite.realisee', 'dossier', v_dos.code,
          jsonb_build_object('visite', p_visite, 'realisee_le', p_realisee_le, 'avis', p_avis,
                             'empreinte_sha3', p_empreinte)
          || CASE WHEN p_atteste_le IS NULL THEN '{}'::jsonb
                  ELSE jsonb_build_object('atteste_le_declare', p_atteste_le) END);
  RETURN p_visite;
END $$;

-- ---------------------------------------------------------------------
-- 2. Agenda de l'agent préfectoral
-- ---------------------------------------------------------------------
-- Visites planifiées des dossiers de sa préfecture, ordonnées par jour (heure de Conakry),
-- puis par localité, puis par heure : l'ordre de la tournée. Puis les dossiers à l'étape 2
-- encore sans visite, les plus anciens d'abord. La localité seule sert à l'itinéraire
-- (jamais le nom du praticien dans l'application de cartes). Réservé au préfectoral actif ;
-- le RLS de zone s'applique en plus (fonction du rôle appelant).
CREATE FUNCTION visites_agenda()
RETURNS TABLE (categorie text, dossier text, visite integer, praticien text,
               sous_prefecture text, prefecture text, prevue_le text, entree_le text)
LANGUAGE sql STABLE AS $$
  WITH agent AS (
    SELECT a.prefecture_id FROM utilisateur a
     WHERE a.id = contexte_utilisateur() AND a.statut = 'actif'
       AND contexte_role() = 'prefectoral'
  ), dossiers AS (
    SELECT d.id, d.code, d.etape_entree_le, btrim(concat_ws(' ', u.prenom, u.nom)) AS nom,
           sp.nom AS sous_prefecture, pf.nom AS prefecture
      FROM dossier_certification d
      JOIN praticien p ON p.id = d.praticien_id
      JOIN utilisateur u ON u.id = p.utilisateur_id
      JOIN prefecture pf ON pf.id = p.prefecture_id
      LEFT JOIN sous_prefecture sp ON sp.id = p.sous_prefecture_id
      JOIN agent ON agent.prefecture_id = p.prefecture_id
     WHERE d.statut = 'en_cours' AND d.etape_courante = 2
  )
  SELECT categorie, dossier, visite, praticien, sous_prefecture, prefecture, prevue_le, entree_le
    FROM (
      SELECT 'planifiee' AS categorie, d.code AS dossier, vt.id::int AS visite,
             d.nom AS praticien, d.sous_prefecture, d.prefecture,
             to_char(vt.prevue_le AT TIME ZONE 'Africa/Conakry', 'YYYY-MM-DD"T"HH24:MI') AS prevue_le,
             to_char(d.etape_entree_le AT TIME ZONE 'Africa/Conakry', 'YYYY-MM-DD') AS entree_le,
             1 AS groupe, (vt.prevue_le AT TIME ZONE 'Africa/Conakry')::date AS jour,
             vt.prevue_le AS quand
        FROM dossiers d JOIN visite_terrain vt ON vt.dossier_id = d.id AND vt.statut = 'planifiee'
      UNION ALL
      SELECT 'a_planifier', d.code, NULL, d.nom, d.sous_prefecture, d.prefecture, NULL,
             to_char(d.etape_entree_le AT TIME ZONE 'Africa/Conakry', 'YYYY-MM-DD'),
             2, NULL, d.etape_entree_le
        FROM dossiers d
       WHERE NOT EXISTS (SELECT 1 FROM visite_terrain vt
                          WHERE vt.dossier_id = d.id AND vt.statut IN ('planifiee', 'realisee'))
    ) a
   ORDER BY groupe, jour, coalesce(sous_prefecture, prefecture), quand, dossier
$$;
REVOKE EXECUTE ON FUNCTION visites_agenda() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION visites_agenda() TO sabou_app;
