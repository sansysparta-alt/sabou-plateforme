#!/usr/bin/env bash
# Vérifie les règles du dépôt qui portent les critères de US-001 :
# chaque application est lintée, testée et compilée ; le workflow se déclenche
# sur les demandes de fusion et sur main ; il n'appelle que des scripts de
# infra/ci/ ; actions et image Trivy sont épinglées par empreinte.
source "$(dirname "$0")/env.sh"

errors=0
fail() { echo "ÉCHEC : $1" >&2; errors=$((errors + 1)); }

# 1. Chaque paquet du monorepo définit build, lint et test
for manifest in apps/*/package.json packages/*/package.json; do
  [[ -f "$manifest" ]] || continue
  for script in build lint test; do
    node -e "process.exit(require('./$manifest').scripts?.['$script'] ? 0 : 1)" \
      || fail "$manifest : script « $script » manquant"
  done
done

for workflow in .github/workflows/*.yml; do
  # 2. Déclencheurs : demandes de fusion et push sur main
  grep -Eq '^  pull_request:' "$workflow" || fail "$workflow : pas de déclencheur pull_request"
  grep -Eq '^    branches: \[main\]' "$workflow" || fail "$workflow : pas de déclencheur push sur main"

  # 3. Actions épinglées par SHA complet (40 caractères hexadécimaux)
  while read -r ref; do
    [[ "$ref" =~ @[0-9a-f]{40}$ ]] || fail "$workflow : action non épinglée par SHA : $ref"
  done < <(grep -Eo 'uses: *[^ #]+' "$workflow" | sed 's/uses: *//')

  # 4. Les étapes ne font qu'appeler un script de infra/ci/
  while read -r cmd; do
    [[ "$cmd" =~ ^bash\ infra/ci/[a-z-]+\.sh$ ]] || fail "$workflow : commande hors infra/ci/ : $cmd"
  done < <(grep -Eo 'run: *.+' "$workflow" | sed 's/run: *//')
done

# 5. Image Trivy épinglée par empreinte sha256
grep -Eq 'aquasec/trivy@sha256:[0-9a-f]{64}"' infra/ci/audit.sh || fail "audit.sh : image Trivy non épinglée par empreinte"

if ((errors > 0)); then
  echo "$errors règle(s) non respectée(s)." >&2
  exit 1
fi
echo "Règles du dépôt respectées."
