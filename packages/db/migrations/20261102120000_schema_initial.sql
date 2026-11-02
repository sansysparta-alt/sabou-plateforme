-- =====================================================================
-- SABOU — Yeleen Kènè : schéma PostgreSQL 17 — migration initiale (schéma v2, US-003)
-- Conforme au cahier des charges v1.3 et à 04_Regles_Metier.md (R-xxx).
-- Règle des langues : texte en français (+ anglais) ; langues nationales en VOIX uniquement.
-- Appliquée par Atlas (pnpm db:migrate), jamais à la main. Une migration appliquée ne se
-- modifie plus : toute évolution passe par une nouvelle migration (packages/db/README.md).
-- Corrections par rapport aux scripts v2 de Plateforme/database : un motif obligatoire ne
-- peut plus être vide ni fait d'espaces (ck_motif_rejet, recette_transition).
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA public;  -- recherche floue
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;  -- recherche sans accents

CREATE SCHEMA IF NOT EXISTS sabou;
SET search_path = sabou, public;

-- unaccent() n'est pas IMMUTABLE : on l'encapsule pour pouvoir l'indexer
CREATE OR REPLACE FUNCTION f_norm(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT lower(public.unaccent('public.unaccent', t)) $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ---------------------------------------------------------------------
-- 1. RÉFÉRENTIEL LINGUISTIQUE ET TERRITORIAL
-- ---------------------------------------------------------------------
CREATE TABLE langue (
  code        text PRIMARY KEY CHECK (code ~ '^[a-z]{2,3}$'),
  iso639_3    text,
  nom_fr      text NOT NULL,
  type        text NOT NULL CHECK (type IN ('officielle','nationale','internationale')),
  texte       boolean NOT NULL DEFAULT false,
  voix        boolean NOT NULL DEFAULT false,
  active      boolean NOT NULL DEFAULT true,
  ordre       smallint NOT NULL DEFAULT 0,
  CONSTRAINT ck_langue_usage CHECK (texte OR voix)
);
COMMENT ON TABLE langue IS 'Langues gérées (R-LNG-01). Ajouter une langue = une ligne, sans modifier le code.';
COMMENT ON COLUMN langue.texte IS 'Langue écrite : français et anglais uniquement (R-LNG-02, R-LNG-05).';
COMMENT ON COLUMN langue.voix  IS 'Langue parlée : français + soussou, malinké, pular, guerzé (R-LNG-03, R-LNG-04).';

-- Vérifie qu'une colonne de langue désigne une langue autorisée pour l'usage demandé.
-- Arguments du trigger : nom de la colonne, usage ('texte' ou 'voix').
CREATE OR REPLACE FUNCTION trg_ck_langue_usage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_code text := to_jsonb(NEW) ->> TG_ARGV[0];
        v_ok   boolean;
BEGIN
  IF v_code IS NULL THEN RETURN NEW; END IF;
  SELECT CASE WHEN TG_ARGV[1] = 'voix' THEN l.voix ELSE l.texte END INTO v_ok
    FROM langue l WHERE l.code = v_code;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Langue « % » non autorisée pour l''usage % (%.%)', v_code, TG_ARGV[1], TG_TABLE_NAME, TG_ARGV[0];
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE region_naturelle (
  id                  smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                text NOT NULL UNIQUE,
  nom                 text NOT NULL,
  langue_defaut_code  text NOT NULL REFERENCES langue(code)
);
CREATE TRIGGER trg_region_langue BEFORE INSERT OR UPDATE ON region_naturelle
  FOR EACH ROW EXECUTE FUNCTION trg_ck_langue_usage('langue_defaut_code', 'voix');
COMMENT ON TABLE region_naturelle IS 'Les 4 régions naturelles ; elles fixent la langue vocale par défaut (R-LNG-07).';

CREATE TABLE region_admin (
  id                   smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nom                  text NOT NULL UNIQUE,
  region_naturelle_id  smallint NOT NULL REFERENCES region_naturelle(id)
);
COMMENT ON TABLE region_admin IS '8 régions administratives (rattachement de Conakry à confirmer, R-LNG-07).';

CREATE TABLE prefecture (
  id               smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nom              text NOT NULL,
  region_admin_id  smallint NOT NULL REFERENCES region_admin(id),
  UNIQUE (region_admin_id, nom)
);
CREATE INDEX ix_prefecture_region ON prefecture(region_admin_id);

CREATE TABLE sous_prefecture (
  id             smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nom            text NOT NULL,
  prefecture_id  smallint NOT NULL REFERENCES prefecture(id),
  UNIQUE (prefecture_id, nom)
);
COMMENT ON TABLE sous_prefecture IS 'Pour les statistiques locales de l''Admin préfectoral (CdC §6.4, R-ACC-06).';

-- ---------------------------------------------------------------------
-- 2. UTILISATEURS ET DROITS (RBAC)
-- ---------------------------------------------------------------------
CREATE TABLE role (
  code        text PRIMARY KEY CHECK (code IN ('dg','regional','prefectoral','scientifique','praticien','citoyen')),
  libelle_fr  text NOT NULL,
  libelle_en  text NOT NULL
);

CREATE TABLE utilisateur (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email              text NOT NULL,
  telephone          text,
  mot_de_passe_hash  text NOT NULL,
  prenom             text NOT NULL,
  nom                text NOT NULL,
  role_code          text NOT NULL REFERENCES role(code),
  region_admin_id    smallint REFERENCES region_admin(id),
  prefecture_id      smallint REFERENCES prefecture(id),
  langue_interface   text NOT NULL DEFAULT 'fr' REFERENCES langue(code),
  langue_ecoute      text REFERENCES langue(code),
  mfa_actif          boolean NOT NULL DEFAULT false,
  mfa_secret_chiffre bytea,
  statut             text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','suspendu')),
  derniere_connexion timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_zone_regional    CHECK (role_code <> 'regional'    OR region_admin_id IS NOT NULL),
  CONSTRAINT ck_zone_prefectoral CHECK (role_code <> 'prefectoral' OR prefecture_id   IS NOT NULL),
  CONSTRAINT ck_mfa_admin        CHECK (role_code IN ('praticien','citoyen') OR mfa_actif),
  CONSTRAINT ck_mfa_secret       CHECK (NOT mfa_actif OR mfa_secret_chiffre IS NOT NULL)
);
CREATE UNIQUE INDEX ux_utilisateur_email ON utilisateur (lower(email));
CREATE INDEX ix_utilisateur_zone ON utilisateur (role_code, region_admin_id, prefecture_id);
CREATE TRIGGER trg_utilisateur_upd BEFORE UPDATE ON utilisateur FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_utilisateur_lg_interface BEFORE INSERT OR UPDATE ON utilisateur
  FOR EACH ROW EXECUTE FUNCTION trg_ck_langue_usage('langue_interface', 'texte');
CREATE TRIGGER trg_utilisateur_lg_ecoute BEFORE INSERT OR UPDATE ON utilisateur
  FOR EACH ROW EXECUTE FUNCTION trg_ck_langue_usage('langue_ecoute', 'voix');
COMMENT ON COLUMN utilisateur.mfa_actif IS 'Double facteur obligatoire pour tout administrateur (R-ACC-03).';
COMMENT ON COLUMN utilisateur.langue_ecoute IS 'Langue de voix préférée ; à défaut, langue de la région (R-LNG-08).';

CREATE TABLE utilisateur_langue (
  utilisateur_id    bigint NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
  langue_code       text   NOT NULL REFERENCES langue(code),
  peut_enregistrer  boolean NOT NULL DEFAULT false,
  peut_traduire     boolean NOT NULL DEFAULT false,
  peut_valider      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (utilisateur_id, langue_code)
);
COMMENT ON TABLE utilisateur_langue IS 'Langues de travail : ce qu''un compte peut enregistrer, traduire ou valider (R-GOV-06, contrôlé par l''application).';

-- ---------------------------------------------------------------------
-- 3. PRATICIENS, ABONNEMENTS
-- ---------------------------------------------------------------------
CREATE TABLE specialite (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  libelle_fr  text NOT NULL,
  libelle_en  text
);
COMMENT ON TABLE specialite IS 'Liste de 8 valeurs paramétrables par la DG (CdC §7, R-CER-09).';

CREATE TABLE praticien (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                text NOT NULL UNIQUE,
  utilisateur_id      bigint NOT NULL UNIQUE REFERENCES utilisateur(id),
  specialite_id       smallint NOT NULL REFERENCES specialite(id),
  prefecture_id       smallint NOT NULL REFERENCES prefecture(id),
  sous_prefecture_id  smallint REFERENCES sous_prefecture(id),
  langue_principale   text NOT NULL REFERENCES langue(code),
  annees_experience   smallint NOT NULL DEFAULT 0 CHECK (annees_experience BETWEEN 0 AND 80),
  photo_url           text,
  statut              text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','certifie','rejete','suspendu')),
  note_moyenne        numeric(2,1) CHECK (note_moyenne BETWEEN 0 AND 5),
  nb_avis             integer NOT NULL DEFAULT 0 CHECK (nb_avis >= 0),
  nb_vues             integer NOT NULL DEFAULT 0 CHECK (nb_vues >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_praticien_prefecture ON praticien (prefecture_id, specialite_id);
CREATE INDEX ix_praticien_public ON praticien (prefecture_id) WHERE statut = 'certifie';
CREATE TRIGGER trg_praticien_upd BEFORE UPDATE ON praticien FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_praticien_langue BEFORE INSERT OR UPDATE ON praticien
  FOR EACH ROW EXECUTE FUNCTION trg_ck_langue_usage('langue_principale', 'voix');

CREATE TABLE abonnement (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  praticien_id bigint NOT NULL REFERENCES praticien(id),
  formule      text NOT NULL CHECK (formule IN ('gratuit','gold','institution')),
  debut        date NOT NULL,
  fin          date,
  montant_gnf  integer NOT NULL DEFAULT 0 CHECK (montant_gnf >= 0),
  paiement_id  bigint,                                  -- FK ajoutée après la table paiement
  CONSTRAINT ck_abo_dates CHECK (fin IS NULL OR fin > debut)
);
CREATE INDEX ix_abo_prat ON abonnement (praticien_id, debut DESC);
COMMENT ON TABLE abonnement IS 'Gratuit : 3 traitements certifiés ; GOLD (15 000 GNF) et Institution : illimité (CdC §9.1, R-REC-11).';

-- Formule en vigueur aujourd'hui, avec 30 jours de grâce après la fin (gratuit par défaut, R-REC-11)
CREATE OR REPLACE FUNCTION formule_active(p_praticien bigint) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT a.formule FROM abonnement a
                    WHERE a.praticien_id = p_praticien AND a.debut <= current_date
                      AND (a.fin IS NULL OR a.fin + 30 >= current_date)
                    ORDER BY a.debut DESC LIMIT 1), 'gratuit')
$$;

-- ---------------------------------------------------------------------
-- 4. CERTIFICATION (workflow en 6 étapes)
-- ---------------------------------------------------------------------
CREATE TABLE dossier_certification (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code             text NOT NULL UNIQUE,
  praticien_id     bigint NOT NULL REFERENCES praticien(id),
  type             text NOT NULL DEFAULT 'initial' CHECK (type IN ('initial','renouvellement')),
  visite_requise   boolean NOT NULL DEFAULT true,
  etape_courante   smallint NOT NULL DEFAULT 1 CHECK (etape_courante BETWEEN 1 AND 6),
  etape_entree_le  timestamptz NOT NULL DEFAULT now(),
  statut           text NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours','approuve','rejete_definitif','abandonne')),
  ouvert_le        timestamptz NOT NULL DEFAULT now(),
  cloture_le       timestamptz,
  CONSTRAINT ck_cloture CHECK ((statut = 'en_cours') = (cloture_le IS NULL)),
  CONSTRAINT ck_visite_initiale CHECK (type = 'renouvellement' OR visite_requise)
);
COMMENT ON COLUMN dossier_certification.visite_requise IS 'Toujours vrai pour un dossier initial ; pour un renouvellement, vrai si dernière visite > 3 ans, signalement, litige, changement de lieu ou tirage au sort de 20 % (R-QR-07).';

-- Après un rejet définitif, aucun nouveau dossier avant 12 mois (R-CER-04)
CREATE OR REPLACE FUNCTION trg_dossier_delai_rejet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM dossier_certification d
              WHERE d.praticien_id = NEW.praticien_id AND d.statut = 'rejete_definitif'
                AND d.cloture_le > now() - interval '12 months') THEN
    RAISE EXCEPTION 'Praticien % : nouveau dossier impossible moins de 12 mois après un rejet définitif', NEW.praticien_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_dossier_delai_rejet BEFORE INSERT ON dossier_certification
  FOR EACH ROW EXECUTE FUNCTION trg_dossier_delai_rejet();
CREATE UNIQUE INDEX ux_dossier_en_cours ON dossier_certification (praticien_id) WHERE statut = 'en_cours';
CREATE INDEX ix_dossier_etape ON dossier_certification (etape_courante, etape_entree_le) WHERE statut = 'en_cours';
COMMENT ON COLUMN dossier_certification.etape_courante IS 'Étape en attente de décision : 1 soumission, 2 terrain, 3 consolidation, 4 expertise, 5 approbation, 6 publication.';
COMMENT ON COLUMN dossier_certification.etape_entree_le IS 'Entrée dans l''étape courante : délai cible 3 jours, « bloqué » au-delà de 15 jours (R-CER-07).';

CREATE TABLE dossier_piece (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dossier_id  bigint NOT NULL REFERENCES dossier_certification(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('identite','justificatif','photo','compte_rendu_visite','autre')),
  fichier_url text NOT NULL,
  sha256      char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  depose_par  bigint NOT NULL REFERENCES utilisateur(id),
  depose_le   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_dossier_piece ON dossier_piece (dossier_id);

CREATE TABLE visite_terrain (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dossier_id             bigint NOT NULL REFERENCES dossier_certification(id) ON DELETE CASCADE,
  admin_id               bigint NOT NULL REFERENCES utilisateur(id),
  prevue_le              timestamptz NOT NULL,
  rappel_envoye_le       timestamptz,
  realisee_le            timestamptz,
  compte_rendu_piece_id  bigint REFERENCES dossier_piece(id),
  statut                 text NOT NULL DEFAULT 'planifiee' CHECK (statut IN ('planifiee','realisee','annulee')),
  CONSTRAINT ck_visite_realisee CHECK (statut <> 'realisee' OR (realisee_le IS NOT NULL AND compte_rendu_piece_id IS NOT NULL))
);
CREATE INDEX ix_visite_agenda ON visite_terrain (admin_id, prevue_le) WHERE statut = 'planifiee';
COMMENT ON TABLE visite_terrain IS 'Agenda des visites de l''Admin préfectoral ; une visite réalisée exige un compte rendu signé (R-CER-06, R-MOD-02).';

CREATE TABLE dossier_historique (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dossier_id     bigint NOT NULL REFERENCES dossier_certification(id) ON DELETE CASCADE,
  etape_depart   smallint NOT NULL CHECK (etape_depart  BETWEEN 1 AND 6),
  etape_arrivee  smallint NOT NULL CHECK (etape_arrivee BETWEEN 1 AND 6),
  decision       text NOT NULL CHECK (decision IN ('soumis','valide','rejete','rejet_definitif','publie')),
  motif          text,
  acteur_id      bigint NOT NULL REFERENCES utilisateur(id),
  decide_le      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_motif_rejet CHECK (decision NOT IN ('rejete','rejet_definitif') OR COALESCE(btrim(motif), '') <> ''),
  CONSTRAINT ck_transition CHECK (
       (decision = 'soumis'          AND etape_depart = 1 AND etape_arrivee = 2)
    OR (decision = 'valide'          AND etape_depart BETWEEN 2 AND 5 AND etape_arrivee = etape_depart + 1)
    OR (decision = 'rejete'          AND etape_depart BETWEEN 2 AND 5 AND etape_arrivee = etape_depart - 1)
    OR (decision = 'rejet_definitif' AND etape_arrivee = etape_depart)
    OR (decision = 'publie'          AND etape_depart = 6 AND etape_arrivee = 6))
);
CREATE INDEX ix_dossier_hist ON dossier_historique (dossier_id, decide_le);
COMMENT ON TABLE dossier_historique IS 'Chaque transition, horodatée : aucune étape sautée, un rejet renvoie à l''étape précédente avec motif (R-CER-01, R-CER-03).';

CREATE TABLE cle_signature (
  id             smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  algorithme     text NOT NULL DEFAULT 'ed25519' CHECK (algorithme = 'ed25519'),
  cle_publique   text NOT NULL UNIQUE,
  active_depuis  timestamptz NOT NULL DEFAULT now(),
  revoquee_le    timestamptz
);
COMMENT ON TABLE cle_signature IS 'Clés publiques de la DG (la clé privée reste hors base, dans un coffre). Rotation et révocation (R-QR-04).';

CREATE TABLE certificat (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero            text NOT NULL UNIQUE,
  praticien_id      bigint NOT NULL REFERENCES praticien(id),
  dossier_id        bigint NOT NULL REFERENCES dossier_certification(id),
  emis_par          bigint NOT NULL REFERENCES utilisateur(id),
  emis_le           date NOT NULL,
  expire_le         date NOT NULL,
  empreinte_sha3    char(64) NOT NULL CHECK (empreinte_sha3 ~ '^[0-9a-f]{64}$'),
  signature         text NOT NULL CHECK (signature ~ '^[A-Za-z0-9+/]+={0,2}$'),
  cle_id            smallint NOT NULL REFERENCES cle_signature(id),
  statut            text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','expire','revoque')),
  motif_revocation  text,
  revoque_le        timestamptz,
  CONSTRAINT ck_validite   CHECK (expire_le > emis_le AND expire_le <= emis_le + interval '12 months'),
  CONSTRAINT ck_revocation CHECK (statut <> 'revoque' OR (motif_revocation IS NOT NULL AND revoque_le IS NOT NULL))
);
CREATE UNIQUE INDEX ux_certificat_actif ON certificat (praticien_id) WHERE statut = 'actif';
COMMENT ON COLUMN certificat.empreinte_sha3 IS 'SHA3-256 des données du certificat, calculé par l''application (R-QR-02).';
COMMENT ON COLUMN certificat.signature IS 'Signature Ed25519 (base64) de l''empreinte, vérifiable hors ligne avec la clé publique (R-QR-03).';

-- Suspension ou rejet définitif d'un praticien ⇒ révocation de son certificat actif (R-QR-06)
CREATE OR REPLACE FUNCTION trg_praticien_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.statut IN ('suspendu','rejete') AND OLD.statut IS DISTINCT FROM NEW.statut THEN
    UPDATE certificat SET statut = 'revoque', revoque_le = now(),
           motif_revocation = 'Praticien ' || NEW.statut
     WHERE praticien_id = NEW.id AND statut = 'actif';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_praticien_revocation AFTER UPDATE OF statut ON praticien
  FOR EACH ROW EXECUTE FUNCTION trg_praticien_revocation();

-- Passage des certificats arrivés à échéance au statut « expiré » (tâche planifiée quotidienne)
CREATE OR REPLACE FUNCTION expirer_certificats() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  UPDATE certificat SET statut = 'expire' WHERE statut = 'actif' AND expire_le < current_date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------
-- 5. AUDIO, PLANTES, MALADIES
-- ---------------------------------------------------------------------
CREATE TABLE audio_fichier (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chemin             text NOT NULL UNIQUE,
  duree_sec          numeric(6,2) NOT NULL CHECK (duree_sec > 0),
  format             text NOT NULL DEFAULT 'opus' CHECK (format IN ('opus','mp3','aac','wav')),
  taille_octets      integer CHECK (taille_octets > 0),
  sha256             char(64) CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  enregistre_par     bigint NOT NULL REFERENCES utilisateur(id),
  consentement_voix  boolean NOT NULL DEFAULT false,
  consentement_le    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_consentement CHECK (NOT consentement_voix OR consentement_le IS NOT NULL)
);
COMMENT ON TABLE audio_fichier IS 'Métadonnées des voix ; fichiers en stockage objet souverain. Durée cible 90 s par section (R-REC-14).';

-- Règles communes aux tables de voix : consentement avant publication (R-LNG-11) ;
-- pour les effets indésirables, contrôle du Comité dans la langue (R-LNG-12).
CREATE OR REPLACE FUNCTION trg_voix_publiable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.statut = 'publie' THEN
    IF NOT EXISTS (SELECT 1 FROM audio_fichier a WHERE a.id = NEW.audio_id AND a.consentement_voix) THEN
      RAISE EXCEPTION 'Voix % : consentement du praticien absent, publication impossible', NEW.audio_id;
    END IF;
    -- IF imbriqué : les champs controle_comite_par et section_id n'existent que dans recette_section_voix
    IF TG_TABLE_NAME = 'recette_section_voix' THEN
      IF NEW.controle_comite_par IS NULL
         AND EXISTS (SELECT 1 FROM recette_section s WHERE s.id = NEW.section_id AND s.type_code = 'effets_indesirables') THEN
        RAISE EXCEPTION 'Effets indésirables (%) : contrôle du Comité requis avant publication', NEW.langue_code;
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TABLE plante (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code              text NOT NULL UNIQUE,
  nom_scientifique  text NOT NULL UNIQUE,
  famille           text NOT NULL,
  nom_fr            text NOT NULL,
  nom_en            text,
  statut            text NOT NULL DEFAULT 'en_revue' CHECK (statut IN ('en_revue','validee')),
  valide_par        bigint REFERENCES utilisateur(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_plante_validee CHECK (statut <> 'validee' OR valide_par IS NOT NULL)
);
CREATE INDEX ix_plante_nom_fr_trgm  ON plante USING gin (f_norm(nom_fr) gin_trgm_ops);
CREATE INDEX ix_plante_nom_en_trgm  ON plante USING gin (f_norm(nom_en) gin_trgm_ops);
CREATE INDEX ix_plante_sci_trgm     ON plante USING gin (f_norm(nom_scientifique) gin_trgm_ops);
CREATE TRIGGER trg_plante_upd BEFORE UPDATE ON plante FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE plante IS 'Une plante = une fiche = un identifiant, commun à toutes les langues (R-PLA-01). Validée par le Comité (R-PLA-05).';

CREATE TABLE plante_image (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plante_id    bigint NOT NULL REFERENCES plante(id) ON DELETE CASCADE,
  image_url    text NOT NULL,
  alt_text_fr  text NOT NULL,
  alt_text_en  text,
  type         text NOT NULL DEFAULT 'autre' CHECK (type IN ('plante_entiere','feuille','ecorce','racine','produit_prepare','autre')),
  principale   boolean NOT NULL DEFAULT false,
  ordre        smallint NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_plante_image_principale ON plante_image (plante_id) WHERE principale;
COMMENT ON TABLE plante_image IS 'Une seule photo principale par plante ; texte alternatif obligatoire (R-PLA-04).';

CREATE TABLE plante_voix (
  plante_id       bigint NOT NULL REFERENCES plante(id) ON DELETE CASCADE,
  langue_code     text   NOT NULL REFERENCES langue(code),
  audio_id        bigint NOT NULL REFERENCES audio_fichier(id),
  statut          text   NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','traduit','valide','publie')),
  enregistre_par  bigint NOT NULL REFERENCES utilisateur(id),
  valideur_id     bigint REFERENCES utilisateur(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plante_id, langue_code),
  CONSTRAINT ck_pv_valideur CHECK (statut NOT IN ('valide','publie') OR valideur_id IS NOT NULL),
  CONSTRAINT ck_pv_separation CHECK (valideur_id IS NULL OR valideur_id <> enregistre_par)
);
CREATE INDEX ix_plante_voix_langue ON plante_voix (langue_code, statut);
CREATE TRIGGER trg_plante_voix_langue BEFORE INSERT OR UPDATE ON plante_voix
  FOR EACH ROW EXECUTE FUNCTION trg_ck_langue_usage('langue_code', 'voix');
CREATE TRIGGER trg_plante_voix_pub BEFORE INSERT OR UPDATE ON plante_voix
  FOR EACH ROW EXECUTE FUNCTION trg_voix_publiable();
COMMENT ON TABLE plante_voix IS 'Voix du nom de la plante dans chaque langue vocale ; libellé écrit en français (R-PLA-02, R-LNG-02).';

CREATE TABLE plante_nom_local (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plante_id                bigint NOT NULL REFERENCES plante(id) ON DELETE CASCADE,
  langue_code              text   NOT NULL REFERENCES langue(code),
  transcription_recherche  text   NOT NULL,
  audio_id                 bigint REFERENCES audio_fichier(id),
  principal                boolean NOT NULL DEFAULT false,
  UNIQUE (plante_id, langue_code, transcription_recherche)
);
CREATE UNIQUE INDEX ux_nom_local_principal ON plante_nom_local (plante_id, langue_code) WHERE principal;
CREATE INDEX ix_nom_local_trgm ON plante_nom_local USING gin (f_norm(transcription_recherche) gin_trgm_ops);
CREATE TRIGGER trg_nom_local_langue BEFORE INSERT OR UPDATE ON plante_nom_local
  FOR EACH ROW EXECUTE FUNCTION trg_ck_langue_usage('langue_code', 'voix');
COMMENT ON TABLE plante_nom_local IS 'Noms locaux et synonymes (R-PLA-03). La transcription sert uniquement à la recherche, jamais à l''affichage (R-LNG-13, à confirmer).';

CREATE TABLE maladie (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  nom_fr       text NOT NULL UNIQUE,
  nom_en       text,
  symptomes_fr text,
  symptomes_en text
);
CREATE INDEX ix_maladie_fr_trgm ON maladie USING gin (f_norm(nom_fr) gin_trgm_ops);
CREATE INDEX ix_maladie_en_trgm ON maladie USING gin (f_norm(nom_en) gin_trgm_ops);
COMMENT ON TABLE maladie IS 'Fiche maladie : noms, symptômes, dénominations, voix du nom (R-MAL-01).';

CREATE TABLE maladie_denomination (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  maladie_id    bigint NOT NULL REFERENCES maladie(id) ON DELETE CASCADE,
  langue_code   text   NOT NULL REFERENCES langue(code),
  denomination  text   NOT NULL,
  UNIQUE (maladie_id, langue_code, denomination)
);
CREATE INDEX ix_denomination_trgm ON maladie_denomination USING gin (f_norm(denomination) gin_trgm_ops);
CREATE TRIGGER trg_denomination_langue BEFORE INSERT OR UPDATE ON maladie_denomination
  FOR EACH ROW EXECUTE FUNCTION trg_ck_langue_usage('langue_code', 'texte');

CREATE TABLE maladie_voix (
  maladie_id      bigint NOT NULL REFERENCES maladie(id) ON DELETE CASCADE,
  langue_code     text   NOT NULL REFERENCES langue(code),
  audio_id        bigint NOT NULL REFERENCES audio_fichier(id),
  statut          text   NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','traduit','valide','publie')),
  enregistre_par  bigint NOT NULL REFERENCES utilisateur(id),
  valideur_id     bigint REFERENCES utilisateur(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (maladie_id, langue_code),
  CONSTRAINT ck_mv_valideur CHECK (statut NOT IN ('valide','publie') OR valideur_id IS NOT NULL),
  CONSTRAINT ck_mv_separation CHECK (valideur_id IS NULL OR valideur_id <> enregistre_par)
);
CREATE TRIGGER trg_maladie_voix_langue BEFORE INSERT OR UPDATE ON maladie_voix
  FOR EACH ROW EXECUTE FUNCTION trg_ck_langue_usage('langue_code', 'voix');
CREATE TRIGGER trg_maladie_voix_pub BEFORE INSERT OR UPDATE ON maladie_voix
  FOR EACH ROW EXECUTE FUNCTION trg_voix_publiable();
COMMENT ON TABLE maladie_voix IS 'Voix du nom de la maladie ; même circuit que les plantes (R-MAL-02).';

CREATE TABLE plante_maladie (
  plante_id   bigint NOT NULL REFERENCES plante(id)  ON DELETE CASCADE,
  maladie_id  bigint NOT NULL REFERENCES maladie(id) ON DELETE CASCADE,
  PRIMARY KEY (plante_id, maladie_id)
);
CREATE INDEX ix_plante_maladie_inv ON plante_maladie (maladie_id);
COMMENT ON TABLE plante_maladie IS 'Plantes recommandées pour une maladie (fiche maladie du Dictionnaire).';

-- ---------------------------------------------------------------------
-- 6. TRAITEMENTS (texte français + anglais, voix par langue)
-- ---------------------------------------------------------------------
CREATE TABLE section_type (
  code        text PRIMARY KEY CHECK (code IN ('preparation','consommation','cycle','effets_indesirables','conservation')),
  ordre       smallint NOT NULL UNIQUE,
  obligatoire boolean  NOT NULL DEFAULT true,
  libelle_fr  text NOT NULL,
  libelle_en  text NOT NULL
);
COMMENT ON TABLE section_type IS '4 sections obligatoires + conservation facultative (R-REC-02).';

CREATE TABLE recette (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                  text NOT NULL UNIQUE,
  praticien_id          bigint NOT NULL REFERENCES praticien(id),
  maladie_id            bigint NOT NULL REFERENCES maladie(id),
  dossier_id            bigint REFERENCES dossier_certification(id),
  titre_fr              text NOT NULL,
  titre_en              text,
  cycle_duree_jours     smallint CHECK (cycle_duree_jours > 0),
  cycle_prises_par_jour smallint CHECK (cycle_prises_par_jour > 0),
  cycle_pause_jours     smallint CHECK (cycle_pause_jours >= 0),
  image_url             text,
  visibilite            text NOT NULL DEFAULT 'publique' CHECK (visibilite IN ('publique','restreinte','privee')),
  statut                text NOT NULL DEFAULT 'brouillon'
                        CHECK (statut IN ('brouillon','soumise','transmise','expertisee','certifiee','suspendue','retiree')),
  note_moyenne          numeric(2,1) CHECK (note_moyenne BETWEEN 0 AND 5),
  nb_avis               integer NOT NULL DEFAULT 0 CHECK (nb_avis >= 0),
  publiee_le            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_publiee CHECK (statut <> 'certifiee' OR publiee_le IS NOT NULL),
  CONSTRAINT ck_cycle   CHECK (statut <> 'certifiee' OR (cycle_duree_jours IS NOT NULL AND cycle_prises_par_jour IS NOT NULL))
);
CREATE INDEX ix_recette_praticien ON recette (praticien_id, statut);
CREATE INDEX ix_recette_public ON recette (maladie_id, note_moyenne DESC) WHERE statut = 'certifiee';
CREATE INDEX ix_recette_titre_trgm ON recette USING gin (f_norm(titre_fr) gin_trgm_ops);
CREATE TRIGGER trg_recette_upd BEFORE UPDATE ON recette FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE recette IS 'Un traitement : UNE maladie, 1 à n plantes, un cycle, des sections (R-REC-01).';
COMMENT ON COLUMN recette.visibilite IS 'publique : site public ; restreinte : utilisateurs connectés ; privee : praticien et administrateurs (R-REC-10).';
COMMENT ON COLUMN recette.dossier_id IS 'Recette jointe à un dossier de certification : certifiée à la publication du dossier (R-REC-08).';
COMMENT ON COLUMN recette.cycle_pause_jours IS 'Pause éventuelle ; les conditions de reprise sont dans la section cycle (R-REC-04).';

CREATE TABLE recette_plante (
  recette_id      bigint NOT NULL REFERENCES recette(id) ON DELETE CASCADE,
  plante_id       bigint NOT NULL REFERENCES plante(id),
  ordre           smallint NOT NULL DEFAULT 1,
  partie_utilisee text,
  PRIMARY KEY (recette_id, plante_id),
  UNIQUE (recette_id, ordre)
);
CREATE INDEX ix_recette_plante_inv ON recette_plante (plante_id);

CREATE TABLE recette_section (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recette_id bigint NOT NULL REFERENCES recette(id) ON DELETE CASCADE,
  type_code  text   NOT NULL REFERENCES section_type(code),
  texte_fr   text   NOT NULL CHECK (length(btrim(texte_fr)) > 0),
  texte_en   text,
  UNIQUE (recette_id, type_code)
);
COMMENT ON TABLE recette_section IS 'Texte écrit en français (obligatoire) et en anglais (facultatif, repli sur le français) (R-REC-03).';

CREATE TABLE recette_section_voix (
  section_id           bigint NOT NULL REFERENCES recette_section(id) ON DELETE CASCADE,
  langue_code          text   NOT NULL REFERENCES langue(code),
  audio_id             bigint NOT NULL REFERENCES audio_fichier(id),
  statut               text   NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','traduit','valide','publie')),
  enregistre_par       bigint NOT NULL REFERENCES utilisateur(id),
  traducteur_id        bigint REFERENCES utilisateur(id),
  valideur_id          bigint REFERENCES utilisateur(id),
  controle_comite_par  bigint REFERENCES utilisateur(id),
  controle_comite_le   timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (section_id, langue_code),
  CONSTRAINT ck_rsv_valideur CHECK (statut NOT IN ('valide','publie') OR valideur_id IS NOT NULL),
  CONSTRAINT ck_rsv_separation CHECK (valideur_id IS NULL OR (valideur_id <> enregistre_par AND valideur_id IS DISTINCT FROM traducteur_id)),
  CONSTRAINT ck_rsv_controle CHECK ((controle_comite_par IS NULL) = (controle_comite_le IS NULL))
);
CREATE INDEX ix_voix_langue ON recette_section_voix (langue_code, statut);
CREATE TRIGGER trg_rsv_langue BEFORE INSERT OR UPDATE ON recette_section_voix
  FOR EACH ROW EXECUTE FUNCTION trg_ck_langue_usage('langue_code', 'voix');
CREATE TRIGGER trg_rsv_pub BEFORE INSERT OR UPDATE ON recette_section_voix
  FOR EACH ROW EXECUTE FUNCTION trg_voix_publiable();
COMMENT ON TABLE recette_section_voix IS 'Une voix par section et par langue ; statut par langue (R-LNG-10).';

CREATE TABLE contre_indication (
  code        text PRIMARY KEY,
  libelle_fr  text NOT NULL,
  libelle_en  text NOT NULL
);
CREATE TABLE recette_contre_indication (
  recette_id              bigint NOT NULL REFERENCES recette(id) ON DELETE CASCADE,
  contre_indication_code  text   NOT NULL REFERENCES contre_indication(code),
  PRIMARY KEY (recette_id, contre_indication_code)
);
COMMENT ON TABLE recette_contre_indication IS 'Contre-indications structurées, affichées en alerte (R-REC-05).';

CREATE TABLE recette_historique (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recette_id      bigint NOT NULL REFERENCES recette(id) ON DELETE CASCADE,
  statut_depart   text NOT NULL,
  statut_arrivee  text NOT NULL,
  motif           text,
  acteur_id       bigint NOT NULL REFERENCES utilisateur(id),
  decide_le       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_recette_hist ON recette_historique (recette_id, decide_le);

CREATE TABLE annotation_comite (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  objet_type  text   NOT NULL CHECK (objet_type IN ('recette','plante')),
  objet_id    bigint NOT NULL,
  auteur_id   bigint NOT NULL REFERENCES utilisateur(id),
  contenu     text   NOT NULL,
  avis        text   CHECK (avis IN ('favorable','reserve','defavorable')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_annotation_objet ON annotation_comite (objet_type, objet_id);
COMMENT ON TABLE annotation_comite IS 'Annotations botaniques et avis motivés du Comité scientifique (R-MOD-10).';

-- Contrôles avant certification d'un traitement (R-REC-06, R-REC-08, R-REC-11)
CREATE OR REPLACE FUNCTION trg_recette_publiable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.statut = 'certifiee' AND (TG_OP = 'INSERT' OR OLD.statut <> 'certifiee') THEN
    IF NOT EXISTS (SELECT 1 FROM recette_plante rp WHERE rp.recette_id = NEW.id) THEN
      RAISE EXCEPTION 'Traitement % : au moins une plante est requise', NEW.code;
    END IF;
    IF EXISTS (SELECT 1 FROM recette_plante rp JOIN plante pl ON pl.id = rp.plante_id
                WHERE rp.recette_id = NEW.id AND pl.statut <> 'validee') THEN
      RAISE EXCEPTION 'Traitement % : toutes les plantes doivent être validées par le Comité', NEW.code;
    END IF;
    IF (SELECT count(*) FROM recette_section s JOIN section_type t ON t.code = s.type_code
         WHERE s.recette_id = NEW.id AND t.obligatoire)
       < (SELECT count(*) FROM section_type WHERE obligatoire) THEN
      RAISE EXCEPTION 'Traitement % : sections obligatoires manquantes (effets indésirables inclus)', NEW.code;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM praticien pr JOIN certificat c ON c.praticien_id = pr.id
                    WHERE pr.id = NEW.praticien_id AND pr.statut = 'certifie'
                      AND c.statut = 'actif' AND c.expire_le >= current_date) THEN
      RAISE EXCEPTION 'Traitement % : le praticien doit être certifié avec un certificat actif', NEW.code;
    END IF;
    IF (TG_OP = 'INSERT' OR OLD.statut <> 'suspendue')
       AND formule_active(NEW.praticien_id) = 'gratuit'
       AND (SELECT count(*) FROM recette r2
             WHERE r2.praticien_id = NEW.praticien_id AND r2.statut = 'certifiee' AND r2.id <> NEW.id) >= 3 THEN
      RAISE EXCEPTION 'Traitement % : la formule gratuite est limitée à 3 traitements certifiés', NEW.code;
    END IF;
    NEW.publiee_le := COALESCE(NEW.publiee_le, now());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_recette_publiable BEFORE INSERT OR UPDATE OF statut ON recette
  FOR EACH ROW EXECUTE FUNCTION trg_recette_publiable();

-- ---------------------------------------------------------------------
-- 7. TÉMOIGNAGES, DEMANDES DE PLANTES, SÉCURITÉ SANITAIRE
-- ---------------------------------------------------------------------
CREATE TABLE temoignage (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auteur_id          bigint NOT NULL REFERENCES utilisateur(id),
  recette_id         bigint NOT NULL REFERENCES recette(id) ON DELETE CASCADE,
  note               smallint NOT NULL CHECK (note BETWEEN 1 AND 5),
  contenu            text NOT NULL CHECK (length(btrim(contenu)) > 0),
  audio_id           bigint REFERENCES audio_fichier(id),
  langue_code        text NOT NULL DEFAULT 'fr' REFERENCES langue(code),
  statut             text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','publie','rejete','signale','retire')),
  modere_par         bigint REFERENCES utilisateur(id),
  modere_le          timestamptz,
  reponse_praticien  text,
  reponse_statut     text CHECK (reponse_statut IN ('en_attente','publie','rejete')),
  reponse_le         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auteur_id, recette_id),
  CONSTRAINT ck_reponse CHECK ((reponse_praticien IS NULL) = (reponse_statut IS NULL))
);
CREATE INDEX ix_temoignage_recette ON temoignage (recette_id, created_at DESC) WHERE statut = 'publie';
CREATE INDEX ix_temoignage_moderation ON temoignage (created_at) WHERE statut IN ('en_attente','signale');
COMMENT ON TABLE temoignage IS 'Un témoignage par utilisateur et par traitement ; le praticien est déduit du traitement (R-TEM-01, R-TEM-02).';

-- Modification par l'auteur ⇒ retour en modération ; réponse du praticien ⇒ modération de la réponse (R-TEM-04, R-TEM-05)
CREATE OR REPLACE FUNCTION trg_temoignage_modif() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.contenu, NEW.note, NEW.audio_id) IS DISTINCT FROM (OLD.contenu, OLD.note, OLD.audio_id)
     AND NEW.statut = OLD.statut AND OLD.statut <> 'retire' THEN
    NEW.statut := 'en_attente'; NEW.modere_par := NULL; NEW.modere_le := NULL;
  END IF;
  IF NEW.reponse_praticien IS DISTINCT FROM OLD.reponse_praticien THEN
    NEW.reponse_statut := CASE WHEN NEW.reponse_praticien IS NULL THEN NULL ELSE 'en_attente' END;
    NEW.reponse_le := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_temoignage_modif BEFORE UPDATE ON temoignage
  FOR EACH ROW EXECUTE FUNCTION trg_temoignage_modif();

-- Recalcul des notes du traitement et du praticien (R-TEM-07)
CREATE OR REPLACE FUNCTION trg_temoignage_notes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_rec  bigint := COALESCE(NEW.recette_id, OLD.recette_id);
        v_prat bigint;
BEGIN
  SELECT r.praticien_id INTO v_prat FROM recette r WHERE r.id = v_rec;
  UPDATE recette r SET note_moyenne = x.m, nb_avis = x.n
    FROM (SELECT round(avg(t.note), 1) AS m, count(*) AS n
            FROM temoignage t WHERE t.recette_id = v_rec AND t.statut = 'publie') x
   WHERE r.id = v_rec;
  UPDATE praticien p SET note_moyenne = x.m, nb_avis = x.n
    FROM (SELECT round(avg(t.note), 1) AS m, count(*) AS n
            FROM temoignage t JOIN recette r ON r.id = t.recette_id
           WHERE r.praticien_id = v_prat AND t.statut = 'publie') x
   WHERE p.id = v_prat;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_temoignage_notes AFTER INSERT OR UPDATE OF statut, note OR DELETE ON temoignage
  FOR EACH ROW EXECUTE FUNCTION trg_temoignage_notes();

CREATE TABLE demande_plante (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  demandeur_id   bigint NOT NULL REFERENCES utilisateur(id),
  langue_code    text NOT NULL REFERENCES langue(code),
  transcription  text,
  audio_id       bigint REFERENCES audio_fichier(id),
  prefecture_id  smallint NOT NULL REFERENCES prefecture(id),
  praticien_id   bigint REFERENCES praticien(id),
  plante_id      bigint REFERENCES plante(id),
  statut         text NOT NULL DEFAULT 'recue' CHECK (statut IN ('recue','a_envoyer','envoyee','annulee')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  traitee_le     timestamptz,
  CONSTRAINT ck_nom_local CHECK (transcription IS NOT NULL OR audio_id IS NOT NULL),
  CONSTRAINT ck_a_envoyer CHECK (statut NOT IN ('a_envoyer','envoyee') OR (praticien_id IS NOT NULL AND plante_id IS NOT NULL))
);
CREATE INDEX ix_demande_file ON demande_plante (prefecture_id, statut);
CREATE INDEX ix_demande_praticien ON demande_plante (praticien_id) WHERE statut IN ('recue','a_envoyer');
CREATE INDEX ix_demande_demandeur ON demande_plante (demandeur_id, created_at DESC);
CREATE TRIGGER trg_demande_langue BEFORE INSERT OR UPDATE ON demande_plante
  FOR EACH ROW EXECUTE FUNCTION trg_ck_langue_usage('langue_code', 'voix');
COMMENT ON TABLE demande_plante IS 'Nom local dit (voix) ou écrit → plante → tradipraticien de la localité ; suivi par le demandeur (R-DEM-01 à 05).';

CREATE TABLE signalement_sanitaire (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type           text NOT NULL CHECK (type IN ('danger','effet_indesirable')),
  objet_type     text NOT NULL CHECK (objet_type IN ('recette','plante','produit')),
  objet_id       bigint NOT NULL,
  auteur_id      bigint REFERENCES utilisateur(id),
  contact        text,
  description    text NOT NULL CHECK (length(btrim(description)) > 0),
  gravite        text NOT NULL DEFAULT 'moyenne' CHECK (gravite IN ('faible','moyenne','grave')),
  prefecture_id  smallint REFERENCES prefecture(id),
  statut         text NOT NULL DEFAULT 'recu' CHECK (statut IN ('recu','en_examen','clos')),
  decision       text CHECK (decision IN ('aucune_action','revision','suspension','retrait')),
  motif_decision text,
  traite_par     bigint REFERENCES utilisateur(id),
  traite_le      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_signalement_clos CHECK (statut <> 'clos' OR (decision IS NOT NULL AND motif_decision IS NOT NULL AND traite_par IS NOT NULL))
);
CREATE INDEX ix_signalement_file ON signalement_sanitaire (gravite, created_at) WHERE statut <> 'clos';
COMMENT ON TABLE signalement_sanitaire IS '« Signaler un danger » et pharmacovigilance, routés vers le Comité ; danger grave traité sous 24 h (R-SAN-01 à 03).';

-- ---------------------------------------------------------------------
-- 8. FORUM
-- ---------------------------------------------------------------------
CREATE TABLE forum_discussion (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titre             text NOT NULL,
  categorie         text NOT NULL CHECK (categorie IN ('certification','temoignages','phytotherapie','formation','comite')),
  portee            text NOT NULL DEFAULT 'nationale' CHECK (portee IN ('nationale','regionale','prefectorale')),
  region_admin_id   smallint REFERENCES region_admin(id),
  prefecture_id     smallint REFERENCES prefecture(id),
  auteur_id         bigint NOT NULL REFERENCES utilisateur(id),
  statut            text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','epingle','resolu','a_surveiller')),
  nb_vues           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  derniere_activite timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_portee CHECK (
       (portee = 'nationale'    AND region_admin_id IS NULL AND prefecture_id IS NULL)
    OR (portee = 'regionale'    AND region_admin_id IS NOT NULL)
    OR (portee = 'prefectorale' AND prefecture_id IS NOT NULL))
);
CREATE INDEX ix_forum_cat ON forum_discussion (categorie, derniere_activite DESC);
COMMENT ON COLUMN forum_discussion.portee IS 'La modération suit la zone : préfectoral, régional, Comité (catégorie comite), DG (R-FOR-02).';

CREATE TABLE forum_message (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  discussion_id bigint NOT NULL REFERENCES forum_discussion(id) ON DELETE CASCADE,
  auteur_id     bigint NOT NULL REFERENCES utilisateur(id),
  contenu       text NOT NULL,
  masque        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_forum_msg ON forum_message (discussion_id, created_at);

CREATE TABLE forum_signalement (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id  bigint NOT NULL REFERENCES forum_message(id) ON DELETE CASCADE,
  signale_par bigint NOT NULL REFERENCES utilisateur(id),
  motif       text NOT NULL,
  signale_le  timestamptz NOT NULL DEFAULT now(),
  traite_par  bigint REFERENCES utilisateur(id),
  traite_le   timestamptz,
  decision    text CHECK (decision IN ('conserve','masque','supprime')),
  UNIQUE (message_id, signale_par)
);
CREATE INDEX ix_forum_signal_file ON forum_signalement (signale_le) WHERE traite_le IS NULL;
COMMENT ON TABLE forum_signalement IS 'Signalements traités sous 48 h (R-FOR-03).';

-- ---------------------------------------------------------------------
-- 9. PILOTAGE : LITIGES, ALERTES, NOTIFICATIONS, RAPPORTS
-- ---------------------------------------------------------------------
CREATE TABLE litige (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  objet          text NOT NULL,
  prefecture_id  smallint NOT NULL REFERENCES prefecture(id),
  ouvert_par     bigint NOT NULL REFERENCES utilisateur(id),
  praticien_id   bigint REFERENCES praticien(id),
  statut         text NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert','en_arbitrage','resolu')),
  decision       text,
  decide_par     bigint REFERENCES utilisateur(id),
  decide_le      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_litige_resolu CHECK (statut <> 'resolu' OR (decision IS NOT NULL AND decide_par IS NOT NULL AND decide_le IS NOT NULL))
);
CREATE INDEX ix_litige_file ON litige (prefecture_id, statut);
CREATE TABLE litige_piece (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  litige_id   bigint NOT NULL REFERENCES litige(id) ON DELETE CASCADE,
  fichier_url text NOT NULL,
  depose_par  bigint NOT NULL REFERENCES utilisateur(id),
  depose_le   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE litige_message (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  litige_id   bigint NOT NULL REFERENCES litige(id) ON DELETE CASCADE,
  auteur_id   bigint NOT NULL REFERENCES utilisateur(id),
  contenu     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE litige IS 'Arbitrés par l''Admin régional, décision motivée (R-MOD-01).';

CREATE TABLE alerte_territoriale (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type             text NOT NULL CHECK (type IN ('hausse_pathologie','desert_therapeutique','dossier_bloque')),
  region_admin_id  smallint NOT NULL REFERENCES region_admin(id),
  prefecture_id    smallint REFERENCES prefecture(id),
  maladie_id       bigint REFERENCES maladie(id),
  description      text NOT NULL,
  statut           text NOT NULL DEFAULT 'nouvelle' CHECK (statut IN ('nouvelle','accusee','relancee','close')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  accusee_le       timestamptz
);
CREATE INDEX ix_alerte_region ON alerte_territoriale (region_admin_id, statut);

CREATE TABLE notification (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  destinataire_id bigint NOT NULL REFERENCES utilisateur(id),
  canal           text NOT NULL CHECK (canal IN ('email','sms','application')),
  modele          text NOT NULL,
  objet_type      text NOT NULL,
  objet_id        text,
  statut          text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','envoyee','echec')),
  tentatives      smallint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  envoyee_le      timestamptz
);
CREATE INDEX ix_notification_file ON notification (created_at) WHERE statut = 'en_attente';
COMMENT ON TABLE notification IS 'E-mail et SMS à chaque transition, décision et alerte (R-CER-05, R-MOD-04).';

CREATE TABLE rapport_export (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type           text NOT NULL,
  format         text NOT NULL CHECK (format IN ('pdf','xlsx','csv','json')),
  periode_debut  date,
  periode_fin    date,
  demande_par    bigint NOT NULL REFERENCES utilisateur(id),
  fichier_url    text,
  statut         text NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours','pret','echec')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 10. SERVICES : BOUTIQUE, PAIEMENTS, PARTENAIRES, FORMATION
-- ---------------------------------------------------------------------
CREATE TABLE paiement (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operateur            text NOT NULL CHECK (operateur IN ('orange_money','mtn_momo')),
  reference_operateur  text UNIQUE,
  montant_gnf          integer NOT NULL CHECK (montant_gnf > 0),
  objet_type           text NOT NULL CHECK (objet_type IN ('abonnement','commande')),
  payeur_id            bigint NOT NULL REFERENCES utilisateur(id),
  statut               text NOT NULL DEFAULT 'initie' CHECK (statut IN ('initie','reussi','echoue','rembourse')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  confirme_le          timestamptz
);
ALTER TABLE abonnement ADD CONSTRAINT fk_abonnement_paiement FOREIGN KEY (paiement_id) REFERENCES paiement(id);
COMMENT ON TABLE paiement IS 'Orange Money et MTN MoMo (R-MOD-06).';

CREATE TABLE produit (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  praticien_id  bigint NOT NULL REFERENCES praticien(id),
  nom           text NOT NULL,
  description_fr text,
  prix_gnf      integer NOT NULL CHECK (prix_gnf > 0),
  stock         integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  statut        text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','en_validation','publie','rupture')),
  valide_par    bigint REFERENCES utilisateur(id),
  CONSTRAINT ck_produit_valide CHECK (statut NOT IN ('publie','rupture') OR valide_par IS NOT NULL)
);
COMMENT ON TABLE produit IS 'Validation scientifique avant publication (R-MOD-05).';

CREATE TABLE commande (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  acheteur_id     bigint NOT NULL REFERENCES utilisateur(id),
  produit_id      bigint NOT NULL REFERENCES produit(id),
  quantite        integer NOT NULL CHECK (quantite > 0),
  montant_gnf     integer NOT NULL CHECK (montant_gnf > 0),
  commission_gnf  integer NOT NULL CHECK (commission_gnf >= 0),
  paiement_id     bigint REFERENCES paiement(id),
  statut          text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','payee','expediee','livree','annulee')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_commission CHECK (commission_gnf = round(montant_gnf * 0.10))
);
COMMENT ON COLUMN commande.commission_gnf IS 'Commission SABOU de 10 % (CdC §9).';

CREATE TABLE partenaire (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  nom             text NOT NULL,
  type            text NOT NULL,
  statut          text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','suspendu')),
  quota_mensuel   integer NOT NULL DEFAULT 100000 CHECK (quota_mensuel > 0)
);
CREATE TABLE cle_api (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  partenaire_id bigint NOT NULL REFERENCES partenaire(id),
  prefixe       text NOT NULL UNIQUE,
  empreinte     char(64) NOT NULL CHECK (empreinte ~ '^[0-9a-f]{64}$'),
  creee_le      timestamptz NOT NULL DEFAULT now(),
  expire_le     timestamptz NOT NULL,
  revoquee_le   timestamptz
);
COMMENT ON TABLE cle_api IS 'Seule l''empreinte de la clé est stockée ; rotation par expiration (R-MOD-07).';

CREATE TABLE formation_module (
  id              smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  titre_fr        text NOT NULL,
  titre_en        text,
  description_fr  text
);
CREATE TABLE attestation (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero        text NOT NULL UNIQUE,
  praticien_id  bigint NOT NULL REFERENCES praticien(id),
  module_id     smallint NOT NULL REFERENCES formation_module(id),
  delivree_le   date NOT NULL DEFAULT current_date,
  UNIQUE (praticien_id, module_id)
);

-- ---------------------------------------------------------------------
-- 11. SITE PUBLIC PILOTÉ : MENUS, SLIDERS, PUBLICATIONS
-- ---------------------------------------------------------------------
CREATE TABLE menu_site (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  emplacement text NOT NULL CHECK (emplacement IN ('header','footer')),
  chemin      text NOT NULL,
  ordre       smallint NOT NULL,
  visible     boolean NOT NULL DEFAULT true,
  UNIQUE (emplacement, ordre) DEFERRABLE INITIALLY DEFERRED   -- permet d'échanger deux ordres
);
CREATE OR REPLACE FUNCTION trg_menu_header_max() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM menu_site WHERE emplacement = 'header' AND visible) > 7 THEN
    RAISE EXCEPTION 'Le header est limité à 7 entrées visibles (CdC §5.1)';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_menu_header_max AFTER INSERT OR UPDATE ON menu_site
  FOR EACH STATEMENT EXECUTE FUNCTION trg_menu_header_max();

CREATE TABLE menu_site_i18n (
  menu_id     smallint NOT NULL REFERENCES menu_site(id) ON DELETE CASCADE,
  langue_code text NOT NULL REFERENCES langue(code),
  libelle     text NOT NULL,
  PRIMARY KEY (menu_id, langue_code)
);
CREATE TRIGGER trg_menu_langue BEFORE INSERT OR UPDATE ON menu_site_i18n
  FOR EACH ROW EXECUTE FUNCTION trg_ck_langue_usage('langue_code', 'texte');

CREATE TABLE slide (
  id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_url  text NOT NULL,
  lien       text,
  ordre      smallint NOT NULL UNIQUE,
  visible    boolean NOT NULL DEFAULT true
);
CREATE TABLE slide_i18n (
  slide_id    smallint NOT NULL REFERENCES slide(id) ON DELETE CASCADE,
  langue_code text NOT NULL REFERENCES langue(code),
  titre       text NOT NULL,
  texte       text,
  bouton      text,
  alt_text    text NOT NULL,
  PRIMARY KEY (slide_id, langue_code)
);
CREATE TRIGGER trg_slide_langue BEFORE INSERT OR UPDATE ON slide_i18n
  FOR EACH ROW EXECUTE FUNCTION trg_ck_langue_usage('langue_code', 'texte');

CREATE TABLE publication_site (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  publie_par  bigint NOT NULL REFERENCES utilisateur(id),
  publie_le   timestamptz NOT NULL DEFAULT now(),
  contenu     jsonb NOT NULL
);
COMMENT ON TABLE publication_site IS 'Historique des publications des menus et sliders (instantané) (R-SIT-03).';

-- ---------------------------------------------------------------------
-- 12. TRAÇABILITÉ
-- ---------------------------------------------------------------------
CREATE TABLE journal_audit (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  utilisateur_id bigint REFERENCES utilisateur(id),
  action         text NOT NULL,
  objet_type     text NOT NULL,
  objet_id       text,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_objet ON journal_audit (objet_type, objet_id, created_at DESC);
CREATE INDEX ix_audit_user  ON journal_audit (utilisateur_id, created_at DESC);
CREATE INDEX ix_audit_time_brin ON journal_audit USING brin (created_at);

CREATE OR REPLACE FUNCTION trg_audit_ajout_seul() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Le journal d''audit est en ajout seul (R-DON-02)'; END $$;
CREATE TRIGGER trg_audit_ajout_seul BEFORE UPDATE OR DELETE ON journal_audit
  FOR EACH ROW EXECUTE FUNCTION trg_audit_ajout_seul();

-- ---------------------------------------------------------------------
-- 13. WORKFLOWS
-- ---------------------------------------------------------------------
-- Transition d'un dossier de certification : responsable et zone contrôlés,
-- aucune étape sautée, rejet = retour à l'étape précédente (R-CER-01 à 05).
CREATE OR REPLACE FUNCTION dossier_transition(p_dossier bigint, p_decision text, p_acteur bigint, p_motif text DEFAULT NULL)
RETURNS smallint LANGUAGE plpgsql AS $$
DECLARE v_dos     dossier_certification%ROWTYPE;
        v_usr     utilisateur%ROWTYPE;
        v_pra     praticien%ROWTYPE;
        v_region  smallint;
        v_arrivee smallint;
BEGIN
  SELECT * INTO v_dos FROM dossier_certification WHERE id = p_dossier FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dossier % introuvable', p_dossier; END IF;
  IF v_dos.statut <> 'en_cours' THEN RAISE EXCEPTION 'Dossier % clos (%)', v_dos.code, v_dos.statut; END IF;

  SELECT * INTO v_usr FROM utilisateur WHERE id = p_acteur AND statut = 'actif';
  IF NOT FOUND THEN RAISE EXCEPTION 'Acteur % inconnu ou suspendu', p_acteur; END IF;
  SELECT * INTO v_pra FROM praticien WHERE id = v_dos.praticien_id;
  SELECT region_admin_id INTO v_region FROM prefecture WHERE id = v_pra.prefecture_id;

  IF p_decision = 'rejet_definitif' THEN
    IF v_usr.role_code <> 'dg' THEN RAISE EXCEPTION 'Le rejet définitif est réservé à la Direction Générale'; END IF;
    v_arrivee := v_dos.etape_courante;
  ELSE
    -- COALESCE : une zone absente (NULL) vaut refus, jamais autorisation
    IF NOT COALESCE(CASE v_dos.etape_courante
             WHEN 1 THEN v_usr.id = v_pra.utilisateur_id
             WHEN 2 THEN v_usr.role_code = 'prefectoral' AND v_usr.prefecture_id = v_pra.prefecture_id
             WHEN 3 THEN v_usr.role_code = 'regional' AND v_usr.region_admin_id = v_region
             WHEN 4 THEN v_usr.role_code = 'scientifique'
             ELSE v_usr.role_code = 'dg'
           END, false) THEN
      RAISE EXCEPTION 'Acteur % non habilité pour l''étape % du dossier %', p_acteur, v_dos.etape_courante, v_dos.code;
    END IF;
    v_arrivee := CASE
      WHEN p_decision = 'soumis' AND v_dos.etape_courante = 1             THEN 2
      WHEN p_decision = 'valide' AND v_dos.etape_courante BETWEEN 2 AND 5 THEN v_dos.etape_courante + 1
      WHEN p_decision = 'rejete' AND v_dos.etape_courante BETWEEN 2 AND 5 THEN v_dos.etape_courante - 1
      WHEN p_decision = 'publie' AND v_dos.etape_courante = 6             THEN 6
    END;
    IF v_arrivee IS NULL THEN
      RAISE EXCEPTION 'Décision « % » impossible à l''étape % du dossier %', p_decision, v_dos.etape_courante, v_dos.code;
    END IF;
  END IF;

  IF p_decision = 'valide' AND v_dos.etape_courante = 2 AND v_dos.visite_requise AND NOT EXISTS (
       SELECT 1 FROM visite_terrain vt WHERE vt.dossier_id = v_dos.id AND vt.statut = 'realisee') THEN
    RAISE EXCEPTION 'Dossier % : visite terrain signée requise avant validation (R-CER-06)', v_dos.code;
  END IF;
  IF p_decision = 'publie' AND NOT EXISTS (
       SELECT 1 FROM certificat c WHERE c.dossier_id = v_dos.id AND c.statut = 'actif') THEN
    RAISE EXCEPTION 'Dossier % : certificat signé requis avant publication', v_dos.code;
  END IF;

  INSERT INTO dossier_historique (dossier_id, etape_depart, etape_arrivee, decision, motif, acteur_id)
  VALUES (v_dos.id, v_dos.etape_courante, v_arrivee, p_decision, p_motif, p_acteur);

  UPDATE dossier_certification
     SET etape_courante  = v_arrivee,
         etape_entree_le = now(),
         statut     = CASE p_decision WHEN 'publie' THEN 'approuve' WHEN 'rejet_definitif' THEN 'rejete_definitif' ELSE 'en_cours' END,
         cloture_le = CASE WHEN p_decision IN ('publie','rejet_definitif') THEN now() END
   WHERE id = v_dos.id;

  IF p_decision = 'publie' THEN
    UPDATE praticien SET statut = 'certifie' WHERE id = v_pra.id;
    UPDATE recette SET statut = 'certifiee' WHERE dossier_id = v_dos.id AND statut = 'expertisee';
  ELSIF p_decision = 'rejet_definitif' THEN
    UPDATE praticien SET statut = 'rejete' WHERE id = v_pra.id;
  END IF;

  INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id)
  VALUES (v_pra.utilisateur_id, 'sms', 'dossier.' || p_decision, 'dossier', v_dos.code);
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'dossier.' || p_decision, 'dossier', v_dos.code,
          jsonb_build_object('de', v_dos.etape_courante, 'vers', v_arrivee, 'motif', p_motif));
  RETURN v_arrivee;
END $$;

-- Transition d'un traitement : Brouillon → Soumis → Transmis → Expertisé → Certifié ;
-- rejet = étape précédente avec motif ; suspension et retrait (R-REC-07, R-SAN-03).
CREATE OR REPLACE FUNCTION recette_transition(p_recette bigint, p_vers text, p_acteur bigint, p_motif text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_rec           recette%ROWTYPE;
        v_usr           utilisateur%ROWTYPE;
        v_prat_user     bigint;
        v_pref          smallint;
        v_region        smallint;
        v_motif_requis  boolean;
BEGIN
  SELECT * INTO v_rec FROM recette WHERE id = p_recette FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement % introuvable', p_recette; END IF;
  SELECT * INTO v_usr FROM utilisateur WHERE id = p_acteur AND statut = 'actif';
  IF NOT FOUND THEN RAISE EXCEPTION 'Acteur % inconnu ou suspendu', p_acteur; END IF;
  SELECT pr.utilisateur_id, pr.prefecture_id, pf.region_admin_id INTO v_prat_user, v_pref, v_region
    FROM praticien pr JOIN prefecture pf ON pf.id = pr.prefecture_id WHERE pr.id = v_rec.praticien_id;

  SELECT bool_or(rg.motif_requis) INTO v_motif_requis
    FROM (VALUES
      ('brouillon', 'soumise',    'praticien',    false), ('brouillon', 'soumise',   'prefectoral',  false),
      ('soumise',   'transmise',  'regional',     false), ('soumise',   'brouillon', 'regional',     true),
      ('transmise', 'expertisee', 'scientifique', false), ('transmise', 'soumise',   'scientifique', true),
      ('expertisee','certifiee',  'dg',           false), ('expertisee','transmise', 'dg',           true),
      ('certifiee', 'suspendue',  'scientifique', true),  ('certifiee', 'suspendue', 'dg',           true),
      ('suspendue', 'certifiee',  'scientifique', false), ('suspendue', 'certifiee', 'dg',           false),
      ('certifiee', 'retiree',    'praticien',    false), ('suspendue', 'retiree',   'praticien',    false),
      ('certifiee', 'retiree',    'dg',           true),  ('suspendue', 'retiree',   'dg',           true)
    ) AS rg(de, vers, qui, motif_requis)
   WHERE rg.de = v_rec.statut AND rg.vers = p_vers AND rg.qui = v_usr.role_code
     AND (rg.qui <> 'praticien'   OR v_usr.id = v_prat_user)
     AND (rg.qui <> 'prefectoral' OR v_usr.prefecture_id = v_pref)
     AND (rg.qui <> 'regional'    OR v_usr.region_admin_id = v_region);

  IF v_motif_requis IS NULL THEN
    RAISE EXCEPTION 'Transition % → % interdite pour l''acteur % sur le traitement %', v_rec.statut, p_vers, p_acteur, v_rec.code;
  END IF;
  IF v_motif_requis AND COALESCE(btrim(p_motif), '') = '' THEN
    RAISE EXCEPTION 'Transition % → % : motif obligatoire', v_rec.statut, p_vers;
  END IF;

  UPDATE recette SET statut = p_vers WHERE id = v_rec.id;   -- trg_recette_publiable contrôle la certification
  INSERT INTO recette_historique (recette_id, statut_depart, statut_arrivee, motif, acteur_id)
  VALUES (v_rec.id, v_rec.statut, p_vers, p_motif, p_acteur);
  INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id)
  VALUES (v_prat_user, 'sms', 'recette.' || p_vers, 'recette', v_rec.code);
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'recette.' || p_vers, 'recette', v_rec.code, jsonb_build_object('de', v_rec.statut, 'motif', p_motif));
  RETURN p_vers;
END $$;

-- ---------------------------------------------------------------------
-- 14. LECTURE PUBLIQUE : RECHERCHE, PAGE TRAITEMENT, CERTIFICAT
-- ---------------------------------------------------------------------
-- Voix publiée d'un objet dans une langue, sinon en français (R-LNG-09)
CREATE OR REPLACE FUNCTION voix_plante(p_plante bigint, p_langue text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT a.chemin FROM plante_voix v JOIN audio_fichier a ON a.id = v.audio_id
   WHERE v.plante_id = p_plante AND v.statut = 'publie' AND v.langue_code IN (p_langue, 'fr')
   ORDER BY (v.langue_code = p_langue) DESC LIMIT 1
$$;
CREATE OR REPLACE FUNCTION voix_maladie(p_maladie bigint, p_langue text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT a.chemin FROM maladie_voix v JOIN audio_fichier a ON a.id = v.audio_id
   WHERE v.maladie_id = p_maladie AND v.statut = 'publie' AND v.langue_code IN (p_langue, 'fr')
   ORDER BY (v.langue_code = p_langue) DESC LIMIT 1
$$;

-- Recherche d'une maladie : la fiche, puis une ligne par traitement visible avec ses plantes (R-RCH-01 à 03)
CREATE OR REPLACE FUNCTION rechercher_maladie(p_terme text, p_langue text DEFAULT 'fr', p_connecte boolean DEFAULT false)
RETURNS TABLE (maladie_code text, nom_maladie text, voix_maladie text, recette_id bigint, recette_code text,
               titre text, cycle_jours smallint, cycle_pause_jours smallint, note numeric, nb_plantes integer, plantes jsonb)
LANGUAGE sql STABLE AS $$
  WITH termes AS (
    SELECT ma.id AS maladie_id, ma.nom_fr AS t FROM maladie ma
    UNION ALL SELECT ma.id, ma.nom_en FROM maladie ma WHERE ma.nom_en IS NOT NULL
    UNION ALL SELECT md.maladie_id, md.denomination FROM maladie_denomination md),
  m AS (
    SELECT tr.maladie_id, max(similarity(f_norm(tr.t), f_norm(p_terme))) AS score
      FROM termes tr
     WHERE f_norm(tr.t) % f_norm(p_terme) OR f_norm(tr.t) LIKE '%' || f_norm(p_terme) || '%'
     GROUP BY tr.maladie_id)
  SELECT ma.code,
         CASE WHEN p_langue = 'en' THEN COALESCE(ma.nom_en, ma.nom_fr) ELSE ma.nom_fr END,
         voix_maladie(ma.id, p_langue),
         r.id, r.code,
         CASE WHEN p_langue = 'en' THEN COALESCE(r.titre_en, r.titre_fr) ELSE r.titre_fr END,
         r.cycle_duree_jours, r.cycle_pause_jours, r.note_moyenne,
         (SELECT count(*)::int FROM recette_plante rp WHERE rp.recette_id = r.id),
         (SELECT jsonb_agg(jsonb_build_object(
                   'plante_code', pl.code,
                   'nom', CASE WHEN p_langue = 'en' THEN COALESCE(pl.nom_en, pl.nom_fr) ELSE pl.nom_fr END,
                   'nom_scientifique', pl.nom_scientifique,
                   'partie', rp.partie_utilisee,
                   'voix', voix_plante(pl.id, p_langue),
                   'photo', pi.image_url) ORDER BY rp.ordre)
            FROM recette_plante rp
            JOIN plante pl ON pl.id = rp.plante_id
            LEFT JOIN plante_image pi ON pi.plante_id = pl.id AND pi.principale
           WHERE rp.recette_id = r.id)
    FROM m
    JOIN maladie ma ON ma.id = m.maladie_id
    LEFT JOIN recette r ON r.maladie_id = ma.id AND r.statut = 'certifiee'
                       AND (r.visibilite = 'publique' OR (p_connecte AND r.visibilite = 'restreinte'))
   ORDER BY m.score DESC, r.note_moyenne DESC NULLS LAST
$$;
COMMENT ON FUNCTION rechercher_maladie IS 'Recherche par nom français, anglais ou dénomination, sans accents, tolérante aux fautes ; une maladie sans traitement certifié renvoie une ligne sans recette.';

-- Recherche d'une plante par nom français, anglais, scientifique ou transcription de nom local (R-LNG-13, parcours §2.7)
CREATE OR REPLACE FUNCTION rechercher_plante(p_terme text, p_langue text DEFAULT 'fr')
RETURNS TABLE (plante_code text, nom_scientifique text, nom text, photo text, voix text, score real)
LANGUAGE sql STABLE AS $$
  WITH termes AS (
    SELECT pl.id AS plante_id, pl.nom_fr AS t FROM plante pl
    UNION ALL SELECT pl.id, pl.nom_en FROM plante pl WHERE pl.nom_en IS NOT NULL
    UNION ALL SELECT pl.id, pl.nom_scientifique FROM plante pl
    UNION ALL SELECT nl.plante_id, nl.transcription_recherche FROM plante_nom_local nl),
  s AS (
    SELECT tr.plante_id, max(similarity(f_norm(tr.t), f_norm(p_terme))) AS score
      FROM termes tr
     WHERE f_norm(tr.t) % f_norm(p_terme) OR f_norm(tr.t) LIKE '%' || f_norm(p_terme) || '%'
     GROUP BY tr.plante_id)
  SELECT pl.code, pl.nom_scientifique,
         CASE WHEN p_langue = 'en' THEN COALESCE(pl.nom_en, pl.nom_fr) ELSE pl.nom_fr END,
         pi.image_url, voix_plante(pl.id, p_langue), s.score
    FROM s JOIN plante pl ON pl.id = s.plante_id
    LEFT JOIN plante_image pi ON pi.plante_id = pl.id AND pi.principale
   WHERE pl.statut = 'validee'
   ORDER BY s.score DESC
   LIMIT 20
$$;

-- Page traitement : texte français (ou anglais) + voix de la langue demandée, repli sur la voix française (R-LNG-09)
CREATE OR REPLACE FUNCTION recette_page(p_recette bigint, p_langue text)
RETURNS TABLE (type_code text, libelle text, ordre smallint, texte text, langue_servie text,
               audio_chemin text, duree_sec numeric, traduction_en_cours boolean)
LANGUAGE sql STABLE AS $$
  SELECT s.type_code,
         CASE WHEN p_langue = 'en' THEN t.libelle_en ELSE t.libelle_fr END,
         t.ordre,
         CASE WHEN p_langue = 'en' THEN COALESCE(s.texte_en, s.texte_fr) ELSE s.texte_fr END,
         COALESCE(v.langue_code, vf.langue_code),
         COALESCE(a.chemin, af.chemin),
         COALESCE(a.duree_sec, af.duree_sec),
         (v.langue_code IS NULL AND COALESCE((SELECT l.voix FROM langue l WHERE l.code = p_langue), false) AND p_langue <> 'fr')
  FROM recette_section s
  JOIN section_type t ON t.code = s.type_code
  LEFT JOIN recette_section_voix v  ON v.section_id = s.id AND v.langue_code = p_langue AND v.statut = 'publie'
  LEFT JOIN audio_fichier a         ON a.id = v.audio_id
  LEFT JOIN recette_section_voix vf ON vf.section_id = s.id AND vf.langue_code = 'fr' AND vf.statut = 'publie'
  LEFT JOIN audio_fichier af        ON af.id = vf.audio_id
  WHERE s.recette_id = p_recette
  ORDER BY t.ordre
$$;
COMMENT ON FUNCTION recette_page IS 'traduction_en_cours = vrai quand la voix manque dans la langue choisie et que la voix française est proposée.';

-- Vérification d'un certificat : verdict vert / ambre / rouge (R-QR-05).
-- La signature Ed25519 est contrôlée par l'application (ou hors ligne) avec la clé publique renvoyée.
CREATE OR REPLACE FUNCTION verifier_certificat(p_numero text)
RETURNS TABLE (verdict text, numero text, praticien_code text, titulaire text, specialite text, prefecture text,
               emis_le date, expire_le date, empreinte_sha3 text, signature text, cle_publique text)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT CASE WHEN c.statut = 'revoque' OR k.revoquee_le IS NOT NULL THEN 'rouge'
              WHEN c.statut = 'expire' OR c.expire_le < current_date THEN 'ambre'
              ELSE 'vert' END,
         c.numero, pr.code, u.prenom || ' ' || u.nom, sp.libelle_fr, pf.nom,
         c.emis_le, c.expire_le, c.empreinte_sha3::text, c.signature, k.cle_publique
    FROM certificat c
    JOIN praticien pr     ON pr.id = c.praticien_id
    JOIN utilisateur u    ON u.id = pr.utilisateur_id
    JOIN specialite sp    ON sp.id = pr.specialite_id
    JOIN prefecture pf    ON pf.id = pr.prefecture_id
    JOIN cle_signature k  ON k.id = c.cle_id
   WHERE c.numero = p_numero;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'rouge'::text, p_numero, NULL::text, NULL::text, NULL::text, NULL::text,
                        NULL::date, NULL::date, NULL::text, NULL::text, NULL::text;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 15. VUES
-- ---------------------------------------------------------------------
-- Annuaire public : praticiens certifiés avec certificat actif (R-CER-08)
CREATE OR REPLACE VIEW v_annuaire_public AS
SELECT pr.id, pr.code, u.prenom, u.nom, sp.libelle_fr AS specialite, pf.nom AS prefecture, ra.nom AS region,
       pr.langue_principale, pr.annees_experience, pr.note_moyenne, pr.nb_avis, pr.nb_vues, pr.photo_url,
       (SELECT count(*) FROM recette r WHERE r.praticien_id = pr.id AND r.statut = 'certifiee' AND r.visibilite = 'publique') AS nb_recettes
FROM praticien pr
JOIN utilisateur u   ON u.id = pr.utilisateur_id
JOIN specialite sp   ON sp.id = pr.specialite_id
JOIN prefecture pf   ON pf.id = pr.prefecture_id
JOIN region_admin ra ON ra.id = pf.region_admin_id
WHERE pr.statut = 'certifie'
  AND EXISTS (SELECT 1 FROM certificat c WHERE c.praticien_id = pr.id AND c.statut = 'actif' AND c.expire_le >= current_date);

-- Témoignages publiés : prénom + initiale uniquement (R-TEM-06)
CREATE OR REPLACE VIEW v_temoignage_public AS
SELECT t.id, t.recette_id, r.praticien_id, u.prenom || ' ' || left(u.nom, 1) || '.' AS auteur,
       t.note, t.contenu, a.chemin AS audio, t.langue_code, t.created_at,
       CASE WHEN t.reponse_statut = 'publie' THEN t.reponse_praticien END AS reponse_praticien
FROM temoignage t
JOIN utilisateur u ON u.id = t.auteur_id
JOIN recette r     ON r.id = t.recette_id
LEFT JOIN audio_fichier a ON a.id = t.audio_id
WHERE t.statut = 'publie';

-- Couverture vocale par langue (tableau « Ressources linguistiques » de la DG)
CREATE OR REPLACE VIEW v_couverture_langue AS
SELECT l.code AS langue,
       count(*) FILTER (WHERE v.statut = 'publie') AS sections_voix_publiees,
       count(*)                                    AS sections_total,
       round(100.0 * count(*) FILTER (WHERE v.statut = 'publie') / NULLIF(count(*), 0), 1) AS couverture_pct
FROM langue l
CROSS JOIN (SELECT s.id FROM recette_section s JOIN recette r ON r.id = s.recette_id WHERE r.statut = 'certifiee') s
LEFT JOIN recette_section_voix v ON v.section_id = s.id AND v.langue_code = l.code
WHERE l.active AND l.voix
GROUP BY l.code;

-- Dossiers bloqués depuis plus de 15 jours (R-CER-07)
CREATE OR REPLACE VIEW v_dossiers_bloques AS
SELECT d.code, pr.code AS praticien, d.etape_courante, d.etape_entree_le,
       round(extract(epoch FROM now() - d.etape_entree_le) / 86400) AS jours_dans_etape
FROM dossier_certification d JOIN praticien pr ON pr.id = d.praticien_id
WHERE d.statut = 'en_cours' AND d.etape_entree_le < now() - interval '15 days';

-- ---------------------------------------------------------------------
-- 16. CLOISONNEMENT PAR ZONE (Row-Level Security) — à activer avec l'application
-- ---------------------------------------------------------------------
-- L'application positionne le contexte à chaque requête :
--   SET LOCAL app.role = 'prefectoral'; SET LOCAL app.prefecture_id = '4'; SET LOCAL app.region_id = '4';
-- Exemple (non activé ici) :
--   ALTER TABLE praticien ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY zone_praticien ON praticien USING (
--        current_setting('app.role') IN ('dg','scientifique')
--     OR (current_setting('app.role') = 'prefectoral' AND prefecture_id = current_setting('app.prefecture_id')::smallint)
--     OR (current_setting('app.role') = 'regional' AND prefecture_id IN
--           (SELECT id FROM prefecture WHERE region_admin_id = current_setting('app.region_id')::smallint)));
