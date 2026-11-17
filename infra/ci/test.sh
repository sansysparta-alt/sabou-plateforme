#!/usr/bin/env bash
# Tests de chaque application
#   TEST_CONCURRENCY=2   paquets testés en même temps au plus (poste de 7 Go, mémoire saturée
#                        par Docker et l'éditeur : les processus de test n'arrivent plus à
#                        démarrer) ; par défaut, le réglage de turbo
source "$(dirname "$0")/env.sh"
if [[ -n "${TEST_CONCURRENCY:-}" ]]; then
  pnpm run test --concurrency="$TEST_CONCURRENCY"
else
  pnpm run test
fi
