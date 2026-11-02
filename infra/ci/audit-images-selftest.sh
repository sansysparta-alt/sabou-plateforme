#!/usr/bin/env bash
# Preuve automatisée que l'analyse des images bloque : audit-images.sh doit échouer sur une
# image qui contient une faille critique corrigeable et réussir sur une image saine.
# Images minuscules construites sur place (FROM scratch), sans rien télécharger.
source "$(dirname "$0")/env.sh"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"; docker image rm -f sabou-selftest:vulnerable sabou-selftest:clean >/dev/null 2>&1' EXIT

image() { # étiquette, version de lodash
  mkdir -p "$workdir/$1/node_modules/lodash"
  echo "{\"name\":\"lodash\",\"version\":\"$2\"}" >"$workdir/$1/node_modules/lodash/package.json"
  printf 'FROM scratch\nCOPY node_modules /app/node_modules\n' >"$workdir/$1/Dockerfile"
  docker build --quiet --tag "sabou-selftest:$1" "$workdir/$1" >/dev/null
}

# lodash 4.17.4 : CVE-2019-10744, gravité critique, corrigée en 4.17.12 ; 4.17.21 : saine
image vulnerable 4.17.4
image clean 4.17.21

if bash infra/ci/audit-images.sh sabou-selftest:vulnerable; then
  echo "ÉCHEC : une faille critique corrigeable n'a pas bloqué l'analyse des images." >&2
  exit 1
fi
bash infra/ci/audit-images.sh sabou-selftest:clean
echo "Analyse des images : bloque sur faille critique corrigeable, passe sinon."
