-- Gestion des comptes (lot A : US-012 et US-013, 05_Choix_Techniques.md §2.22).
--   - Keycloak est la seule source des mots de passe et du double facteur : leurs colonnes
--     disparaissent (aucune donnée réelle) ; la table garde rôle, zone et langues.
--   - Lien avec le compte Keycloak (keycloak_id, claim « sub » des jetons).
--   - Statut « invite » : compte préparé par la DG, en attente de l'acceptation du lien.
--   - Zone exigée et cohérente pour chaque rôle d'administration (R-ACC-02).
--   - Invitations à usage unique : seule l'empreinte SHA-256 du jeton est gardée.
SET search_path = sabou, public;

ALTER TABLE utilisateur
  DROP CONSTRAINT ck_mfa_admin,
  DROP CONSTRAINT ck_mfa_secret,
  DROP COLUMN mot_de_passe_hash,
  DROP COLUMN mfa_actif,
  DROP COLUMN mfa_secret_chiffre,
  ADD COLUMN keycloak_id uuid UNIQUE;

-- Les comptes du jeu d'exemple et ceux d'avant cette migration n'ont pas de compte
-- Keycloak connu : un identifiant fictif, stable, leur est donné (aucune donnée réelle)
UPDATE utilisateur SET keycloak_id = md5('sabou:' || email)::uuid WHERE keycloak_id IS NULL;

ALTER TABLE utilisateur
  DROP CONSTRAINT utilisateur_statut_check,
  ADD CONSTRAINT utilisateur_statut_check CHECK (statut IN ('invite','actif','suspendu')),
  -- Un compte invité n'a pas encore de compte Keycloak ; tout autre compte en a un
  ADD CONSTRAINT ck_compte_keycloak CHECK ((statut = 'invite') = (keycloak_id IS NULL)),
  DROP CONSTRAINT ck_zone_regional,
  DROP CONSTRAINT ck_zone_prefectoral,
  -- Une seule zone, celle du rôle : nationale pour la DG et le Comité, une région pour
  -- l'admin régional, une préfecture pour l'admin préfectoral (R-ACC-02)
  ADD CONSTRAINT ck_zone_role CHECK (
    CASE role_code
      WHEN 'regional'    THEN region_admin_id IS NOT NULL AND prefecture_id IS NULL
      WHEN 'prefectoral' THEN prefecture_id IS NOT NULL AND region_admin_id IS NULL
      WHEN 'dg'          THEN region_admin_id IS NULL AND prefecture_id IS NULL
      WHEN 'scientifique' THEN region_admin_id IS NULL AND prefecture_id IS NULL
      ELSE NOT (region_admin_id IS NOT NULL AND prefecture_id IS NOT NULL)
    END);

COMMENT ON COLUMN utilisateur.keycloak_id IS
  'Identifiant du compte dans Keycloak (claim « sub »), seule source du mot de passe et du double facteur. NULL tant que l''invitation n''est pas acceptée.';

CREATE TABLE invitation (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  utilisateur_id  bigint NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
  -- Empreinte SHA-256 du jeton du lien : une copie de la base ne donne aucun lien utilisable
  jeton_empreinte bytea NOT NULL UNIQUE CHECK (octet_length(jeton_empreinte) = 32),
  expire_le       timestamptz NOT NULL,
  utilisee_le     timestamptz,
  cree_par        bigint REFERENCES utilisateur(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_invitation_utilisee CHECK (utilisee_le IS NULL OR utilisee_le <= expire_le)
);
CREATE INDEX ix_invitation_utilisateur ON invitation (utilisateur_id);
COMMENT ON TABLE invitation IS
  'Lien d''invitation à usage unique, valable 72 h, que la DG transmet elle-même (US-012).';
