#!/usr/bin/env bash
# Application de gestion, de bout en bout (US-010) : environnement local complet (Keycloak,
# API, Valkey…), base migrée, application compilée, puis
#   1. tests Playwright des critères de connexion, axe (WCAG 2.2 AA) sur chaque écran ;
#   2. Lighthouse CI en 3G et processeur bridés, seuils bloquants (apps/admin/lighthouserc.cjs).
source "$(dirname "$0")/env.sh"

node infra/local/up.mjs up
# Schéma à jour : une connexion n'ouvre de session qu'une fois journalisée (US-030)
pnpm db:migrate
# L'application et ses dépendances du dépôt (@sabou/types)
pnpm --filter "@sabou/admin..." run build
if [[ -n "${CI:-}" ]]; then
  pnpm --filter @sabou/admin exec playwright install --with-deps chromium
else
  pnpm --filter @sabou/admin exec playwright install chromium
fi
pnpm --filter @sabou/admin run e2e
pnpm --filter @sabou/admin run lighthouse
