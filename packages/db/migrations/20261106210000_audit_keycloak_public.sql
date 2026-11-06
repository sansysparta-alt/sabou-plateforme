-- Échecs de connexion des citoyens au journal d'audit (lot D : US-014, R-ACC-05, §2.25).
-- Les événements du domaine Keycloak « sabou-public » ont leur propre source, donc leur
-- propre point de reprise de relève, distinct de celui du domaine « sabou » (US-030).
SET search_path = sabou, public;

ALTER TABLE journal_audit
  DROP CONSTRAINT journal_audit_source_check,
  ADD CONSTRAINT journal_audit_source_check
    CHECK (source IN ('application','keycloak','keycloak-public')),
  DROP CONSTRAINT ck_audit_keycloak,
  -- Tout événement relevé dans Keycloak porte son identifiant et son heure d'origine
  ADD CONSTRAINT ck_audit_keycloak
    CHECK ((source <> 'application') = (ref_externe IS NOT NULL AND survenu_le IS NOT NULL));

-- Point de reprise de la relève, par domaine
DROP INDEX ix_audit_keycloak_survenu;
CREATE INDEX ix_audit_keycloak_survenu ON journal_audit (source, survenu_le DESC)
  WHERE source <> 'application';

COMMENT ON COLUMN journal_audit.source IS
  '« application » : écrit par l''API ou une fonction de la base ; « keycloak » : événement de connexion du domaine des administrateurs ; « keycloak-public » : du domaine des citoyens.';
