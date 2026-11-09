-- US-042 : visites d'un dossier. La liste de vérification terrain et chaque validation à
-- l'étape 2 (dossier_transition) cherchent la visite réalisée d'un dossier ; sans index, la
-- table entière est lue (une quinzaine de milliers de visites par an, R-QR-07).
SET search_path = sabou, public;

CREATE INDEX ix_visite_dossier ON visite_terrain (dossier_id, statut);
