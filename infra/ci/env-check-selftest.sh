#!/usr/bin/env bash
# Contre-épreuve de env-check.sh : base arrêtée, l'API doit répondre 503 sans détail technique
# et son contrôle de santé doit passer au rouge ; base relancée, tout redevient vert.
# Suppose l'environnement démarré (env-check.sh) ; le laisse démarré en sortant.
source "$(dirname "$0")/env.sh"
source infra/ci/env-lib.sh

# Usage : wait_health service état  (60 s au plus)
wait_health() {
  for _ in $(seq 1 30); do
    [[ "$(compose ps --format '{{.Health}}' "$1")" == "$2" ]] && return 0
    sleep 2
  done
  return 1
}

# Quoi qu'il arrive, la base est relancée en sortant
trap 'compose start postgres >/dev/null 2>&1' EXIT

compose stop postgres
expect_ready 503 '{"status":"error","service":"api","database":"unavailable"}'

# Le contrôle de santé de l'API repère la panne (3 échecs à 5 s d'intervalle)
wait_health api unhealthy || {
  echo "ÉCHEC : base arrêtée, le contrôle de santé de l'API reste vert." >&2
  exit 1
}

compose start postgres
wait_health postgres healthy && wait_health api healthy || {
  echo "ÉCHEC : base relancée, l'API ne revient pas au vert." >&2
  exit 1
}
expect_ready 200 '{"status":"ok","service":"api","database":"ok"}'
echo "Contrôle de l'environnement : repère une base arrêtée, revient au vert ensuite."
