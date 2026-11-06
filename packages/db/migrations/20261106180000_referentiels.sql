-- Référentiels gérés par la DG (lot C : US-020, US-021, UC-65, 05_Choix_Techniques.md §2.24).
--   - Référentiel initial chargé ici, et non plus dans le jeu d'exemple : rôles, langues,
--     régions naturelles, 8 régions administratives, préfectures, 8 spécialités. Ce sont des
--     données publiques, pas des données personnelles. Les sous-préfectures sont ajoutées
--     par la DG (écran Territoires) ou par un import de la liste officielle.
--   - Ordre d'insertion = identifiants attendus par le jeu d'exemple (seed/dev.sql).
--   - ON CONFLICT DO NOTHING : une base locale déjà chargée par l'ancien jeu d'exemple
--     reçoit seulement ce qui lui manque.
--   - Règles tenues par la base, dernier rempart derrière l'API :
--       R-LNG-02  une langue nationale n'a jamais d'usage texte ;
--       R-LNG-05  le français reste actif, en texte et en voix (langue de repli) ;
--       R-LNG-06  l'usage (texte, voix) d'une langue est fixé à sa création ;
--       R-LNG-07  la langue par défaut d'une région naturelle reste active ;
--       une langue ou une spécialité désactivée ne peut plus être choisie, sans toucher
--       aux lignes qui la portent déjà.
SET search_path = sabou, public;

-- ---------- Référentiel initial ----------
INSERT INTO role (code, libelle_fr, libelle_en) VALUES
 ('dg','Direction Générale','General Directorate'),
 ('regional','Admin Régional','Regional Admin'),
 ('prefectoral','Admin Préfectoral','Prefectoral Admin'),
 ('scientifique','Comité Scientifique','Scientific Committee'),
 ('praticien','Tradipraticien','Traditional healer'),
 ('citoyen','Citoyen','Citizen')
ON CONFLICT DO NOTHING;

INSERT INTO langue (code, iso639_3, nom_fr, type, texte, voix, ordre) VALUES
 ('fr', 'fra', 'Français', 'officielle',     true,  true,  1),
 ('en', 'eng', 'Anglais',  'internationale', true,  false, 2),
 ('sou','sus', 'Soussou',  'nationale',      false, true,  3),
 ('mal','emk', 'Malinké',  'nationale',      false, true,  4),
 ('pul','fuf', 'Pular',    'nationale',      false, true,  5),
 ('gue','gkp', 'Guerzé',   'nationale',      false, true,  6)
ON CONFLICT DO NOTHING;

INSERT INTO region_naturelle (code, nom, langue_defaut_code) VALUES
 ('BG','Basse Guinée','sou'), ('MG','Moyenne Guinée','pul'),
 ('HG','Haute Guinée','mal'), ('GF','Guinée Forestière','gue')
ON CONFLICT DO NOTHING;

-- Conakry rattachée à la Basse Guinée (R-LNG-07, CdC §2.2)
INSERT INTO region_admin (nom, region_naturelle_id)
SELECT r.nom, n.id
  FROM (VALUES (1,'Boké','BG'),(2,'Conakry','BG'),(3,'Kindia','BG'),(4,'Labé','MG'),
               (5,'Mamou','MG'),(6,'Faranah','HG'),(7,'Kankan','HG'),(8,'N''Zérékoré','GF'))
       AS r(ordre, nom, naturelle)
  JOIN region_naturelle n ON n.code = r.naturelle
 ORDER BY r.ordre
ON CONFLICT DO NOTHING;

-- 33 préfectures et la zone spéciale de Conakry, gérée comme une préfecture
-- (un administrateur préfectoral y est affecté). Les dix premières gardent l'ordre de
-- l'ancien jeu d'exemple.
INSERT INTO prefecture (nom, region_admin_id)
SELECT p.nom, r.id
  FROM (VALUES
         (1,'Boké','Boké'),(2,'Conakry','Conakry'),(3,'Kindia','Kindia'),(4,'Labé','Labé'),
         (5,'Mamou','Mamou'),(6,'Faranah','Faranah'),(7,'Kankan','Kankan'),
         (8,'N''Zérékoré','N''Zérékoré'),(9,'Siguiri','Kankan'),(10,'Coyah','Kindia'),
         (11,'Boffa','Boké'),(12,'Fria','Boké'),(13,'Gaoual','Boké'),(14,'Koundara','Boké'),
         (15,'Dubréka','Kindia'),(16,'Forécariah','Kindia'),(17,'Télimélé','Kindia'),
         (18,'Koubia','Labé'),(19,'Lélouma','Labé'),(20,'Mali','Labé'),(21,'Tougué','Labé'),
         (22,'Dalaba','Mamou'),(23,'Pita','Mamou'),
         (24,'Dabola','Faranah'),(25,'Dinguiraye','Faranah'),(26,'Kissidougou','Faranah'),
         (27,'Kérouané','Kankan'),(28,'Kouroussa','Kankan'),(29,'Mandiana','Kankan'),
         (30,'Beyla','N''Zérékoré'),(31,'Guéckédou','N''Zérékoré'),(32,'Lola','N''Zérékoré'),
         (33,'Macenta','N''Zérékoré'),(34,'Yomou','N''Zérékoré'))
       AS p(ordre, nom, region)
  JOIN region_admin r ON r.nom = p.region
 ORDER BY p.ordre
ON CONFLICT DO NOTHING;

-- ---------- Spécialités (R-CER-09, CdC §7) ----------
ALTER TABLE specialite ADD COLUMN active boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN specialite.active IS 'Désactivée : plus proposée ni attribuable ; les praticiens qui la portent la gardent.';

INSERT INTO specialite (code, libelle_fr, libelle_en) VALUES
 ('phytotherapie','Phytothérapie','Herbal medicine'),
 ('pediatrie','Pédiatrie','Paediatrics'),
 ('os_fractures','Os et fractures','Bones and fractures'),
 ('nutrition','Nutrition','Nutrition'),
 ('gynecologie','Gynécologie et santé maternelle','Gynaecology and maternal health'),
 ('sante_mentale','Santé mentale','Mental health'),
 ('dermatologie','Maladies de la peau','Skin diseases'),
 ('envenimations','Morsures et envenimations','Bites and envenomations')
ON CONFLICT DO NOTHING;

-- Une spécialité désactivée ne peut plus être attribuée ; une fiche qui la porte déjà
-- reste modifiable tant qu'on ne change pas sa spécialité.
CREATE FUNCTION trg_ck_specialite_active() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.specialite_id IS NOT DISTINCT FROM OLD.specialite_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM specialite s WHERE s.id = NEW.specialite_id AND s.active) THEN
    RAISE EXCEPTION 'Spécialité % désactivée', NEW.specialite_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ck_specialite_active';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_praticien_specialite BEFORE INSERT OR UPDATE OF specialite_id ON praticien
  FOR EACH ROW EXECUTE FUNCTION trg_ck_specialite_active();

-- ---------- Langues (R-LNG-01 à 07) ----------
ALTER TABLE langue
  ADD CONSTRAINT ck_langue_nationale_voix CHECK (type <> 'nationale' OR NOT texte),
  ADD CONSTRAINT ck_langue_francais CHECK (code <> 'fr' OR (active AND texte AND voix));

-- Usage d'une langue : en plus de l'usage (texte ou voix), la langue doit être active
-- quand on la choisit. Une ligne qui garde sa langue reste modifiable si la langue a
-- été désactivée depuis.
CREATE OR REPLACE FUNCTION trg_ck_langue_usage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_code text := to_jsonb(NEW) ->> TG_ARGV[0];
        v_ok   boolean;
BEGIN
  IF v_code IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> TG_ARGV[0]) IS NOT DISTINCT FROM v_code THEN
    RETURN NEW;
  END IF;
  SELECT l.active AND CASE WHEN TG_ARGV[1] = 'voix' THEN l.voix ELSE l.texte END INTO v_ok
    FROM langue l WHERE l.code = v_code;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Langue « % » non autorisée pour l''usage % (%.%)', v_code, TG_ARGV[1], TG_TABLE_NAME, TG_ARGV[0];
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION trg_langue_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code <> OLD.code OR NEW.texte <> OLD.texte OR NEW.voix <> OLD.voix OR NEW.type <> OLD.type THEN
    RAISE EXCEPTION 'Le code, le type et l''usage d''une langue sont fixés à sa création'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ck_langue_usage_fixe';
  END IF;
  IF OLD.active AND NOT NEW.active
     AND EXISTS (SELECT 1 FROM region_naturelle r WHERE r.langue_defaut_code = NEW.code) THEN
    RAISE EXCEPTION 'La langue « % » est la langue par défaut d''une région naturelle', NEW.code
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ck_langue_region';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_langue_modification BEFORE UPDATE ON langue
  FOR EACH ROW EXECUTE FUNCTION trg_langue_modification();
