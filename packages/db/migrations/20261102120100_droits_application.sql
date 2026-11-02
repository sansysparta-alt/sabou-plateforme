-- Droits du rôle de l'API (sabou_app), moindre privilège (00_Conception_BDD_SABOU.md §6).
-- Le rôle est créé par l'infrastructure (infra/local/postgres/10-roles.sh en local),
-- jamais par une migration : son mot de passe n'a rien à faire dans le dépôt.
-- sabou_app lit et écrit les données, exécute les fonctions, mais ne modifie jamais
-- la structure (tables, fonctions, déclencheurs restent la propriété de sabou_migrator).
GRANT USAGE ON SCHEMA sabou TO sabou_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sabou TO sabou_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sabou TO sabou_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sabou TO sabou_app;

-- Journal d'audit en ajout seul (R-DON-02) : en plus du déclencheur, le droit n'est pas donné
REVOKE UPDATE, DELETE, TRUNCATE ON sabou.journal_audit FROM sabou_app;

-- Objets créés par les migrations suivantes : mêmes droits, sans avoir à les répéter
ALTER DEFAULT PRIVILEGES FOR ROLE sabou_migrator IN SCHEMA sabou
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sabou_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sabou_migrator IN SCHEMA sabou
  GRANT USAGE, SELECT ON SEQUENCES TO sabou_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sabou_migrator IN SCHEMA sabou
  GRANT EXECUTE ON FUNCTIONS TO sabou_app;
