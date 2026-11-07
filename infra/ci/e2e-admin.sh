#!/usr/bin/env bash
# Application de gestion, de bout en bout (US-010) : environnement local complet (Keycloak,
# API, Valkey…), base migrée, application compilée, puis
#   1. tests Playwright des critères de connexion, axe (WCAG 2.2 AA) sur chaque écran ;
#   2. Lighthouse CI en 3G et processeur bridés, seuils bloquants (apps/admin/lighthouserc.cjs) ;
#   3. compte citoyen du site public (lot D : US-014) : tests Playwright des critères avec axe,
#      puis Lighthouse CI (apps/site/lighthouserc.cjs).
source "$(dirname "$0")/env.sh"

# En cas d'échec, les dernières lignes des journaux de l'API et du stockage : la cause d'une
# réponse 500 n'apparaît que là
dump_logs() {
  local status=$?
  if ((status != 0)); then
    docker compose -p sabou logs --no-color --tail=80 api seaweedfs >&2 || true
  fi
  return "$status"
}
trap dump_logs EXIT

node infra/local/up.mjs up
# Schéma à jour : une connexion n'ouvre de session qu'une fois journalisée (US-030)
pnpm db:migrate
# Comptes et praticiens du jeu d'exemple fictif (les référentiels viennent des migrations)
pnpm db:seed --if-empty
# L'application et ses dépendances du dépôt (@sabou/types)
pnpm --filter "@sabou/admin..." run build
if [[ -n "${CI:-}" ]]; then
  pnpm --filter @sabou/admin exec playwright install --with-deps chromium
else
  pnpm --filter @sabou/admin exec playwright install chromium
fi
pnpm --filter @sabou/admin run e2e
pnpm --filter @sabou/admin run lighthouse

# Site public : compte citoyen (domaine Keycloak « sabou-public », SMS factice lu dans le
# journal de l'API). Même Chromium que ci-dessus (version de @playwright/test du dépôt).
pnpm --filter "@sabou/site..." run build
pnpm --filter @sabou/site run e2e:compte
pnpm --filter @sabou/site run lighthouse
