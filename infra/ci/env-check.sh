#!/usr/bin/env bash
# Critères de US-002, vérifiés de bout en bout :
# 1. la commande de démarrage lance PostgreSQL 17 + PostGIS, Keycloak, Valkey et SeaweedFS,
#    et leurs contrôles de santé sont verts ;
# 2. l'API répond et lit la base.
# Sur un poste neuf (ou dans l'intégration continue), .env est créé au premier lancement.
source "$(dirname "$0")/env.sh"
source infra/ci/env-lib.sh

node infra/local/up.mjs up

# 1. Chaque service attendu tourne et son contrôle de santé est vert
for service in postgres keycloak valkey seaweedfs api; do
  health="$(compose ps --format '{{.Health}}' "$service")"
  [[ "$health" == healthy ]] || {
    echo "ÉCHEC : service $service : état « ${health:-absent} » au lieu de « healthy »" >&2
    exit 1
  }
done
version="$(compose exec -T postgres psql -U postgres -d sabou -tAc \
  "SELECT current_setting('server_version_num')::int / 10000 || ' / ' || postgis_lib_version()")"
[[ "$version" == "17 / 3.6."* ]] || {
  echo "ÉCHEC : PostgreSQL 17 + PostGIS 3.6 attendus, trouvé : $version" >&2
  exit 1
}
echo "Services démarrés, contrôles de santé verts (PostgreSQL / PostGIS : $version)."

# 2. L'API répond et lit la base
expect_ready 200 '{"status":"ok","service":"api","database":"ok"}'
echo "L'API répond et lit la base."
