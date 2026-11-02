#!/usr/bin/env bash
# Analyse des dépendances par Trivy : une faille critique fait échouer le pipeline.
# Usage : audit.sh [dossier]  (par défaut, la racine du dépôt)

# Dossier résolu avant env.sh, qui se place à la racine du dépôt
target="$(cd "${1:-$(dirname "$0")/../..}" && pwd)"
source "$(dirname "$0")/env.sh"

# Image épinglée par empreinte (version 0.76.1), et non par étiquette
TRIVY_IMAGE="aquasec/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c"
TRIVY_ARGS=(fs --scanners vuln --severity CRITICAL --exit-code 1 --skip-dirs node_modules)

if [[ -n "${TRIVY_BIN:-}" ]]; then
  # Poste sans Docker : binaire Trivy local, de la même version
  "$TRIVY_BIN" "${TRIVY_ARGS[@]}" "$target"
else
  # Sous Git Bash (Windows), Docker attend un chemin Windows
  mount="$target"
  if command -v cygpath > /dev/null; then mount="$(cygpath -m "$target")"; fi
  MSYS_NO_PATHCONV=1 docker run --rm \
    -v "$mount:/src:ro" \
    -v sabou-trivy-cache:/root/.cache/trivy \
    "$TRIVY_IMAGE" "${TRIVY_ARGS[@]}" /src
fi
