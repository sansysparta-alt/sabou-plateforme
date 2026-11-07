-- Fiche du praticien certifié ou suspendu figée (US-040a, relecture, 05 §2.26) : la fiche
-- publiée dans l'annuaire (préfecture, spécialité, langue) ne change plus sans examen.
SET search_path = sabou, public;

CREATE OR REPLACE FUNCTION trg_praticien_par_praticien() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF contexte_role() IS DISTINCT FROM 'praticien' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.statut <> 'en_attente' OR NEW.note_moyenne IS NOT NULL OR NEW.nb_avis <> 0 OR NEW.nb_vues <> 0 THEN
      RAISE EXCEPTION 'Une nouvelle fiche de praticien est « en attente », sans note ni vue'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF (NEW.code, NEW.utilisateur_id, NEW.statut, NEW.note_moyenne, NEW.nb_avis, NEW.nb_vues)
        IS DISTINCT FROM
        (OLD.code, OLD.utilisateur_id, OLD.statut, OLD.note_moyenne, OLD.nb_avis, OLD.nb_vues) THEN
    RAISE EXCEPTION 'Le praticien ne modifie pas le code, le statut, les notes ni les vues de sa fiche'
      USING ERRCODE = 'insufficient_privilege';
  -- Une fois le dossier soumis, la fiche est figée : changer de préfecture ferait sortir le
  -- dossier de la zone de l'administrateur qui l'examine (R-CER-02). Certifié ou suspendu :
  -- la fiche publiée ne change plus sans examen (renouvellement, administration)
  ELSIF OLD.statut IN ('certifie','suspendu') OR EXISTS (
          SELECT 1 FROM dossier_certification d
           WHERE d.praticien_id = OLD.id AND d.statut = 'en_cours' AND d.etape_courante > 1) THEN
    RAISE EXCEPTION 'Fiche non modifiable pendant l''examen du dossier'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
