#!/usr/bin/env bash
# Preuve automatisée que l'analyse du code bloque : semgrep.sh doit échouer sur un
# résultat de gravité haute et réussir sur le même code corrigé.
source "$(dirname "$0")/env.sh"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
mkdir "$workdir/vulnerable" "$workdir/clean"

# Requête en HTTP clair : règle react-insecure-request, gravité haute ; en HTTPS : aucun résultat
echo "export const load = () => fetch('http://example.com/donnees');" > "$workdir/vulnerable/load.ts"
echo "export const load = () => fetch('https://example.com/donnees');" > "$workdir/clean/load.ts"

if bash infra/ci/semgrep.sh "$workdir/vulnerable"; then
  echo "ÉCHEC : un résultat de gravité haute n'a pas bloqué l'analyse." >&2
  exit 1
fi
bash infra/ci/semgrep.sh "$workdir/clean"
echo "Analyse du code : bloque sur gravité haute, passe sinon."
