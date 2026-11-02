#!/usr/bin/env bash
# Compilation de chaque application (vérification des types comprise)
source "$(dirname "$0")/env.sh"
pnpm run build
