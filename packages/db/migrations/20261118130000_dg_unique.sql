-- US-024 : un seul compte DG, récupérable par l'administrateur technique (décisions du maître
-- d'ouvrage du 17 et du 18 novembre 2026).
-- - La base refuse un second compte DG actif (index unique partiel) : une ancienne invitation
--   de DG encore en attente est refusée à l'activation ; la DG ne peut plus inviter de compte
--   DG (l'API ne propose plus ce rôle).
-- - Les réinitialisations faites par l'exploitation (pnpm dg:reinitialiser) sont journalisées
--   avec la source « exploitation » : qui (opérateur), quand, pourquoi (motif obligatoire).
SET search_path = sabou, public;

-- Bases de test qui portent plusieurs DG actives (comptes d'essai créés avant cette règle) :
-- seule la plus récente (celle qui sert) reste active. Sans effet sur une base qui n'en a qu'une.
UPDATE utilisateur u SET statut = 'suspendu'
 WHERE u.role_code = 'dg' AND u.statut = 'actif'
   AND u.id <> (SELECT max(id) FROM utilisateur WHERE role_code = 'dg' AND statut = 'actif');

CREATE UNIQUE INDEX ux_utilisateur_dg_unique ON utilisateur ((true))
  WHERE role_code = 'dg' AND statut = 'actif';
COMMENT ON INDEX ux_utilisateur_dg_unique IS
  'Un seul compte DG actif (US-024) ; sa récupération passe par pnpm dg:reinitialiser.';

ALTER TABLE journal_audit
  DROP CONSTRAINT journal_audit_source_check,
  ADD CONSTRAINT journal_audit_source_check
    CHECK (source IN ('application','keycloak','keycloak-public','exploitation')),
  -- Seuls les événements relevés dans Keycloak portent un identifiant et une heure d'origine
  DROP CONSTRAINT ck_audit_keycloak,
  ADD CONSTRAINT ck_audit_keycloak
    CHECK ((source IN ('keycloak','keycloak-public')) = (ref_externe IS NOT NULL AND survenu_le IS NOT NULL));
-- Une ligne de l'exploitation dit toujours qui a agi et pourquoi
ALTER TABLE journal_audit
  ADD CONSTRAINT ck_audit_exploitation CHECK (
    source <> 'exploitation'
    OR (length(trim(coalesce(details->>'operateur', ''))) >= 2
        AND length(trim(coalesce(details->>'motif', ''))) >= 10));
