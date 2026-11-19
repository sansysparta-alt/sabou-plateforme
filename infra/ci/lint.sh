#!/usr/bin/env bash
# Lint de chaque application puis vérification du formatage
source "$(dirname "$0")/env.sh"
pnpm run lint
pnpm run format:check
# Feuille de style des pages Keycloak : générée depuis ses sources, jamais modifiée à la main
node infra/local/keycloak/theme-css.mjs --check
