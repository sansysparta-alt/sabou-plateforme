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
    [[ "$cmd" =~ ^bash\ infra/ci/[a-z0-9-]+\.sh$ ]] || fail "$workflow : commande hors infra/ci/ : $cmd"
  done < <(grep -Eo 'run: *.+' "$workflow" | sed 's/run: *//')
done

# 5. Image Trivy épinglée par empreinte sha256 ; images Docker du projet aussi (check-pins.sh)
grep -Eq 'aquasec/trivy@sha256:[0-9a-f]{64}"' infra/ci/trivy.sh || fail "trivy.sh : image Trivy non épinglée par empreinte"
bash infra/ci/check-pins.sh >/dev/null || fail "images Docker non épinglées (détail ci-dessus)"
grep -Eq "'arigaio/atlas@sha256:[0-9a-f]{64}'" packages/db/src/atlas.ts || fail "atlas.ts : image Atlas non épinglée par empreinte"
grep -Eq "'jrottenberg/ffmpeg@sha256:[0-9a-f]{64}';" packages/audio/src/ffmpeg.ts || fail "ffmpeg.ts : image FFmpeg non épinglée par empreinte"

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

# 7. Le job Flutter ne tourne que si l'application mobile change (US-005) : le workflow
# mobile.yml filtre ses déclencheurs (pull_request et push) sur apps/mobile/, sur ses
# propres fichiers de pipeline et sur les jetons de la charte que reprend le thème (US-018) ; aucun autre workflow ne lance mobile.sh.
# Usage alternatif : MOBILE_WORKFLOW=fichier (contre-épreuve).
mobile_workflow="${MOBILE_WORKFLOW:-.github/workflows/mobile.yml}"
if [[ -d apps/mobile ]]; then
  if [[ ! -f "$mobile_workflow" ]]; then
    fail "$mobile_workflow manquant : l'application mobile n'est pas compilée par le pipeline"
  else
    # Chemins de chaque bloc « paths: », par déclencheur
    filters="$(awk '
      /^  [a-z_]+:/ { trigger = $1; sub(":", "", trigger); in_paths = 0 }
      /^    paths:/ { in_paths = 1; next }
      in_paths && /^      - / { gsub(/[\x27"]/, "", $2); print trigger " " $2; next }
      in_paths && !/^      - / { in_paths = 0 }' "$mobile_workflow")"
    for trigger in pull_request push; do
      grep -q "^$trigger apps/mobile/\*\*$" <<<"$filters" ||
        fail "$mobile_workflow : $trigger ne filtre pas sur apps/mobile/**"
    done
    while read -r trigger path; do
      [[ -z "$path" ]] && continue
      case "$path" in
        apps/mobile/\*\* | infra/ci/mobile.sh | .github/workflows/mobile.yml | packages/ui/src/tokens.css) ;;
        *) fail "$mobile_workflow : $trigger se déclenche aussi sur $path" ;;
      esac
    done <<<"$filters"
  fi
  for workflow in .github/workflows/*.yml; do
    [[ "$workflow" == "$mobile_workflow" ]] && continue
    grep -q 'infra/ci/mobile.sh' "$workflow" && fail "$workflow lance mobile.sh sans filtre sur apps/mobile/"
  done
fi

# 8. Domaines Keycloak : nom et description des clients, rôles et portées tiennent dans les
# colonnes de Keycloak (255 caractères) ; au-delà, Keycloak 26 refuse de démarrer à
# l'import, sans message clair (US-016, US-040b).
# Usage alternatif : KEYCLOAK_REALMS="fichier…" (contre-épreuve).
for realm in ${KEYCLOAK_REALMS:-infra/local/keycloak/realm-*.json}; do
  too_long="$(node -e '
    const realm = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const items = [...(realm.clients ?? []), ...(realm.roles?.realm ?? []), ...(realm.clientScopes ?? [])];
    for (const item of items)
      for (const field of ["name", "description"])
        if ((item[field] ?? "").length > 255)
          console.log(`${item.clientId ?? item.name} (${field}, ${item[field].length} caractères)`);
  ' "$realm")"
  [[ -z "$too_long" ]] || fail "$realm : texte de plus de 255 caractères : $too_long"
done

if ((errors > 0)); then
  echo "$errors règle(s) non respectée(s)." >&2
  exit 1
fi
echo "Règles du dépôt respectées."
