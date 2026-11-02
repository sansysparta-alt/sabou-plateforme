#!/usr/bin/env bash
# Tests de chaque application
source "$(dirname "$0")/env.sh"
pnpm run test
