-- Journal d'audit de toutes les décisions et connexions (US-030, R-DON-02, R-ACC-05).
-- La table et son ajout seul existent depuis le schéma initial ; cette migration ajoute :
--   - l'adresse IP de la requête, posée par l'API pour la transaction en cours et reprise
--     par chaque ligne écrite dans cette transaction (décisions des fonctions de workflow) ;
--   - l'heure d'écriture imposée par la base : l'application ne choisit pas le « quand » ;
--   - la provenance des lignes et le compte Keycloak, pour les connexions ;
--   - le refus du vidage de la table, même par un rôle qui en aurait le droit.
SET search_path = sabou, public;

ALTER TABLE journal_audit
  -- « application » : écrit par l'API ou une fonction de la base ; « keycloak » : événement
  -- de connexion relevé dans Keycloak (échecs, blocages, double facteur)
  ADD COLUMN source         text NOT NULL DEFAULT 'application'
                            CHECK (source IN ('application','keycloak')),
  -- Identifiant du compte dans Keycloak (claim « sub ») : les connexions précèdent le lien
  -- entre compte Keycloak et utilisateur de la plateforme
  ADD COLUMN compte         text,
  -- Identifiant de l'événement dans Keycloak : chaque événement n'est versé qu'une fois
  ADD COLUMN ref_externe    text,
  -- Heure de l'événement à sa source (Keycloak) ; created_at reste l'heure d'écriture
  ADD COLUMN survenu_le     timestamptz,
  ADD CONSTRAINT ck_audit_keycloak
    CHECK ((source = 'keycloak') = (ref_externe IS NOT NULL AND survenu_le IS NOT NULL));

CREATE UNIQUE INDEX ux_audit_ref_externe ON journal_audit (source, ref_externe)
  WHERE ref_externe IS NOT NULL;
CREATE INDEX ix_audit_compte ON journal_audit (compte, created_at DESC) WHERE compte IS NOT NULL;
-- Point de reprise de la relève : dernier événement Keycloak versé
CREATE INDEX ix_audit_keycloak_survenu ON journal_audit (survenu_le DESC) WHERE source = 'keycloak';

COMMENT ON TABLE journal_audit IS 'Journal de toutes les décisions et connexions, en ajout seul (R-DON-02, R-ACC-05). Conservé sans limite en v1 : une purge éventuelle passera par une migration, jamais par l''application.';
COMMENT ON COLUMN journal_audit.ip IS 'Adresse de la requête ; à défaut, celle posée pour la transaction par audit_contexte().';

-- Contexte de la requête pour la transaction en cours : l'API l'appelle avant une décision.
-- Portée locale (set_config(..., true)) : il disparaît à la fin de la transaction et ne
-- passe jamais d'une requête à l'autre par le pool de connexions.
CREATE OR REPLACE FUNCTION audit_contexte(p_ip inet) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('sabou.audit_ip', coalesce(host(p_ip), ''), true);
$$;

-- Chaque ligne : IP de la transaction si la requête ne l'a pas donnée, heure de la base
CREATE OR REPLACE FUNCTION trg_audit_completer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.ip := coalesce(NEW.ip, nullif(current_setting('sabou.audit_ip', true), '')::inet);
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_audit_completer BEFORE INSERT ON journal_audit
  FOR EACH ROW EXECUTE FUNCTION trg_audit_completer();

-- Les déclencheurs par ligne ne voient pas TRUNCATE : refus au niveau de l'instruction
CREATE TRIGGER trg_audit_ajout_seul_vidage BEFORE TRUNCATE ON journal_audit
  FOR EACH STATEMENT EXECUTE FUNCTION trg_audit_ajout_seul();
