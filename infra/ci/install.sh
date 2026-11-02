#!/usr/bin/env bash
# Installe les dépendances exactement comme dans pnpm-lock.yaml
source "$(dirname "$0")/env.sh"
pnpm install --frozen-lockfile
