# Lancement de Trivy commun aux analyses (à sourcer après env.sh, pas à exécuter).
# Image épinglée par empreinte (version 0.76.1) ; sur un poste sans Docker, TRIVY_BIN
# désigne un binaire local de la même version. L'intégration continue utilise toujours l'image.
TRIVY_IMAGE="aquasec/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c"

_trivy_docker() {
  MSYS_NO_PATHCONV=1 docker run --rm -v sabou-trivy-cache:/root/.cache/trivy "$@"
}

# Usage : trivy_fs dossier arguments…   (analyse d'un dossier, monté en lecture seule)
trivy_fs() {
  local target="$1"
  shift
  if [[ -n "${TRIVY_BIN:-}" ]]; then
    "$TRIVY_BIN" fs "$@" "$target"
    return
  fi
  # Sous Git Bash (Windows), Docker attend un chemin Windows
  if command -v cygpath >/dev/null; then target="$(cygpath -m "$target")"; fi
  _trivy_docker -v "$target:/src:ro" "$TRIVY_IMAGE" fs "$@" /src
}

# Usage : trivy_image image arguments…   (image présente sur le poste, lue par le socket Docker)
# Les exceptions de infra/ci/trivyignore.yaml s'appliquent toujours.
trivy_image() {
  local image="$1" ignorefile="infra/ci/trivyignore.yaml"
  shift
  if [[ -n "${TRIVY_BIN:-}" ]]; then
    "$TRIVY_BIN" image --ignorefile "$ignorefile" "$@" "$image"
    return
  fi
  local mount="$PWD/$ignorefile"
  if command -v cygpath >/dev/null; then mount="$(cygpath -m "$mount")"; fi
  _trivy_docker -v /var/run/docker.sock:/var/run/docker.sock -v "$mount:/trivyignore.yaml:ro" \
    "$TRIVY_IMAGE" image --ignorefile /trivyignore.yaml "$@" "$image"
}
