-- Saisie hors réseau des agents de terrain, synchronisée par PowerSync (US-004, R-DON-04).
-- Le téléphone enregistre le dossier entier comme un seul document : le conflit se règle au
-- niveau du dossier, jamais champ par champ (R-DON-04, point 1). L'identifiant est un UUID
-- tiré sur le téléphone, pour créer un dossier sans réseau. Les tables métier (recette,
-- visite_terrain…) ne sont alimentées qu'à la soumission, côté serveur, sous leurs contraintes.
SET search_path = sabou, public;

CREATE TABLE saisie_terrain (
  id             uuid PRIMARY KEY,
  type           text NOT NULL CHECK (type IN ('dossier','recette','visite')),
  prefecture_id  smallint NOT NULL REFERENCES prefecture(id),
  auteur_id      bigint NOT NULL REFERENCES utilisateur(id),
  -- Objet JSON, 256 Kio au plus : les pièces et la voix passent à part (US-009)
  contenu        jsonb NOT NULL CHECK (jsonb_typeof(contenu) = 'object' AND octet_length(contenu::text) <= 262144),
  statut         text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','valide')),
  -- Numéro d'arrivée sur le serveur : +1 à chaque écriture retenue, jamais l'heure du téléphone
  version        integer NOT NULL DEFAULT 1 CHECK (version > 0),
  -- Copie en brouillon née d'un conflit avec une version validée (R-DON-04, point 2)
  origine_id     uuid REFERENCES saisie_terrain(id) ON DELETE CASCADE,
  recue_le       timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_copie_brouillon CHECK (origine_id IS NULL OR statut = 'brouillon')
);
CREATE INDEX ix_saisie_terrain_zone ON saisie_terrain (prefecture_id);
CREATE INDEX ix_saisie_terrain_origine ON saisie_terrain (origine_id) WHERE origine_id IS NOT NULL;
CREATE TRIGGER trg_saisie_terrain_upd BEFORE UPDATE ON saisie_terrain FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE saisie_terrain IS 'Dossier saisi sur le téléphone, synchronisé hors réseau ; conflit au niveau du dossier entier (R-DON-04).';
COMMENT ON COLUMN saisie_terrain.prefecture_id IS 'Zone du dossier : les règles de synchronisation ne l''envoient qu''aux agents de cette préfecture.';

-- Versions écartées entre deux brouillons : la dernière arrivée l'emporte, l'autre est
-- gardée ici (R-DON-04, point 3)
CREATE TABLE saisie_terrain_version (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  saisie_id   uuid NOT NULL REFERENCES saisie_terrain(id) ON DELETE CASCADE,
  version     integer NOT NULL CHECK (version > 0),
  contenu     jsonb NOT NULL,
  auteur_id   bigint NOT NULL REFERENCES utilisateur(id),
  recue_le    timestamptz NOT NULL,
  ecartee_le  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (saisie_id, version)
);
COMMENT ON TABLE saisie_terrain_version IS 'Historique des versions non retenues d''un dossier saisi hors réseau (R-DON-04).';

-- PowerSync lit le flux de réplication logique de ces seules tables, sous le rôle sabou_sync
-- (créé par l'infrastructure, comme sabou_app). Le cloisonnement par zone est fait par les
-- règles de synchronisation (packages/db/sync/sync-rules.yaml), hors du RLS.
CREATE PUBLICATION powersync FOR TABLE saisie_terrain;
GRANT USAGE ON SCHEMA sabou TO sabou_sync;
GRANT SELECT ON saisie_terrain TO sabou_sync;
