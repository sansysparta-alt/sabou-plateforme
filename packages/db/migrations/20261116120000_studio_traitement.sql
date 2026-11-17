-- US-060 : créer un traitement depuis le Studio web (UC-21, R-REC-01 à 04, R-REC-08, R-REC-10).
--   - listes de référence (sections, contre-indications) posées par migration : jusqu'ici,
--     seul le jeu d'exemple les remplissait ;
--   - traitements cloisonnés : praticien = les siens ; administrateurs = leur zone ; tout le
--     monde = les traitements certifiés publics (restreints : comptes connectés, R-REC-10) ;
--   - le praticien n'écrit ses traitements que par traitement_enregistrer et
--     traitement_soumettre (SECURITY DEFINER), et seulement à l'état « brouillon » ;
--   - soumission refusée sans consentement, maladie, plante, cycle (durée, prises) et les
--     4 sections obligatoires (trigger : vrai aussi pour la numérisation par le préfectoral) ;
--   - praticien pas encore certifié : le traitement est joint à son dossier en cours et sera
--     certifié à la publication du dossier (décision du maître d'œuvre du 16 novembre 2026).
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- 1. Listes de référence (R-REC-02, R-REC-05)
-- ---------------------------------------------------------------------
INSERT INTO section_type (code, ordre, obligatoire, libelle_fr, libelle_en) VALUES
 ('preparation',         1, true,  'Mode de préparation',                       'Preparation'),
 ('consommation',        2, true,  'Modes de consommation',                     'How to take it'),
 ('cycle',               3, true,  'Cycle de traitement',                       'Treatment cycle'),
 ('effets_indesirables', 4, true,  'Effets indésirables et contre-indications', 'Side effects and contraindications'),
 ('conservation',        5, false, 'Conservation',                              'Storage')
ON CONFLICT (code) DO NOTHING;

INSERT INTO contre_indication (code, libelle_fr, libelle_en) VALUES
 ('grossesse',          'Grossesse',                'Pregnancy'),
 ('allaitement',        'Allaitement',              'Breastfeeding'),
 ('enfant_moins_5_ans', 'Enfant de moins de 5 ans', 'Child under 5'),
 ('personne_agee',      'Personne âgée',            'Elderly person'),
 ('maladie_chronique',  'Maladie chronique',        'Chronic disease')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Colonnes et contrôles du traitement
-- ---------------------------------------------------------------------
ALTER TABLE recette
  ADD COLUMN consentement_le timestamptz,
  ADD CONSTRAINT ck_recette_titre_fr CHECK (btrim(titre_fr) <> '' AND char_length(titre_fr) <= 150),
  ADD CONSTRAINT ck_recette_titre_en
    CHECK (titre_en IS NULL OR (btrim(titre_en) <> '' AND char_length(titre_en) <= 150)),
  ADD CONSTRAINT ck_recette_cycle_bornes
    CHECK (cycle_duree_jours <= 365 AND cycle_prises_par_jour <= 10 AND cycle_pause_jours <= 365);
COMMENT ON COLUMN recette.consentement_le IS
  'Consentement du praticien (enregistrement et niveau de visibilité), exigé avant la soumission (US-060).';

ALTER TABLE recette_plante
  ADD CONSTRAINT ck_recette_plante_partie
    CHECK (partie_utilisee IS NULL OR (btrim(partie_utilisee) <> '' AND char_length(partie_utilisee) <= 100));
ALTER TABLE recette_section
  ADD CONSTRAINT ck_recette_section_longueur
    CHECK (char_length(texte_fr) <= 4000 AND (texte_en IS NULL OR (btrim(texte_en) <> '' AND char_length(texte_en) <= 4000)));

CREATE SEQUENCE recette_code_seq;

-- ---------------------------------------------------------------------
-- 3. Cloisonnement (R-ACC-02, R-REC-10)
-- ---------------------------------------------------------------------
-- Visible si son praticien l'est (règle de praticien : sa zone, ou sa propre fiche), ou
-- certifié et public, ou certifié et restreint pour un compte connecté
ALTER TABLE recette ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON recette TO sabou_app
  USING (EXISTS (SELECT 1 FROM praticien p WHERE p.id = recette.praticien_id)
         OR (statut = 'certifiee'
             AND (visibilite = 'publique' OR (visibilite = 'restreinte' AND contexte_utilisateur() IS NOT NULL))))
  WITH CHECK (EXISTS (SELECT 1 FROM praticien p WHERE p.id = recette.praticien_id));

ALTER TABLE recette_plante ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON recette_plante TO sabou_app
  USING (EXISTS (SELECT 1 FROM recette r WHERE r.id = recette_plante.recette_id));
ALTER TABLE recette_section ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON recette_section TO sabou_app
  USING (EXISTS (SELECT 1 FROM recette r WHERE r.id = recette_section.recette_id));
ALTER TABLE recette_contre_indication ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON recette_contre_indication TO sabou_app
  USING (EXISTS (SELECT 1 FROM recette r WHERE r.id = recette_contre_indication.recette_id));
ALTER TABLE recette_historique ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone ON recette_historique TO sabou_app
  USING (EXISTS (SELECT 1 FROM recette r WHERE r.id = recette_historique.recette_id))
  WITH CHECK (EXISTS (SELECT 1 FROM recette r WHERE r.id = recette_historique.recette_id));

-- Contenu d'un traitement : écrit par les seules fonctions du Studio. L'API garde la mise
-- à jour du statut (recette_transition, dans le contexte de l'acteur) et l'historique.
REVOKE INSERT, DELETE, TRUNCATE ON recette FROM sabou_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON recette_plante, recette_section, recette_contre_indication
  FROM sabou_app;

-- Un praticien ne modifie pas son traitement directement (statut, visibilité, notes…) :
-- seulement par les fonctions du Studio, qui s'exécutent avec les droits du propriétaire.
-- Seule exception : le retrait d'un traitement certifié ou suspendu (recette_transition,
-- R-REC-07, R-REC-12), où seul le statut change.
CREATE FUNCTION trg_recette_par_praticien() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF contexte_role() = 'praticien' AND current_user = 'sabou_app'
     AND NOT (OLD.statut IN ('certifiee','suspendue') AND NEW.statut = 'retiree'
              AND (to_jsonb(OLD) - 'statut' - 'updated_at') = (to_jsonb(NEW) - 'statut' - 'updated_at')) THEN
    RAISE EXCEPTION 'Un praticien modifie ses traitements par le Studio' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_recette_par_praticien BEFORE UPDATE ON recette
  FOR EACH ROW EXECUTE FUNCTION trg_recette_par_praticien();

-- ---------------------------------------------------------------------
-- 4. Soumission complète (UC-21, R-REC-01 à 04)
-- ---------------------------------------------------------------------
-- Liste des manques, vide si le traitement peut être soumis
CREATE FUNCTION recette_manques(p_recette bigint) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN r.consentement_le IS NULL THEN 'consentement' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM recette_plante rp WHERE rp.recette_id = r.id) THEN 'plante' END,
    CASE WHEN r.cycle_duree_jours IS NULL OR r.cycle_prises_par_jour IS NULL THEN 'cycle' END,
    CASE WHEN EXISTS (SELECT 1 FROM section_type t WHERE t.obligatoire
                        AND NOT EXISTS (SELECT 1 FROM recette_section s
                                         WHERE s.recette_id = r.id AND s.type_code = t.code))
         THEN 'sections' END], NULL)
    FROM recette r WHERE r.id = p_recette
$$;

CREATE FUNCTION trg_recette_soumission_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_manques text[];
BEGIN
  IF OLD.statut = 'brouillon' AND NEW.statut = 'soumise' THEN
    v_manques := recette_manques(NEW.id);
    IF cardinality(v_manques) > 0 THEN
      RAISE EXCEPTION 'Traitement % incomplet : %', NEW.code, array_to_string(v_manques, ', ');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_recette_soumission_complete BEFORE UPDATE OF statut ON recette
  FOR EACH ROW EXECUTE FUNCTION trg_recette_soumission_complete();

-- ---------------------------------------------------------------------
-- 5. Fonctions du Studio (praticien connecté, toujours ses propres traitements)
-- ---------------------------------------------------------------------
CREATE FUNCTION studio_praticien() RETURNS praticien LANGUAGE plpgsql STABLE AS $$
DECLARE v_pra praticien%ROWTYPE;
BEGIN
  IF contexte_role() IS DISTINCT FROM 'praticien' THEN
    RAISE EXCEPTION 'Le Studio est réservé aux praticiens' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_pra FROM praticien WHERE utilisateur_id = contexte_utilisateur();
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche de praticien à créer avant le Studio'; END IF;
  RETURN v_pra;
END $$;
REVOKE EXECUTE ON FUNCTION studio_praticien() FROM PUBLIC;

-- Crée (p_code NULL) ou modifie un brouillon. p_donnees :
--   {"maladie":"MA-001","titreFr":"…","titreEn":null,"cycleDureeJours":7,"cyclePrisesParJour":2,
--    "cyclePauseJours":null,"plantes":[{"plante":"PL-001","partie":"écorce"}],
--    "sections":[{"type":"preparation","texteFr":"…","texteEn":null}],
--    "consentement":true,"visibilite":"publique"}
-- Plantes : l'ordre de la liste ; sections absentes ou vides : non enregistrées (brouillon).
CREATE FUNCTION traitement_enregistrer(p_code text, p_vue_le timestamptz, p_donnees jsonb)
RETURNS text LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_pra      praticien%ROWTYPE;
        v_rec      recette%ROWTYPE;
        v_maladie  bigint;
        v_code     text;
        v_consent  boolean := COALESCE((p_donnees->>'consentement')::boolean, false);
        v_visib    text := nullif(p_donnees->>'visibilite', '');
        v_plantes  jsonb := COALESCE(p_donnees->'plantes', '[]'::jsonb);
        v_sections jsonb := COALESCE(p_donnees->'sections', '[]'::jsonb);
        v_inconnue text;
BEGIN
  v_pra := studio_praticien();
  SELECT id INTO v_maladie FROM maladie WHERE code = p_donnees->>'maladie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Maladie % introuvable', p_donnees->>'maladie'; END IF;
  IF jsonb_typeof(v_plantes) <> 'array' OR jsonb_array_length(v_plantes) > 15 THEN
    RAISE EXCEPTION 'Plantes : une liste de 15 au plus';
  END IF;
  IF jsonb_typeof(v_sections) <> 'array' THEN RAISE EXCEPTION 'Sections : une liste'; END IF;
  SELECT x->>'plante' INTO v_inconnue FROM jsonb_array_elements(v_plantes) x
   WHERE NOT EXISTS (SELECT 1 FROM plante pl WHERE pl.code = x->>'plante') LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Plante % introuvable', v_inconnue; END IF;
  IF (SELECT count(DISTINCT x->>'plante') FROM jsonb_array_elements(v_plantes) x)
     <> jsonb_array_length(v_plantes) THEN
    RAISE EXCEPTION 'Une plante figure deux fois dans le traitement';
  END IF;
  SELECT x->>'type' INTO v_inconnue FROM jsonb_array_elements(v_sections) x
   WHERE NOT EXISTS (SELECT 1 FROM section_type t WHERE t.code = x->>'type') LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Section % inconnue', v_inconnue; END IF;
  IF v_consent AND (v_visib IS NULL OR v_visib NOT IN ('publique','restreinte','privee')) THEN
    RAISE EXCEPTION 'Niveau de visibilité à choisir avec le consentement';
  END IF;

  IF p_code IS NULL THEN
    LOOP
      v_code := 'REC-' || lpad(nextval('recette_code_seq')::text, 4, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM recette WHERE code = v_code);
    END LOOP;
    INSERT INTO recette (code, praticien_id, maladie_id, titre_fr, visibilite)
    VALUES (v_code, v_pra.id, v_maladie, btrim(p_donnees->>'titreFr'), COALESCE(v_visib, 'privee'))
    RETURNING * INTO v_rec;
  ELSE
    SELECT * INTO v_rec FROM recette WHERE code = p_code AND praticien_id = v_pra.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_code; END IF;
    IF v_rec.statut <> 'brouillon' THEN
      RAISE EXCEPTION 'Traitement % : seul un brouillon se modifie', p_code;
    END IF;
    IF p_vue_le IS NULL OR date_trunc('milliseconds', v_rec.updated_at) <> date_trunc('milliseconds', p_vue_le) THEN
      RAISE EXCEPTION 'Traitement % modifié entre-temps', p_code;
    END IF;
  END IF;

  UPDATE recette SET
      maladie_id            = v_maladie,
      titre_fr              = btrim(p_donnees->>'titreFr'),
      titre_en              = nullif(btrim(p_donnees->>'titreEn'), ''),
      cycle_duree_jours     = (p_donnees->>'cycleDureeJours')::smallint,
      cycle_prises_par_jour = (p_donnees->>'cyclePrisesParJour')::smallint,
      cycle_pause_jours     = (p_donnees->>'cyclePauseJours')::smallint,
      visibilite            = COALESCE(v_visib, visibilite),
      consentement_le       = CASE WHEN v_consent THEN COALESCE(consentement_le, now()) END
   WHERE id = v_rec.id;

  DELETE FROM recette_plante WHERE recette_id = v_rec.id;
  INSERT INTO recette_plante (recette_id, plante_id, ordre, partie_utilisee)
  SELECT v_rec.id, pl.id, x.n, nullif(btrim(x.e->>'partie'), '')
    FROM jsonb_array_elements(v_plantes) WITH ORDINALITY AS x(e, n)
    JOIN plante pl ON pl.code = x.e->>'plante';

  DELETE FROM recette_section WHERE recette_id = v_rec.id;
  INSERT INTO recette_section (recette_id, type_code, texte_fr, texte_en)
  SELECT DISTINCT ON (x->>'type') v_rec.id, x->>'type', btrim(x->>'texteFr'), nullif(btrim(x->>'texteEn'), '')
    FROM jsonb_array_elements(v_sections) x
   WHERE btrim(COALESCE(x->>'texteFr', '')) <> '';

  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (contexte_utilisateur(), CASE WHEN p_code IS NULL THEN 'recette.creee' ELSE 'recette.modifiee' END,
          'recette', v_rec.code,
          jsonb_build_object('plantes', jsonb_array_length(v_plantes), 'consentement', v_consent));
  RETURN v_rec.code;
END $$;

-- Soumission (UC-21 étape 5, R-REC-07) ; praticien pas encore certifié : traitement joint à
-- son dossier en cours (R-REC-08), certifié à la publication du dossier
CREATE FUNCTION traitement_soumettre(p_code text) RETURNS text LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = sabou, public, pg_temp AS $$
DECLARE v_pra     praticien%ROWTYPE;
        v_rec     recette%ROWTYPE;
        v_dossier bigint;
BEGIN
  v_pra := studio_praticien();
  SELECT * INTO v_rec FROM recette WHERE code = p_code AND praticien_id = v_pra.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_code; END IF;
  IF v_pra.statut <> 'certifie' THEN
    SELECT id INTO v_dossier FROM dossier_certification
     WHERE praticien_id = v_pra.id AND statut = 'en_cours' ORDER BY ouvert_le DESC LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Traitement % : dossier de certification à ouvrir avant la soumission', p_code;
    END IF;
    UPDATE recette SET dossier_id = v_dossier WHERE id = v_rec.id;
  END IF;
  RETURN recette_transition(v_rec.id, 'soumise', contexte_utilisateur());
END $$;

REVOKE EXECUTE ON FUNCTION traitement_enregistrer(text, timestamptz, jsonb),
  traitement_soumettre(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION traitement_enregistrer(text, timestamptz, jsonb),
  traitement_soumettre(text) TO sabou_app;
