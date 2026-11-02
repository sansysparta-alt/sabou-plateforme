#!/usr/bin/env bash
# Tests de bout en bout du site (Playwright, Chromium). Le site doit être compilé (build.sh).
# Version de Chromium fixée par celle de @playwright/test dans pnpm-lock.yaml.
source "$(dirname "$0")/env.sh"
if [[ -n "${CI:-}" ]]; then
  # Intégration continue (Ubuntu) : bibliothèques système de Chromium comprises
  pnpm --filter @sabou/site exec playwright install --with-deps chromium
else
  pnpm --filter @sabou/site exec playwright install chromium
fi
pnpm --filter @sabou/site run e2e
