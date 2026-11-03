#!/usr/bin/env bash
# Initialisation du serveur PostgreSQL local, au premier démarrage seulement (volume vide).
# Rôles séparés, comme en production (00_Conception_BDD_SABOU.md, « Sécurité ») :
# - sabou_migrator : propriétaire de la base sabou, exécute les migrations (US-003) ;
# - sabou_app      : utilisé par l'API, sans aucun droit de structure ;
# - keycloak       : propriétaire de sa propre base, isolée de celle de SABOU ;
# - sabou_sync     : lecture du flux de réplication logique par PowerSync (US-004), limitée
#                    aux tables publiées ; aucun droit d'écriture ;
# - powersync_storage : propriétaire de la base de travail de PowerSync, isolée elle aussi.
# Les mots de passe viennent de .env (générés au hasard par infra/local/up.mjs).
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v migrator_password="$SABOU_MIGRATOR_PASSWORD" \
  -v app_password="$SABOU_APP_PASSWORD" \
  -v keycloak_password="$KEYCLOAK_DB_PASSWORD" \
  -v sync_password="$SABOU_SYNC_PASSWORD" \
  -v powersync_storage_password="$POWERSYNC_STORAGE_PASSWORD" <<'SQL'
CREATE ROLE sabou_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE sabou_app LOGIN PASSWORD :'app_password';
CREATE ROLE keycloak LOGIN PASSWORD :'keycloak_password';
-- REPLICATION ne donne accès à aucune table : les droits de lecture sont donnés par migration
CREATE ROLE sabou_sync LOGIN REPLICATION PASSWORD :'sync_password';
CREATE ROLE powersync_storage LOGIN PASSWORD :'powersync_storage_password';

ALTER DATABASE sabou OWNER TO sabou_migrator;
CREATE DATABASE keycloak OWNER keycloak;
CREATE DATABASE powersync OWNER powersync_storage;

-- Personne d'autre que son propriétaire ne se connecte à la base de Keycloak
REVOKE ALL ON DATABASE keycloak FROM PUBLIC;
REVOKE ALL ON DATABASE powersync FROM PUBLIC;
REVOKE ALL ON DATABASE sabou FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE sabou TO sabou_app;
GRANT CONNECT ON DATABASE sabou TO sabou_sync;
SQL

# PostGIS n'est pas une extension « de confiance » : seul le super-utilisateur peut la créer.
# Elle est donc installée ici, comme le ferait l'hébergeur, et non par les migrations.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname sabou <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
SQL
