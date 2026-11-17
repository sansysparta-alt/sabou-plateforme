-- US-062 : que la certification d'un traitement soit bloquée s'il est incomplet (UC-62,
-- R-REC-06, R-REC-08, R-REC-11, R-PLA-06).
--   - une seule source des motifs de blocage : recette_blocages(), lue par le trigger de
--     certification et par la file de la DG (motifs affichés avant la décision) ;
--   - messages du trigger inchangés (lus par la publication du dossier, US-046, et les tests) ;
--   - formule gratuite : 3 traitements certifiés au plus ; un GOLD expiré compte encore
--     30 jours (délai de grâce, formule_active du schéma initial).
SET search_path = sabou, public;

-- Motifs qui empêchent de certifier le traitement, dans l'ordre des contrôles ; vide si la
-- certification est possible. p_reprise : retour d'un traitement suspendu, hors quota.
CREATE FUNCTION recette_blocages(p_recette bigint, p_reprise boolean DEFAULT false)
RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN NOT EXISTS (SELECT 1 FROM recette_plante rp WHERE rp.recette_id = r.id)
         THEN 'plante' END,
    CASE WHEN EXISTS (SELECT 1 FROM recette_plante rp JOIN plante pl ON pl.id = rp.plante_id
                       WHERE rp.recette_id = r.id AND pl.statut <> 'validee')
         THEN 'plante_en_revue' END,
    CASE WHEN (SELECT count(*) FROM recette_section s JOIN section_type t ON t.code = s.type_code
                WHERE s.recette_id = r.id AND t.obligatoire)
            < (SELECT count(*) FROM section_type WHERE obligatoire)
         THEN 'sections' END,
    CASE WHEN r.cycle_duree_jours IS NULL OR r.cycle_prises_par_jour IS NULL THEN 'cycle' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM praticien pr JOIN certificat c ON c.praticien_id = pr.id
                           WHERE pr.id = r.praticien_id AND pr.statut = 'certifie'
                             AND c.statut = 'actif' AND c.expire_le >= current_date)
         THEN 'certificat' END,
    CASE WHEN NOT p_reprise
          AND formule_active(r.praticien_id) = 'gratuit'
          AND (SELECT count(*) FROM recette r2
                WHERE r2.praticien_id = r.praticien_id AND r2.statut = 'certifiee'
                  AND r2.id <> r.id) >= 3
         THEN 'quota' END], NULL)
    FROM recette r WHERE r.id = p_recette
$$;
COMMENT ON FUNCTION recette_blocages(bigint, boolean) IS
  'Motifs qui empêchent de certifier un traitement (US-062) : plante, plante_en_revue, sections, cycle, certificat, quota.';

-- Contrôles avant certification, d'après recette_blocages ; premier motif signalé
CREATE OR REPLACE FUNCTION trg_recette_publiable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_blocage text;
BEGIN
  IF NEW.statut = 'certifiee' AND (TG_OP = 'INSERT' OR OLD.statut <> 'certifiee') THEN
    -- Insertion directe à l'état certifié : la ligne n'a encore ni plante ni section
    v_blocage := CASE WHEN TG_OP = 'INSERT' THEN 'plante'
                      ELSE (recette_blocages(NEW.id, OLD.statut = 'suspendue'))[1] END;
    CASE v_blocage
      WHEN 'plante' THEN
        RAISE EXCEPTION 'Traitement % : au moins une plante est requise', NEW.code;
      WHEN 'plante_en_revue' THEN
        RAISE EXCEPTION 'Traitement % : toutes les plantes doivent être validées par le Comité', NEW.code;
      WHEN 'sections' THEN
        RAISE EXCEPTION 'Traitement % : sections obligatoires manquantes (effets indésirables inclus)', NEW.code;
      WHEN 'cycle' THEN
        RAISE EXCEPTION 'Traitement % : cycle (durée et prises par jour) requis', NEW.code;
      WHEN 'certificat' THEN
        RAISE EXCEPTION 'Traitement % : le praticien doit être certifié avec un certificat actif', NEW.code;
      WHEN 'quota' THEN
        RAISE EXCEPTION 'Traitement % : la formule gratuite est limitée à 3 traitements certifiés', NEW.code;
      ELSE NULL;
    END CASE;
    NEW.publiee_le := COALESCE(NEW.publiee_le, now());
  END IF;
  RETURN NEW;
END $$;
