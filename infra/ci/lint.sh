#!/usr/bin/env bash
# Lint de chaque application puis vérification du formatage
source "$(dirname "$0")/env.sh"
pnpm run lint
pnpm run format:check
