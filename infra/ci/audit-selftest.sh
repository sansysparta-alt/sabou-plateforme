#!/usr/bin/env bash
# Preuve automatisée que l'analyse des dépendances bloque : audit.sh doit
# échouer sur une dépendance à faille critique et réussir sur une dépendance saine.
source "$(dirname "$0")/env.sh"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

lockfile() { # nom de dossier, version de lodash
  mkdir -p "$workdir/$1"
  cat > "$workdir/$1/package-lock.json" <<JSON
{"name":"selftest","lockfileVersion":3,"requires":true,"packages":{"":{"name":"selftest","dependencies":{"lodash":"$2"}},"node_modules/lodash":{"version":"$2"}}}
JSON
}

# lodash 4.17.4 : CVE-2019-10744, gravité critique ; 4.17.21 : aucune faille critique connue
lockfile vulnerable 4.17.4
lockfile clean 4.17.21

if bash infra/ci/audit.sh "$workdir/vulnerable"; then
  echo "ÉCHEC : une faille critique n'a pas bloqué l'analyse." >&2
  exit 1
fi
bash infra/ci/audit.sh "$workdir/clean"
echo "Analyse des dépendances : bloque sur faille critique, passe sinon."
