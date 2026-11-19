-- US-080 : le Studio mobile fonctionne sans réseau (UC-74, R-DON-04, règle validée le
-- 3 novembre 2026). Les brouillons saisis hors réseau sont rejoués au retour du réseau :
--   - chaque envoi porte une clé tirée sur le téléphone : rejoué après une coupure (réponse
--     perdue), il renvoie le même résultat sans créer un second traitement ;
--   - le conflit se règle sur le traitement entier, jamais champ par champ ;
--   - version du serveur « validée » (tout statut autre que brouillon : soumise ou au-delà) :
--     elle prime ; la saisie du téléphone est gardée en copie rattachée au traitement ;
--   - deux brouillons : le dernier arrivé au serveur l'emporte (jamais l'heure du téléphone) ;
--     la version remplacée est gardée ;
--   - le praticien voit ces versions écartées (détail du traitement) à la synchronisation
--     suivante.
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Versions écartées (R-DON-04, cas 2 et 3)
-- ---------------------------------------------------------------------
CREATE TABLE recette_version_ecartee (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recette_id  bigint NOT NULL REFERENCES recette(id) ON DELETE CASCADE,
  -- version_validee : la saisie du téléphone, arrivée sur un traitement déjà soumis ou au-delà ;
  -- remplacee : la version du serveur, remplacée par un brouillon arrivé après elle
  raison      text   NOT NULL CHECK (raison IN ('version_validee','remplacee')),
  contenu     jsonb  NOT NULL CHECK (pg_column_size(contenu) <= 262144),
  ecartee_le  timestamptz NOT NULL DEFAULT now(),
  ecartee_par bigint NOT NULL REFERENCES utilisateur(id)
);
CREATE INDEX ix_version_ecartee ON recette_version_ecartee (recette_id, ecartee_le DESC);
COMMENT ON TABLE recette_version_ecartee IS
  'Versions non retenues lors de la synchronisation hors réseau du Studio (US-080, R-DON-04).';
ALTER TABLE recette_version_ecartee ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON recette_version_ecartee TO sabou_app
  USING (EXISTS (SELECT 1 FROM recette r WHERE r.id = recette_version_ecartee.recette_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON recette_version_ecartee FROM sabou_app;

-- ---------------------------------------------------------------------
-- 2. Envois déjà reçus (clé du téléphone) : rejeu sans doublon
-- ---------------------------------------------------------------------
CREATE TABLE studio_synchro (
  cle         uuid   PRIMARY KEY,
  utilisateur bigint NOT NULL REFERENCES utilisateur(id),
  resultat    jsonb  NOT NULL,
  recu_le     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_studio_synchro_recu ON studio_synchro (recu_le);
COMMENT ON TABLE studio_synchro IS
  'Envois du Studio hors réseau déjà traités, par clé tirée sur le téléphone (US-080).';
ALTER TABLE studio_synchro ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON studio_synchro FROM sabou_app;

-- Contenu actuel d'un traitement, au format des données du Studio (copie d'une version écartée)
CREATE FUNCTION recette_contenu(p_recette bigint) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'maladie', m.code, 'titreFr', r.titre_fr, 'titreEn', r.titre_en,
    'cycleDureeJours', r.cycle_duree_jours, 'cyclePrisesParJour', r.cycle_prises_par_jour,
    'cyclePauseJours', r.cycle_pause_jours,
    'plantes', COALESCE((SELECT jsonb_agg(jsonb_build_object('plante', pl.code,
                                                             'partie', rp.partie_utilisee)
                                          ORDER BY rp.ordre)
                           FROM recette_plante rp JOIN plante pl ON pl.id = rp.plante_id
                          WHERE rp.recette_id = r.id), '[]'),
    'sections', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', s.type_code,
                                                              'texteFr', s.texte_fr,
                                                              'texteEn', s.texte_en))
                            FROM recette_section s WHERE s.recette_id = r.id), '[]'),
    'consentement', r.consentement_le IS NOT NULL, 'visibilite', r.visibilite)
    FROM recette r JOIN maladie m ON m.id = r.maladie_id WHERE r.id = p_recette
$$;

-- ---------------------------------------------------------------------
-- 3. Enregistrement rejoué depuis le téléphone
-- ---------------------------------------------------------------------
-- Renvoie {"code": "REC-…", "conflit": null | "version_validee" | "remplacee", "rejoue": bool}.
-- Les contre-indications restent posées par l'API dans la même transaction (US-063), sauf
-- quand la version du serveur prime (conflit « version_validee »).
CREATE FUNCTION traitement_synchroniser(p_cle uuid, p_code text, p_vue_le timestamptz,
                                        p_donnees jsonb)
RETURNS jsonb LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_pra      praticien%ROWTYPE;
        v_rec      recette%ROWTYPE;
        v_deja     studio_synchro%ROWTYPE;
        v_code     text;
        v_conflit  text;
        v_resultat jsonb;
BEGIN
  v_pra := studio_praticien();
  -- Ménage : un téléphone ne garde pas un envoi plus de 90 jours
  DELETE FROM studio_synchro WHERE recu_le < now() - interval '90 days';
  SELECT * INTO v_deja FROM studio_synchro WHERE cle = p_cle;
  IF FOUND THEN
    IF v_deja.utilisateur <> contexte_utilisateur() THEN
      RAISE EXCEPTION 'Clé d''envoi déjà utilisée';
    END IF;
    RETURN v_deja.resultat || jsonb_build_object('rejoue', true);
  END IF;
  IF pg_column_size(p_donnees) > 262144 THEN
    RAISE EXCEPTION 'Saisie trop volumineuse';
  END IF;

  IF p_code IS NULL THEN
    v_code := traitement_enregistrer(NULL, NULL, p_donnees);
  ELSE
    SELECT * INTO v_rec FROM recette WHERE code = p_code AND praticien_id = v_pra.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_code; END IF;
    v_code := p_code;
    IF v_rec.statut <> 'brouillon' THEN
      -- Cas 2 : la version du serveur est validée, elle prime
      INSERT INTO recette_version_ecartee (recette_id, raison, contenu, ecartee_par)
      VALUES (v_rec.id, 'version_validee', p_donnees, contexte_utilisateur());
      v_conflit := 'version_validee';
    ELSE
      IF p_vue_le IS NULL
         OR date_trunc('milliseconds', v_rec.updated_at) <> date_trunc('milliseconds', p_vue_le) THEN
        -- Cas 3 : deux brouillons ; celui qui arrive l'emporte, l'autre est gardé
        INSERT INTO recette_version_ecartee (recette_id, raison, contenu, ecartee_par)
        VALUES (v_rec.id, 'remplacee', recette_contenu(v_rec.id), contexte_utilisateur());
        v_conflit := 'remplacee';
      END IF;
      PERFORM traitement_enregistrer(p_code, v_rec.updated_at, p_donnees);
    END IF;
  END IF;

  v_resultat := jsonb_build_object('code', v_code, 'conflit', v_conflit);
  INSERT INTO studio_synchro (cle, utilisateur, resultat)
  VALUES (p_cle, contexte_utilisateur(), v_resultat);
  IF v_conflit IS NOT NULL THEN
    INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
    VALUES (contexte_utilisateur(), 'recette.conflit_synchro', 'recette', v_code,
            jsonb_build_object('conflit', v_conflit));
  END IF;
  RETURN v_resultat || jsonb_build_object('rejoue', false);
END $$;

-- Soumission rejouée : déjà soumis (réponse perdue) = succès, sans nouvelle transition
CREATE FUNCTION traitement_soumettre_synchro(p_code text) RETURNS text LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_pra praticien%ROWTYPE;
        v_statut text;
BEGIN
  v_pra := studio_praticien();
  SELECT statut INTO v_statut FROM recette WHERE code = p_code AND praticien_id = v_pra.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_code; END IF;
  IF v_statut <> 'brouillon' THEN RETURN v_statut; END IF;
  RETURN traitement_soumettre(p_code);
END $$;

-- Versions écartées d'un de ses traitements (affichées au praticien)
CREATE FUNCTION traitement_versions_ecartees(p_code text)
RETURNS TABLE (raison text, ecartee_le timestamptz, titre text)
LANGUAGE plpgsql STABLE
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_pra praticien%ROWTYPE;
BEGIN
  v_pra := studio_praticien();
  RETURN QUERY
  SELECT e.raison, e.ecartee_le, e.contenu->>'titreFr'
    FROM recette_version_ecartee e JOIN recette r ON r.id = e.recette_id
   WHERE r.code = p_code AND r.praticien_id = v_pra.id
   ORDER BY e.ecartee_le DESC LIMIT 20;
END $$;

REVOKE EXECUTE ON FUNCTION
  traitement_synchroniser(uuid, text, timestamptz, jsonb),
  traitement_soumettre_synchro(text),
  traitement_versions_ecartees(text),
  recette_contenu(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  traitement_synchroniser(uuid, text, timestamptz, jsonb),
  traitement_soumettre_synchro(text),
  traitement_versions_ecartees(text) TO sabou_app;
