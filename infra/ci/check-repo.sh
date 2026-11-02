#!/usr/bin/env bash
# Vérifie les règles du dépôt qui portent les critères de US-001 :
# chaque application est lintée, testée et compilée ; le workflow se déclenche
# sur les demandes de fusion et sur main ; il n'appelle que des scripts de
# infra/ci/ ; actions et image Trivy sont épinglées par empreinte.
# Usage : check-repo.sh [manifeste racine], package.json par défaut (autre valeur : contre-épreuve).
source "$(dirname "$0")/env.sh"
root_manifest="${1:-package.json}"

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

# 5. Image Trivy épinglée par empreinte sha256 ; images Docker du projet aussi (check-pins.sh)
grep -Eq 'aquasec/trivy@sha256:[0-9a-f]{64}"' infra/ci/trivy.sh || fail "trivy.sh : image Trivy non épinglée par empreinte"
bash infra/ci/check-pins.sh >/dev/null || fail "images Docker non épinglées (détail ci-dessus)"
grep -Eq "'arigaio/atlas@sha256:[0-9a-f]{64}'" packages/db/src/atlas.ts || fail "atlas.ts : image Atlas non épinglée par empreinte"

# 6. Aucun script racine ne porte le nom d'une commande intégrée de pnpm : « pnpm <nom> »
# lancerait la commande au lieu du script (cas de « pnpm pipeline » depuis pnpm 12).
# Liste lue dans l'aide de la version de pnpm installée, alias compris. Exceptions : les
# commandes qui exécutent le script du même nom (test, start, stop, restart) ou lui cèdent
# la place (clean, purge, tasks).
builtins="$(pnpm help 2>/dev/null | awk '
  /^Commands:/ { in_list = 1; next }
  in_list && /^$/ { exit }
  in_list && /^  [a-z]/ {
    print $1
    if (match($0, /\[alias(es)?: [^]]+\]/)) {
      n = split(substr($0, RSTART, RLENGTH), words, /[][ :,]+/)
      for (i = 1; i <= n; i++) if (words[i] != "" && words[i] !~ /^alias(es)?$/) print words[i]
    }
  }')"
if [[ $(wc -l <<<"$builtins") -lt 50 ]]; then
  fail "liste des commandes intégrées de pnpm illisible (format de « pnpm help » modifié ?)"
else
  while read -r name; do
    case "$name" in test | start | stop | restart | clean | purge | tasks) continue ;; esac
    if grep -qxF "$name" <<<"$builtins"; then
      fail "$root_manifest : le script « $name » porte le nom d'une commande intégrée de pnpm"
    fi
  done < <(node -e "Object.keys(require(process.argv[1]).scripts ?? {}).forEach((n) => console.log(n))" \
    "$(realpath "$root_manifest")")
fi

if ((errors > 0)); then
  echo "$errors règle(s) non respectée(s)." >&2
  exit 1
fi
echo "Règles du dépôt respectées."
