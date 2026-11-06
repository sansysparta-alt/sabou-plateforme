-- Cloisonnement par zone (lot B : US-011, R-ACC-02, 05_Choix_Techniques.md §2.23).
--   - L'API ouvre, dans chaque transaction, le contexte du compte connecté
--     (contexte_ouvrir) : rôle et zone sont lus ici, en base, jamais dans la requête.
--   - Sans contexte, les tables cloisonnées ne renvoient aucune ligne au rôle de l'API.
--   - Tables cloisonnées dans ce lot : praticien, dossier_certification et ses tables
--     filles, saisie_terrain, ses versions et ses avis. Les autres tables qui portent une zone
--     sont listées, avec leur récit, dans test/zones.test.ts : le pipeline échoue si une
--     nouvelle table à zone arrive sans cloisonnement.
--   - Le propriétaire des tables (sabou_migrator) n'est pas soumis au RLS : les fonctions
--     SECURITY DEFINER ci-dessous contrôlent elles-mêmes l'acteur et sa zone.
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Contexte de la transaction
-- ---------------------------------------------------------------------
-- Portée locale (set_config(..., true)) : le contexte disparaît à la fin de la transaction
-- et ne passe jamais d'une requête à l'autre par le pool de connexions.
CREATE FUNCTION contexte_ouvrir(p_keycloak_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
-- pg_temp en dernier : une table temporaire de l'appelant ne masque pas celles du schéma
SET search_path = sabou, pg_catalog, pg_temp AS $$
DECLARE v_usr utilisateur%ROWTYPE;
BEGIN
  SELECT * INTO v_usr FROM utilisateur WHERE keycloak_id = p_keycloak_id AND statut = 'actif';
  IF NOT FOUND THEN
    -- Même réponse pour un compte inconnu ou suspendu : rien n'est révélé
    RAISE EXCEPTION 'Aucun compte actif pour ce contexte' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('sabou.role', v_usr.role_code, true),
          set_config('sabou.utilisateur_id', v_usr.id::text, true),
          set_config('sabou.prefecture_id', coalesce(v_usr.prefecture_id::text, ''), true),
          set_config('sabou.region_id', coalesce(v_usr.region_admin_id::text, ''), true);
  RETURN v_usr.role_code;
END $$;
REVOKE EXECUTE ON FUNCTION contexte_ouvrir(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contexte_ouvrir(uuid) TO sabou_app;
COMMENT ON FUNCTION contexte_ouvrir(uuid) IS
  'Ouvre le contexte de zone du compte actif (claim « sub » de Keycloak) pour la transaction en cours (US-011).';

-- Lecture du contexte (STABLE, sans SET : les deux premières sont insérées dans la
-- requête par PostgreSQL). Contexte absent : NULL, donc aucune ligne visible.
CREATE FUNCTION contexte_role() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('sabou.role', true), '') $$;

CREATE FUNCTION contexte_utilisateur() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('sabou.utilisateur_id', true), '')::bigint $$;

-- Préfecture visible depuis le contexte : nationale pour la DG et le Comité, une
-- préfecture pour l'admin préfectoral, les préfectures de sa région pour l'admin régional
CREATE FUNCTION zone_visible(p_prefecture smallint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE nullif(current_setting('sabou.role', true), '')
    WHEN 'dg'           THEN true
    WHEN 'scientifique' THEN true
    WHEN 'prefectoral'  THEN p_prefecture = nullif(current_setting('sabou.prefecture_id', true), '')::smallint
    WHEN 'regional'     THEN EXISTS (
      SELECT 1 FROM sabou.prefecture pf
       WHERE pf.id = p_prefecture
         AND pf.region_admin_id = nullif(current_setting('sabou.region_id', true), '')::smallint)
    ELSE false
  END
$$;

-- ---------------------------------------------------------------------
-- 2. Règles de cloisonnement (USING pour la lecture, WITH CHECK pour l'écriture)
-- ---------------------------------------------------------------------
-- Praticien : sa zone pour les administrateurs ; sa seule fiche pour le praticien
ALTER TABLE praticien ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON praticien TO sabou_app
  USING (zone_visible(prefecture_id)
         OR (contexte_role() = 'praticien' AND utilisateur_id = contexte_utilisateur()))
  WITH CHECK (zone_visible(prefecture_id)
         OR (contexte_role() = 'praticien' AND utilisateur_id = contexte_utilisateur()));

-- Dossier : visible si son praticien l'est (la règle de praticien s'applique dans la sous-requête)
ALTER TABLE dossier_certification ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON dossier_certification TO sabou_app
  USING (EXISTS (SELECT 1 FROM praticien p WHERE p.id = dossier_certification.praticien_id))
  WITH CHECK (EXISTS (SELECT 1 FROM praticien p WHERE p.id = dossier_certification.praticien_id));

-- Pièces, visites et historique : visibles si leur dossier l'est
ALTER TABLE dossier_piece ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON dossier_piece TO sabou_app
  USING (EXISTS (SELECT 1 FROM dossier_certification d WHERE d.id = dossier_piece.dossier_id))
  WITH CHECK (EXISTS (SELECT 1 FROM dossier_certification d WHERE d.id = dossier_piece.dossier_id));

ALTER TABLE visite_terrain ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON visite_terrain TO sabou_app
  USING (EXISTS (SELECT 1 FROM dossier_certification d WHERE d.id = visite_terrain.dossier_id))
  WITH CHECK (EXISTS (SELECT 1 FROM dossier_certification d WHERE d.id = visite_terrain.dossier_id));

ALTER TABLE dossier_historique ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON dossier_historique TO sabou_app
  USING (EXISTS (SELECT 1 FROM dossier_certification d WHERE d.id = dossier_historique.dossier_id))
  WITH CHECK (EXISTS (SELECT 1 FROM dossier_certification d WHERE d.id = dossier_historique.dossier_id));

-- Saisies de terrain : leur préfecture. PowerSync (sabou_sync) lit toute la table et
-- filtre par ses propres règles (packages/db/sync/sync-rules.yaml, §2.21) : sans cette
-- règle de lecture, sa copie initiale serait vide.
ALTER TABLE saisie_terrain ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON saisie_terrain TO sabou_app
  USING (zone_visible(prefecture_id)) WITH CHECK (zone_visible(prefecture_id));
CREATE POLICY synchronisation ON saisie_terrain FOR SELECT TO sabou_sync USING (true);

ALTER TABLE saisie_terrain_version ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON saisie_terrain_version TO sabou_app
  USING (EXISTS (SELECT 1 FROM saisie_terrain s WHERE s.id = saisie_terrain_version.saisie_id))
  WITH CHECK (EXISTS (SELECT 1 FROM saisie_terrain s WHERE s.id = saisie_terrain_version.saisie_id));

-- Avis de conflit (R-DON-04) : à leur seul destinataire ; PowerSync les lit tous
ALTER TABLE saisie_terrain_avis ENABLE ROW LEVEL SECURITY;
CREATE POLICY destinataire ON saisie_terrain_avis TO sabou_app
  USING (destinataire_id = contexte_utilisateur())
  WITH CHECK (destinataire_id = contexte_utilisateur());
CREATE POLICY synchronisation ON saisie_terrain_avis FOR SELECT TO sabou_sync USING (true);

-- ---------------------------------------------------------------------
-- 3. Traitements internes qui dépassent une zone (SECURITY DEFINER, étroits)
-- ---------------------------------------------------------------------
-- Les fonctions de workflow (dossier_transition, recette_transition) restent soumises au
-- RLS : elles s'exécutent dans le contexte de l'acteur connecté, en plus de leurs propres
-- contrôles d'habilitation.

-- Réception de la synchronisation : appelée avec l'agent tiré du jeton signé ; elle
-- vérifie elle-même son rôle et sa zone (§2.21)
ALTER FUNCTION saisie_terrain_recevoir(uuid, text, bigint, jsonb, integer)
  SECURITY DEFINER SET search_path = sabou, public, pg_temp;
REVOKE EXECUTE ON FUNCTION saisie_terrain_recevoir(uuid, text, bigint, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION saisie_terrain_recevoir(uuid, text, bigint, jsonb, integer) TO sabou_app;

-- Notes moyennes recalculées après un témoignage : le citoyen ne voit pas la fiche du
-- praticien, la mise à jour ne doit pas être ignorée en silence
ALTER FUNCTION trg_temoignage_notes() SECURITY DEFINER SET search_path = sabou, pg_catalog, pg_temp;
REVOKE EXECUTE ON FUNCTION trg_temoignage_notes() FROM PUBLIC;

-- Vérification publique d'un certificat (QR, R-QR-05) : ne renvoie que les données
-- imprimées sur le certificat
ALTER FUNCTION verifier_certificat(text) SECURITY DEFINER SET search_path = sabou, pg_catalog, pg_temp;

-- ---------------------------------------------------------------------
-- 4. Vues
-- ---------------------------------------------------------------------
-- Une vue s'exécute par défaut avec les droits de son propriétaire, donc sans RLS.
-- Vue interne : droits de l'appelant. Vues publiques (v_annuaire_public,
-- v_temoignage_public) : inchangées, elles ne montrent que des données publiées.
ALTER VIEW v_dossiers_bloques SET (security_invoker = true);
