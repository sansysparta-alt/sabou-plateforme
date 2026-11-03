-- Réception d'un dossier saisi hors réseau et règle de conflit R-DON-04 (US-004).
-- Toute écriture venue d'un téléphone passe par saisie_terrain_recevoir : verrou sur le
-- dossier, agent et zone contrôlés en base, ordre d'arrivée sur le serveur, jamais l'heure
-- du téléphone.
SET search_path = sabou, public;

-- Avis à l'agent dont la version n'a pas été retenue, reçu à la synchronisation suivante
-- (R-DON-04, point 4)
CREATE TABLE saisie_terrain_avis (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saisie_id       uuid NOT NULL REFERENCES saisie_terrain(id) ON DELETE CASCADE,
  destinataire_id bigint NOT NULL REFERENCES utilisateur(id),
  motif           text NOT NULL CHECK (motif IN ('version_validee','version_plus_recente')),
  -- Copie en brouillon qui garde la saisie de l'agent (motif version_validee)
  copie_id        uuid REFERENCES saisie_terrain(id) ON DELETE CASCADE,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_avis_copie CHECK ((motif = 'version_validee') = (copie_id IS NOT NULL))
);
CREATE INDEX ix_saisie_terrain_avis_dest ON saisie_terrain_avis (destinataire_id);
COMMENT ON TABLE saisie_terrain_avis IS 'Avis de conflit pour l''agent dont la version n''a pas été retenue (R-DON-04, point 4).';

-- Résultat : creee, modifiee, identique (envoi répété après une coupure), copie_brouillon
-- (la version du serveur est validée) ou remplacee (deux brouillons, la dernière arrivée l'emporte)
CREATE OR REPLACE FUNCTION saisie_terrain_recevoir(
  p_id uuid, p_type text, p_agent bigint, p_contenu jsonb, p_version_base integer)
RETURNS text LANGUAGE plpgsql
-- Fixé ici : la fonction ne dépend pas du search_path de l'appelant
SET search_path = sabou, public AS $$
DECLARE v_usr   utilisateur%ROWTYPE;
        v_cur   saisie_terrain%ROWTYPE;
        v_copie uuid;
BEGIN
  SELECT * INTO v_usr FROM utilisateur WHERE id = p_agent AND statut = 'actif';
  IF NOT FOUND OR v_usr.role_code <> 'prefectoral' THEN
    RAISE EXCEPTION 'Agent % : saisie de terrain réservée aux agents préfectoraux actifs', p_agent;
  END IF;

  SELECT * INTO v_cur FROM saisie_terrain WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO saisie_terrain (id, type, prefecture_id, auteur_id, contenu)
    VALUES (p_id, p_type, v_usr.prefecture_id, p_agent, p_contenu);
    RETURN 'creee';
  END IF;

  -- Un dossier d'une autre zone n'est ni lu ni modifié, même si son identifiant est connu
  IF v_cur.prefecture_id IS DISTINCT FROM v_usr.prefecture_id THEN
    RAISE EXCEPTION 'Dossier % hors de la zone de l''agent %', p_id, p_agent;
  END IF;
  IF v_cur.type <> p_type THEN
    RAISE EXCEPTION 'Dossier % : type « % » attendu', p_id, v_cur.type;
  END IF;

  -- Même contenu déjà reçu : envoi répété après une coupure, rien à faire
  IF v_cur.contenu = p_contenu THEN
    RETURN 'identique';
  END IF;

  -- 2) Version validée sur le serveur : elle prime, la saisie devient une copie en brouillon
  IF v_cur.statut = 'valide' THEN
    SELECT id INTO v_copie FROM saisie_terrain
     WHERE origine_id = p_id AND auteur_id = p_agent AND contenu = p_contenu;
    IF FOUND THEN RETURN 'identique'; END IF;
    INSERT INTO saisie_terrain (id, type, prefecture_id, auteur_id, contenu, origine_id)
    VALUES (gen_random_uuid(), v_cur.type, v_cur.prefecture_id, p_agent, p_contenu, p_id)
    RETURNING id INTO v_copie;
    INSERT INTO saisie_terrain_avis (saisie_id, destinataire_id, motif, copie_id)
    VALUES (p_id, p_agent, 'version_validee', v_copie);
    RETURN 'copie_brouillon';
  END IF;

  -- 3) Deux brouillons : la dernière arrivée l'emporte, la version remplacée est gardée.
  -- Elle est en conflit si l'agent est parti d'une version plus ancienne que celle du serveur.
  INSERT INTO saisie_terrain_version (saisie_id, version, contenu, auteur_id, recue_le)
  VALUES (p_id, v_cur.version, v_cur.contenu, v_cur.auteur_id, v_cur.recue_le);
  UPDATE saisie_terrain
     SET contenu = p_contenu, auteur_id = p_agent, version = v_cur.version + 1, recue_le = now()
   WHERE id = p_id;
  IF p_version_base IS DISTINCT FROM v_cur.version AND v_cur.auteur_id <> p_agent THEN
    INSERT INTO saisie_terrain_avis (saisie_id, destinataire_id, motif)
    VALUES (p_id, v_cur.auteur_id, 'version_plus_recente');
    RETURN 'remplacee';
  END IF;
  RETURN 'modifiee';
END $$;
COMMENT ON FUNCTION saisie_terrain_recevoir IS 'Seule porte d''entrée des écritures venues des téléphones : règle de conflit R-DON-04.';

ALTER PUBLICATION powersync ADD TABLE saisie_terrain_avis;
GRANT SELECT ON saisie_terrain_avis TO sabou_sync;
