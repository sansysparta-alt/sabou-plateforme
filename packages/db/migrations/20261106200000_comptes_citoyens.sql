-- Comptes citoyens (lot D : US-014, 05_Choix_Techniques.md §2.25).
--   - Un citoyen s'inscrit avec son numéro de mobile guinéen, un prénom et un mot de passe :
--     ni nom ni adresse e-mail (décision du maître d'œuvre du 6 novembre 2026, données
--     minimales). Le mot de passe est gardé par Keycloak seul (domaine « sabou-public »).
--   - Les autres comptes gardent leur adresse e-mail et leur nom, obligatoires.
--   - Un numéro ne porte qu'un seul compte citoyen.
SET search_path = sabou, public;

-- Citoyens du jeu d'exemple sans numéro : un numéro fictif, stable, leur est donné
-- (aucune donnée réelle, comme pour keycloak_id au lot A)
UPDATE utilisateur SET telephone = '+2246' || lpad(id::text, 8, '0')
 WHERE role_code = 'citoyen' AND (telephone IS NULL OR telephone !~ '^\+2246[0-9]{8}$');

ALTER TABLE utilisateur
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN nom DROP NOT NULL,
  -- E-mail et nom restent exigés pour tout compte autre que citoyen
  ADD CONSTRAINT ck_identite_role CHECK (
    role_code = 'citoyen' OR (email IS NOT NULL AND nom IS NOT NULL)),
  -- Citoyen : numéro mobile guinéen au format international (+224, puis 9 chiffres
  -- commençant par 6, comme pour les praticiens), pas de zone
  ADD CONSTRAINT ck_citoyen CHECK (
    role_code <> 'citoyen' OR (
      telephone IS NOT NULL
      AND telephone ~ '^\+2246[0-9]{8}$'
      AND region_admin_id IS NULL
      AND prefecture_id IS NULL));

CREATE UNIQUE INDEX ux_utilisateur_telephone_citoyen
  ON utilisateur (telephone) WHERE role_code = 'citoyen';

COMMENT ON COLUMN utilisateur.telephone IS
  'Numéro au format international (+224…). Citoyen : mobile guinéen, unique parmi les citoyens ; ses 9 chiffres nationaux sont son identifiant de connexion dans le domaine Keycloak « sabou-public ».';
