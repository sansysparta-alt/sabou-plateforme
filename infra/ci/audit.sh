#!/usr/bin/env bash
# Analyse des dépendances par Trivy : une faille critique fait échouer le pipeline.
# Usage : audit.sh [dossier]  (par défaut, la racine du dépôt)

# Dossier résolu avant env.sh, qui se place à la racine du dépôt
target="$(cd "${1:-$(dirname "$0")/../..}" && pwd)"
source "$(dirname "$0")/env.sh"
source infra/ci/trivy.sh

# Dépendances de développement comprises : elles s'exécutent dans le pipeline et sur les postes
trivy_fs "$target" --scanners vuln --include-dev-deps --severity CRITICAL --exit-code 1 \
  --skip-dirs node_modules
